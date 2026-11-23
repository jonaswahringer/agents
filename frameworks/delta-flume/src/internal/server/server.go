// Package server is the control plane: it holds the queue, decides which
// node works on which unit, and answers the nodes and the commands. It is
// the only thing that touches the store.
package server

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/alert"
	"github.com/jonaswahringer/delta-flume/src/internal/gateway"
	"github.com/jonaswahringer/delta-flume/src/internal/unit"
	"github.com/jonaswahringer/delta-flume/src/internal/wire"
)

// Store is what the server reads for its lists. The gateway does the rest.
type Store interface {
	gateway.Store
	Events(ctx context.Context, limit int) ([]unit.Event, error)
}

const (
	// maxWait is the longest the server holds a node's question open.
	maxWait = time.Minute
	// nodeGone is how long after its last question a node still gets work.
	nodeGone = 3 * maxWait
	// queueEmpty is the gateway's answer when no unit waits.
	queueEmpty = "the queue is empty"
	// checkEvery is how often the server watches and decides again with
	// nothing having happened.
	checkEvery = 30 * time.Second
	// alertsWaiting is how many alerts may wait to be sent.
	alertsWaiting = 64
	// lastAlerts is how long the alerts that still wait may take to go out
	// when the server stops.
	lastAlerts = 30 * time.Second
)

// Server decides and remembers. Create one with New.
type Server struct {
	gw    *gateway.Gateway
	store Store
	now   func() time.Time
	logf  func(format string, args ...any)
	// channels are the alert channels the server can send to, by the name
	// an instance file uses.
	channels map[string]alert.Channel
	// alerts wait here until Run sends them.
	alerts chan alert.Alert

	mu sync.Mutex
	// nodes are the nodes that have asked, by name.
	nodes map[string]*node
	// version changes whenever what a node should work on may have changed.
	version int64
	// changed is closed at every such change, and then replaced.
	changed chan struct{}
	// stopped is closed when the server is about to stop.
	stopped  chan struct{}
	stopOnce sync.Once
}

// node is a machine as the server last heard from it.
type node struct {
	report wire.Report
	seen   time.Time
	// waiting is why the node last got nothing, so it is logged once.
	waiting string
}

// New makes a server on a store. logf gets one line for everything the
// server decides. channels are the alert channels it can send to, by name.
func New(store Store, now func() time.Time, logf func(format string, args ...any), channels map[string]alert.Channel) *Server {
	return &Server{
		gw: gateway.New(store, now), store: store, now: now, logf: logf,
		channels: channels, alerts: make(chan alert.Alert, alertsWaiting),
		nodes: map[string]*node{},
		// A version from the clock differs after a restart, so a node that
		// held an answer from before asks again at once.
		version: now().UnixNano(),
		changed: make(chan struct{}),
		stopped: make(chan struct{}),
	}
}

// Stop answers every question that is held open, and holds none from then
// on. Call it before the server stops answering.
func (s *Server) Stop() {
	s.stopOnce.Do(func() { close(s.stopped) })
}

// touch says that what some node should work on may have changed. Every
// question that is held open is answered.
func (s *Server) touch() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.version++
	close(s.changed)
	s.changed = make(chan struct{})
}

// Submit hands units to the gateway, in order, and then decides who starts.
func (s *Server) Submit(ctx context.Context, submissions []gateway.Submission) ([]gateway.Decision, error) {
	decisions := make([]gateway.Decision, 0, len(submissions))
	for _, submission := range submissions {
		d, err := s.gw.Accept(ctx, submission)
		if err != nil {
			return decisions, err
		}
		decisions = append(decisions, d)
	}
	return decisions, s.Decide(ctx)
}

// Queue returns the units waiting to start, in start order.
func (s *Server) Queue(ctx context.Context) ([]unit.Unit, error) { return s.gw.Queue(ctx) }

// Units returns every unit, by key.
func (s *Server) Units(ctx context.Context) ([]unit.Unit, error) { return s.store.Units(ctx) }

