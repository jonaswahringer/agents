// Package gateway is a vessel's input policy. Accept judges each unit by its
// key, the queue holds accepted units until a node may start them, and the
// record says which unit owns a branch.
package gateway

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/unit"
)

// Store is what the gateway needs remembered between runs.
type Store interface {
	// Change runs fn in one transaction on the unit stored under key, nil if
	// there is none. It saves the unit and appends the event that fn returns;
	// either may be nil.
	Change(ctx context.Context, key unit.Key, fn func(old *unit.Unit) (*unit.Unit, *unit.Event, error)) error
	// Pick runs fn in one transaction on every unit in the given states, and
	// saves the unit and appends the event that fn returns; either may be nil.
	Pick(ctx context.Context, states []unit.State, fn func(units []unit.Unit) (*unit.Unit, *unit.Event, error)) error
	// Units returns the units in any of the given states, or all without one.
	Units(ctx context.Context, states ...unit.State) ([]unit.Unit, error)
}

// Gateway applies the policy. It keeps nothing itself: the store remembers,
// and the clock is passed in so a test can set the time.
type Gateway struct {
	store Store
	now   func() time.Time
}

func New(store Store, now func() time.Time) *Gateway {
	return &Gateway{store: store, now: now}
}

// Submission is a unit as a trigger hands it over.
type Submission struct {
	Key    unit.Key    `json:"key"`
	Weight unit.Weight `json:"weight"`
	// Content is the whole unit as a JSON object. Two submissions carry the
	// same input when their content is the same, whatever the key order or
	// spacing.
	Content json.RawMessage `json:"content"`
}

// Outcome is what Accept did with a submission.
type Outcome string

const (
	// Accepted: the unit is in the queue. It is new, or it came back with
	// new input after its last run ended.
	Accepted Outcome = "accepted"
	// Updated: the unit was already queued and now carries the new input.
	Updated Outcome = "updated"
	// Declined: nothing changed. The reason is logged.
	Declined Outcome = "declined"
)

// Decision is Accept's verdict on one submission.
type Decision struct {
	Key     string  `json:"key"`
	Outcome Outcome `json:"outcome"`
	Reason  string  `json:"reason,omitempty"`
}

// Accept judges a submission against what is remembered under its key and
// logs the decision.
func (g *Gateway) Accept(ctx context.Context, s Submission) (Decision, error) {
	content, fingerprint, err := canonical(s.Content)
	if err != nil {
		return Decision{}, fmt.Errorf("%s: %w", s.Key, err)
	}
	now := g.now()
	d := Decision{Key: s.Key.String()}
	err = g.store.Change(ctx, s.Key, func(old *unit.Unit) (*unit.Unit, *unit.Event, error) {
		d.Outcome, d.Reason = decide(old, fingerprint)
		event := &unit.Event{At: now, Key: d.Key, Kind: string(d.Outcome), Detail: d.Reason}
		if d.Outcome == Declined {
			return nil, event, nil
		}
		u := unit.Unit{Key: s.Key, Created: now, Queued: now}
		if old != nil {
			u = *old
		}
		if d.Outcome == Accepted {
			// An updated unit keeps its place in the queue; this one joins
			// it, with its failed starts forgotten.
			u.State, u.Queued = unit.Queued, now
			forgetFailedStarts(&u)
		}
		u.Weight, u.Content, u.Fingerprint, u.Weighed, u.Updated = s.Weight, content, fingerprint, now, now
		return &u, event, nil
	})
	if err != nil {
		return Decision{}, err
	}
	return d, nil
}

// decide is the Accept rule. A unit that is starting or running is declined
// even with new input, and the new input is not stored: its run read the old
// one, so the next submission after the run still counts as new.
func decide(old *unit.Unit, fingerprint string) (Outcome, string) {
	switch {
	case old == nil:
		return Accepted, ""
	case old.Fingerprint == fingerprint:
		return Declined, fmt.Sprintf("nothing new, and the unit is already %s", old.State)
	case old.State == unit.Queued:
		return Updated, "new input while queued"
	case old.Active():
		return Declined, "new input, but a run is in progress; submit it again when the run ends"
	}
	return Accepted, fmt.Sprintf("new input, and the unit was %s", old.State)
}

// Queue returns the units waiting to start, in start order: heaviest first,
// then longest waiting. A unit with no weight comes last.
func (g *Gateway) Queue(ctx context.Context) ([]unit.Unit, error) {
	units, err := g.store.Units(ctx, unit.Queued)
	if err != nil {
		return nil, err
	}
	inStartOrder(units)
	return units, nil
}

func inStartOrder(units []unit.Unit) {
	sort.Slice(units, func(i, j int) bool {
		a, b := units[i], units[j]
		if a.Weight != b.Weight {
			return a.Weight > b.Weight
		}
		if !a.Queued.Equal(b.Queued) {
			return a.Queued.Before(b.Queued)
		}
		return a.Key.String() < b.Key.String()
	})
}