// Events returns the newest events, oldest first: at most limit, or all
// when limit is 0.
func (s *Server) Events(ctx context.Context, limit int) ([]unit.Event, error) {
	return s.store.Events(ctx, limit)
}

// Owner returns the unit that owns a branch, if its agent may publish now.
func (s *Server) Owner(ctx context.Context, b wire.Branch) (unit.Unit, error) {
	return s.gw.Owner(ctx, b.Project, b.Branch)
}

// Pushed records that a unit's agent pushed its branch.
func (s *Server) Pushed(ctx context.Context, p wire.Pushed) error { return s.gw.Pushed(ctx, p.Key) }

// PullRequest records a unit's pull request. The unit then waits at Land, so
// its node has room again.
func (s *Server) PullRequest(ctx context.Context, p wire.PullRequest) error {
	if err := s.gw.PullRequest(ctx, p.Key, p.URL, p.Opened); err != nil {
		return err
	}
	s.touch()
	return s.Decide(ctx)
}

// Started records that a node started a unit's agent.
func (s *Server) Started(ctx context.Context, r wire.Started) error {
	if err := s.gw.Started(ctx, r.Key, r.Node, r.Session); err != nil {
		return err
	}
	s.logf("started %s on %s in session %s", r.Key, r.Node, r.Session)
	s.touch()
	return nil
}

// NotStarted records that a node could not start a unit's agent, and then
// decides again: the node has room for another unit.
func (s *Server) NotStarted(ctx context.Context, r wire.NotStarted) (unit.Unit, error) {
	u, err := s.gw.NotStarted(ctx, r.Key, r.Node, r.Reason)
	if err != nil {
		return unit.Unit{}, err
	}
	if u.State == unit.DeadLetter {
		s.logf("dead letter: %s after %d failed starts, the last on %s: %s", u.Key, u.FailedStarts, r.Node, r.Reason)
		s.alert(u, "a dead letter", fmt.Sprintf("Its agent did not start %d times in a row, over %s. The last try, on %s: %s.",
			u.FailedStarts, s.now().Sub(u.FailingSince).Round(time.Minute), r.Node, r.Reason))
	} else {
		s.logf("not started: %s on %s (failed start %d, next try at %s): %s",
			u.Key, r.Node, u.FailedStarts, u.NotBefore.Local().Format("15:04"), r.Reason)
	}
	s.touch()
	return u, s.Decide(ctx)
}

// Sync is a node asking what it should be working on. The answer is the
// whole picture. When the node has seen the current one, the question is
// held open until something changes or the node's wait is over.
func (s *Server) Sync(ctx context.Context, r wire.Report) (wire.Desired, error) {
	switch {
	case r.Node == "":
		return wire.Desired{}, errors.New("a report needs the node's name")
	case r.MaxRunning < 0:
		return wire.Desired{}, fmt.Errorf("max_running is %d; it cannot be negative", r.MaxRunning)
	}
	s.mu.Lock()
	old := s.nodes[r.Node]
	n := &node{report: r, seen: s.now()}
	if old != nil {
		n.waiting = old.waiting
	}
	s.nodes[r.Node] = n
	s.mu.Unlock()
	if old == nil {
		s.logf("node %s joined: %d projects, room for %d units", r.Node, len(r.Projects), r.MaxRunning)
	}
	if err := s.seen(ctx, r); err != nil {
		return wire.Desired{}, err
	}
	if err := s.Decide(ctx); err != nil {
		return wire.Desired{}, err
	}

	timeout := time.NewTimer(min(time.Duration(r.WaitSeconds)*time.Second, maxWait))
	defer timeout.Stop()
	for {
		s.mu.Lock()
		version, changed := s.version, s.changed
		s.mu.Unlock()
		if version != r.Seen {
			return s.desired(ctx, r.Node, version)
		}
		select {
		case <-changed:
		case <-timeout.C:
			return s.desired(ctx, r.Node, version)
		case <-s.stopped:
			return s.desired(ctx, r.Node, version)
		case <-ctx.Done():
			return wire.Desired{}, ctx.Err()
		}
	}
}

// desired is everything the node should be working on.
func (s *Server) desired(ctx context.Context, name string, version int64) (wire.Desired, error) {
	active, err := s.store.Units(ctx, unit.Starting, unit.Running)
	if err != nil {
		return wire.Desired{}, err
	}
	d := wire.Desired{Version: version, Units: []unit.Unit{}}
	for _, u := range active {
		if u.Node == name {
			d.Units = append(d.Units, u)
		}
	}
	return d, nil
}

// Decide gives queued units to the nodes that can take them. It is safe to
// call at any time and as often as wanted: it only acts on what is stored.
func (s *Server) Decide(ctx context.Context) error {
	for _, name := range s.aliveNodes() {
		for {
			s.mu.Lock()
			n := s.nodes[name]
			report := n.report
			s.mu.Unlock()
			u, waiting, err := s.gw.Assign(ctx, gateway.Node{
				Name: name, Limit: report.MaxRunning,
				Can: func(u unit.Unit) (bool, string) { return canRun(report, u) },
			})
			if err != nil {
				return err
			}
			if u == nil {
				s.mu.Lock()
				said := n.waiting == waiting
				n.waiting = waiting
				s.mu.Unlock()
				// An empty queue needs no explaining.
				if !said && waiting != queueEmpty {
					s.logf("waiting: %s", waiting)
				}
				break
			}
			s.logf("told %s to start %s", name, u.Key)
			s.touch()
		}
	}
	return nil
}