// Node is what the gateway needs to know about a machine to give it a unit.
type Node struct {
	Name string
	// Limit is how many units may be active on the node at once.
	Limit int
	// Can reports whether the node can run a unit now. When it cannot, why
	// finishes the sentence "it ...", such as "belongs to a vessel that is
	// paused there".
	Can func(u unit.Unit) (ok bool, why string)
}

// Assign judges the node, not the unit. It takes the first unit in the queue
// that the node can run and marks it as starting there, unless the node is
// at its limit. When nothing is assigned it returns nil and says why.
// Two calls at once never take the same unit.
func (g *Gateway) Assign(ctx context.Context, node Node) (assigned *unit.Unit, waiting string, err error) {
	now := g.now()
	err = g.store.Pick(ctx, []unit.State{unit.Queued, unit.Starting, unit.Running}, func(units []unit.Unit) (*unit.Unit, *unit.Event, error) {
		var queue []unit.Unit
		active := 0
		for _, u := range units {
			switch {
			case u.State == unit.Queued:
				queue = append(queue, u)
			case u.Node == node.Name:
				active++
			}
		}
		switch {
		case len(queue) == 0:
			waiting = "the queue is empty"
			return nil, nil, nil
		case active >= node.Limit:
			waiting = fmt.Sprintf("%s is overloaded: %d active, and its limit is %d", node.Name, active, node.Limit)
			return nil, nil, nil
		}
		inStartOrder(queue)
		var reasons []string
		for i := range queue {
			u := queue[i]
			why := ""
			switch {
			case u.NotBefore.After(now):
				why = "waits after a failed start, next try in " + span(u.NotBefore.Sub(now))
			case u.Session != "" && u.Node != node.Name:
				// It ran before. Its session, its branch and its checkout
				// are on the node that ran it.
				why = "has its session on " + u.Node
			default:
				if ok, reason := node.Can(u); !ok {
					why = reason
				}
			}
			if why != "" {
				reasons = append(reasons, fmt.Sprintf("%s: it %s", u.Key, why))
				continue
			}
			u.State, u.Node, u.Updated = unit.Starting, node.Name, now
			assigned = &u
			return &u, &unit.Event{At: now, Key: u.Key.String(), Kind: "assigned", Detail: node.Name}, nil
		}
		waiting = fmt.Sprintf("%s cannot start %s", node.Name, reasons[0])
		if more := len(reasons) - 1; more > 0 {
			waiting += fmt.Sprintf("; %d more cannot start there either", more)
		}
		return nil, nil, nil
	})
	if err != nil {
		return nil, "", err
	}
	return assigned, waiting, nil
}

// Started records that a node started the agent of a unit it was assigned,
// and the session that runs it.
func (g *Gateway) Started(ctx context.Context, key unit.Key, node, session string) error {
	now := g.now()
	return g.store.Change(ctx, key, func(old *unit.Unit) (*unit.Unit, *unit.Event, error) {
		if err := startingOn(old, key, node); err != nil {
			return nil, nil, err
		}
		old.State, old.Session, old.Updated = unit.Running, session, now
		old.Started, old.Alive, old.Asking = now, now, time.Time{}
		forgetFailedStarts(old)
		return old, &unit.Event{At: now, Key: key.String(), Kind: "started", Detail: fmt.Sprintf("on %s in session %s", node, session)}, nil
	})
}

// A unit whose agent does not start is tried again later: after firstWait,
// then after twice as long each time, up to longestWait. Once giveUpAfter
// has passed since the first failure, the next failure makes it a dead
// letter.
const (
	firstWait   = 2 * time.Minute
	longestWait = time.Hour
	giveUpAfter = 6 * time.Hour
)

// NotStarted records that a node could not start the agent of a unit it was
// assigned. The unit goes back to its place in the queue, to be tried again
// after a wait that doubles with every failure; the units behind it can
// start meanwhile. A unit that keeps failing becomes a dead letter. It
// returns the unit as it now stands.
func (g *Gateway) NotStarted(ctx context.Context, key unit.Key, node, reason string) (unit.Unit, error) {
	now := g.now()
	var after unit.Unit
	err := g.store.Change(ctx, key, func(old *unit.Unit) (*unit.Unit, *unit.Event, error) {
		if err := startingOn(old, key, node); err != nil {
			return nil, nil, err
		}
		old.FailedStarts++
		if old.FailingSince.IsZero() {
			old.FailingSince = now
		}
		old.Updated = now
		event := &unit.Event{At: now, Key: key.String()}
		if failing := now.Sub(old.FailingSince); failing >= giveUpAfter {
			old.State, old.NotBefore = unit.DeadLetter, time.Time{}
			event.Kind = "dead letter"
			event.Detail = fmt.Sprintf("failed start %d on %s, %s after the first: %s", old.FailedStarts, node, span(failing), reason)
		} else {
			wait := waitAfter(old.FailedStarts)
			old.State, old.NotBefore = unit.Queued, now.Add(wait)
			event.Kind = "start failed"
			event.Detail = fmt.Sprintf("failed start %d on %s, next try in %s: %s", old.FailedStarts, node, span(wait), reason)
		}
		after = *old
		return old, event, nil
	})
	return after, err
}

func startingOn(u *unit.Unit, key unit.Key, node string) error {
	switch {
	case u == nil:
		return fmt.Errorf("there is no unit %s", key)
	case u.State != unit.Starting:
		return fmt.Errorf("%s is %s, not starting", key, u.State)
	case u.Node != node:
		return fmt.Errorf("%s is starting on %s, not on %s", key, u.Node, node)
	}
	return nil
}

func waitAfter(failedStarts int) time.Duration {
	wait := firstWait
	for i := 1; i < failedStarts && wait < longestWait; i++ {
		wait *= 2
	}
	return min(wait, longestWait)
}

func forgetFailedStarts(u *unit.Unit) {
	u.FailedStarts, u.FailingSince, u.NotBefore = 0, time.Time{}, time.Time{}
}

// NextTry is the earliest time a queued unit that waits after a failed
// start may be tried again. It is the zero time when no unit waits.
func (g *Gateway) NextTry(ctx context.Context) (time.Time, error) {
	units, err := g.store.Units(ctx, unit.Queued)
	if err != nil {
		return time.Time{}, err
	}
	now := g.now()
	var next time.Time
	for _, u := range units {
		if u.NotBefore.After(now) && (next.IsZero() || u.NotBefore.Before(next)) {
			next = u.NotBefore
		}
	}
	return next, nil
}

// Owner returns the unit that owns a branch of a project, if its agent may
// publish now: a node is starting it, it is running, or its output is at
// Land.
func (g *Gateway) Owner(ctx context.Context, project, branch string) (unit.Unit, error) {
	if !strings.HasPrefix(branch, unit.BranchPrefix) {
		return unit.Unit{}, fmt.Errorf("branch %q is not a unit's branch", branch)
	}
	units, err := g.store.Units(ctx)
	if err != nil {
		return unit.Unit{}, err
	}
	var owners []unit.Unit
	for _, u := range units {
		if u.Key.Project == project && u.Key.Branch() == branch {
			owners = append(owners, u)
		}
	}
	switch {
	case len(owners) == 0:
		return unit.Unit{}, fmt.Errorf("no unit of project %s owns branch %s", project, branch)
	case len(owners) > 1:
		return unit.Unit{}, fmt.Errorf("%s and %s both own branch %s", owners[0].Key, owners[1].Key, branch)
	}
	u := owners[0]
	if err := mayPublish(&u, u.Key); err != nil {
		return unit.Unit{}, err
	}
	return u, nil
}

func mayPublish(u *unit.Unit, key unit.Key) error {
	switch {
	case u == nil:
		return fmt.Errorf("there is no unit %s", key)
	case !u.Active() && u.State != unit.Landing:
		return fmt.Errorf("unit %s is %s; its agent may publish only while it is running or at Land", key, u.State)
	}
	return nil
}

// Pushed records that a unit's agent pushed its branch.
func (g *Gateway) Pushed(ctx context.Context, key unit.Key) error {
	now := g.now()
	return g.store.Change(ctx, key, func(old *unit.Unit) (*unit.Unit, *unit.Event, error) {
		if err := mayPublish(old, key); err != nil {
			return nil, nil, err
		}
		return nil, &unit.Event{At: now, Key: key.String(), Kind: "pushed", Detail: key.Branch()}, nil
	})
}

// PullRequest records that a unit's pull request is open at url: opened now,
// or changed. The unit then waits at Land.
func (g *Gateway) PullRequest(ctx context.Context, key unit.Key, url string, opened bool) error {
	now := g.now()
	return g.store.Change(ctx, key, func(old *unit.Unit) (*unit.Unit, *unit.Event, error) {
		if err := mayPublish(old, key); err != nil {
			return nil, nil, err
		}
		kind := "pr updated"
		if opened {
			kind = "pr opened"
		}
		old.PR, old.State, old.Updated = url, unit.Landing, now
		return old, &unit.Event{At: now, Key: key.String(), Kind: kind, Detail: url}, nil
	})
}

// span spells a wait in whole minutes, such as 4m, 1h or 6h2m.
func span(d time.Duration) string {
	d = d.Round(time.Minute)
	hours, minutes := int(d/time.Hour), int(d%time.Hour/time.Minute)
	switch {
	case hours == 0:
		return fmt.Sprintf("%dm", minutes)
	case minutes == 0:
		return fmt.Sprintf("%dh", hours)
	}
	return fmt.Sprintf("%dh%dm", hours, minutes)
}

// canonical rewrites a JSON object with sorted keys and no spacing, and
// fingerprints the result.
func canonical(content json.RawMessage) (json.RawMessage, string, error) {
	var object map[string]any
	dec := json.NewDecoder(bytes.NewReader(content))
	dec.UseNumber()
	if err := dec.Decode(&object); err != nil {
		return nil, "", fmt.Errorf("content is not a JSON object: %w", err)
	}
	if object == nil {
		return nil, "", fmt.Errorf("content is not a JSON object")
	}
	var out bytes.Buffer
	enc := json.NewEncoder(&out)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(object); err != nil {
		return nil, "", err
	}
	text := bytes.TrimSpace(out.Bytes())
	sum := sha256.Sum256(text)
	return text, hex.EncodeToString(sum[:]), nil
}