// aliveNodes are the nodes that asked lately, by name.
func (s *Server) aliveNodes() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	var names []string
	for name, n := range s.nodes {
		if now.Sub(n.seen) < nodeGone {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names
}

// canRun reports whether a node has the unit's project and has not paused
// the unit's instance there.
func canRun(report wire.Report, u unit.Unit) (bool, string) {
	for _, p := range report.Projects {
		if p.Name != u.Key.Project {
			continue
		}
		if slices.Contains(p.Paused, u.Key.Vessel+"/"+u.Key.Instance) {
			return false, "belongs to an instance that is paused there"
		}
		return true, ""
	}
	return false, "is for a project the node does not have"
}

// Run watches the units and decides again every so often, and whenever a
// wait after a failed start is over. It sends the alerts. It returns when
// ctx ends, once the alerts that wait have gone out.
func (s *Server) Run(ctx context.Context) {
	var sending sync.WaitGroup
	sending.Go(func() { s.send(ctx) })
	defer sending.Wait()
	for {
		if err := s.Watch(ctx); err != nil && ctx.Err() == nil {
			s.logf("watching failed: %v", err)
		}
		if err := s.Decide(ctx); err != nil && ctx.Err() == nil {
			s.logf("deciding failed: %v", err)
		}
		wait := checkEvery
		if next, err := s.gw.NextTry(ctx); err == nil && !next.IsZero() {
			wait = min(wait, max(next.Sub(s.now()), 0)+time.Second)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

// seen hands what a node saw of its sessions to the watcher.
func (s *Server) seen(ctx context.Context, r wire.Report) error {
	sightings := make([]gateway.Sighting, 0, len(r.Sessions))
	for _, x := range r.Sessions {
		sightings = append(sightings, gateway.Sighting{
			Key: x.Key, Session: x.Session, Busy: x.Busy, Asking: x.Asking,
			Quiet: time.Duration(x.QuietSeconds) * time.Second, Status: x.Status, Error: x.Error,
		})
	}
	verdicts, err := s.gw.Seen(ctx, r.Node, sightings)
	for _, v := range verdicts {
		s.logf("%s: %s: %s", v.Kind, v.Unit.Key, v.Detail)
		if v.Alert {
			s.alert(v.Unit, "waiting for a human", "Its session "+v.Unit.Session+" on "+v.Unit.Node+
				" waits for a human's answer, such as an approval. The unit counts as alive while it waits.")
		}
	}
	return err
}

// Watch judges every unit by the server's clock, and decides again when
// that gave a node room.
func (s *Server) Watch(ctx context.Context) error {
	verdicts, err := s.gw.Watch(ctx)
	room := false
	for _, v := range verdicts {
		s.logf("%s: %s: %s", v.Kind, v.Unit.Key, v.Detail)
		if v.Alert {
			s.alert(v.Unit, alertKinds[v.Kind], v.Detail+".")
		}
		room = room || v.Kind != "weight raised"
	}
	if room {
		s.touch()
	}
	return err
}

// alertKinds finish an alert's title, "<key> is ...", for each verdict that
// alerts.
var alertKinds = map[string]string{"stuck": "stuck", "over ceiling": "over its ceiling", "dead letter": "a dead letter"}

// alert puts an alert about a unit in line to be sent. A full line drops it,
// and the log says so.
func (s *Server) alert(u unit.Unit, kind, text string) {
	a := alert.Alert{Key: u.Key, Weight: u.Weight, Kind: kind, Text: text}
	select {
	case s.alerts <- a:
	default:
		s.logf("alert dropped, %d are already waiting: %s", alertsWaiting, a.Title())
	}
}

// send sends the alerts as they come, until ctx ends. Then it sends the
// ones that still wait, for a short while.
func (s *Server) send(ctx context.Context) {
	for {
		select {
		case a := <-s.alerts:
			s.deliver(ctx, a)
		case <-ctx.Done():
			last, cancel := context.WithTimeout(context.WithoutCancel(ctx), lastAlerts)
			defer cancel()
			for {
				select {
				case a := <-s.alerts:
					s.deliver(last, a)
				default:
					return
				}
			}
		}
	}
}

// deliver sends an alert to every channel its unit's instance names, and
// records each try. With no channel named, the log and the record are all.
func (s *Server) deliver(ctx context.Context, a alert.Alert) {
	target, names := s.alertsFor(a.Key)
	record := func(kind, detail string) {
		if err := s.gw.Record(ctx, a.Key, kind, detail); err != nil {
			s.logf("recording an alert for %s failed: %v", a.Key, err)
		}
	}
	if len(names) == 0 {
		s.logf("alert: %s (%s/%s names no alert channel)", a.Title(), a.Key.Vessel, a.Key.Instance)
		record("alert", "no channel named, so only logged: "+a.Title())
		return
	}
	for _, name := range names {
		channel, ok := s.channels[name]
		if !ok {
			s.logf("alert not sent: %s: no channel %q", a.Title(), name)
			record("alert failed", fmt.Sprintf("%s: this server has no such channel", name))
			continue
		}
		where, err := channel.Send(ctx, target, a)
		if err != nil {
			s.logf("alert not sent: %s: %s: %v", a.Title(), name, err)
			record("alert failed", fmt.Sprintf("%s: %v", name, err))
			continue
		}
		s.logf("alert sent: %s: %s %s", a.Title(), name, where)
		record("alert", strings.TrimSpace(name+" "+where))
	}
}

// alertsFor is where alerts about a unit go: the channels its instance
// names, as the nodes that have its project last said.
func (s *Server) alertsFor(key unit.Key) (alert.Target, []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	names := make([]string, 0, len(s.nodes))
	for name := range s.nodes {
		names = append(names, name)
	}
	sort.Strings(names)
	var target alert.Target
	var channels []string
	for _, name := range names {
		for _, p := range s.nodes[name].report.Projects {
			if p.Name != key.Project {
				continue
			}
			if target.Repo == "" {
				target.Repo = p.Repo
			}
			if channels == nil {
				channels = p.Alerts[key.Vessel+"/"+key.Instance]
			}
		}
	}
	return target, channels
}
