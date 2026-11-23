package node_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/agent"
	"github.com/jonaswahringer/delta-flume/src/internal/node"
	"github.com/jonaswahringer/delta-flume/src/internal/unit"
	"github.com/jonaswahringer/delta-flume/src/internal/wire"
)

// control stands in for the server. It answers with units and remembers
// what the node told it.
type control struct {
	units       []unit.Unit
	version     int64
	reports     []wire.Report
	started     []wire.Started
	notStarted  []wire.NotStarted
	failStarted int
	// sync, when set, answers instead.
	sync func(n int) (wire.Desired, error)
}

func (c *control) Sync(ctx context.Context, r wire.Report) (wire.Desired, error) {
	c.reports = append(c.reports, r)
	if c.sync != nil {
		return c.sync(len(c.reports))
	}
	c.version++
	return wire.Desired{Version: c.version, Units: c.units}, nil
}

func (c *control) Started(ctx context.Context, s wire.Started) error {
	if c.failStarted > 0 {
		c.failStarted--
		return errors.New("no answer")
	}
	c.started = append(c.started, s)
	for i := range c.units {
		if c.units[i].Key == s.Key {
			c.units[i].State, c.units[i].Session = unit.Running, s.Session
		}
	}
	return nil
}

func (c *control) NotStarted(ctx context.Context, f wire.NotStarted) (unit.Unit, error) {
	c.notStarted = append(c.notStarted, f)
	for i := range c.units {
		if c.units[i].Key == f.Key {
			c.units[i].State, c.units[i].FailedStarts = unit.Queued, c.units[i].FailedStarts+1
			u := c.units[i]
			c.units = append(c.units[:i], c.units[i+1:]...)
			return u, nil
		}
	}
	return unit.Unit{}, fmt.Errorf("there is no unit %s", f.Key)
}

// agents stands in for the agent provider.
type agents struct {
	jobs  []agent.Job
	sends []string
	err   error
}

func (a *agents) Start(ctx context.Context, job agent.Job) (string, error) {
	a.jobs = append(a.jobs, job)
	return fmt.Sprintf("session-%d", len(a.jobs)), a.err
}

func (a *agents) Send(ctx context.Context, session, message string) error {
	a.sends = append(a.sends, session)
	return a.err
}

func starting(t *testing.T, key string) unit.Unit {
	t.Helper()
	k, err := unit.ParseKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return unit.Unit{Key: k, Weight: unit.High, State: unit.Starting, Node: "mini", Content: []byte(`{"input":["one"]}`)}
}

type fixture struct {
	*node.Node
	server *control
	agents *agents
	root   string
	log    []string
}

func newFixture(t *testing.T, units ...unit.Unit) *fixture {
	t.Helper()
	f := &fixture{server: &control{units: units}, agents: &agents{}, root: t.TempDir()}
	f.Node = &node.Node{
		Name: "mini", MaxRunning: 2, Projects: map[string]string{"tiro": f.root},
		Server: f.server, Provider: f.agents, Base: "main",
		Logf: func(format string, args ...any) { f.log = append(f.log, fmt.Sprintf(format, args...)) },
	}
	return f
}

func TestANodeStartsWhatItIsToldToStart(t *testing.T) {
	f := newFixture(t, starting(t, "maintenance/tiro/dependencies/lodash"))
	ctx := t.Context()
	if err := f.Step(ctx, 25*time.Second); err != nil {
		t.Fatal(err)
	}
	want := agent.Job{Root: f.root, Base: "main", Branch: "vessel/maintenance/dependencies/lodash", Title: "maintenance/tiro/dependencies/lodash"}
	if len(f.agents.jobs) != 1 {
		t.Fatalf("%d agents were started, want 1", len(f.agents.jobs))
	}
	got := f.agents.jobs[0]
	if !strings.Contains(got.Message, `"one"`) || !strings.Contains(got.Message, "Unit:   maintenance/tiro/dependencies/lodash") {
		t.Errorf("the agent's message:\n%s", got.Message)
	}
	if got.Message = ""; got != want {
		t.Errorf("job %+v, want %+v", got, want)
	}
	if len(f.server.started) != 1 || f.server.started[0].Session != "session-1" || f.server.started[0].Node != "mini" {
		t.Errorf("the server was told %+v, want session-1 on mini", f.server.started)
	}

	// The next answer shows the unit running. There is nothing to do.
	if err := f.Step(ctx, 25*time.Second); err != nil {
		t.Fatal(err)
	}
	if len(f.agents.jobs) != 1 {
		t.Errorf("%d agents were started, want still 1", len(f.agents.jobs))
	}
	first, second := f.server.reports[0], f.server.reports[1]
	if first.Node != "mini" || first.MaxRunning != 2 || first.WaitSeconds != 25 || first.Seen != 0 || second.Seen != 1 {
		t.Errorf("reports %+v and %+v", first, second)
	}
}

// A session that started must not start twice because the server could not
// be told the first time.
func TestASessionIsNotStartedTwice(t *testing.T) {
	f := newFixture(t, starting(t, "maintenance/tiro/dependencies/lodash"))
	f.server.failStarted = 1
	if err := f.Step(t.Context(), 0); err == nil || !strings.Contains(err.Error(), "started in session session-1, but the server could not be told") {
		t.Fatalf("first step: %v", err)
	}
	if seen := f.server.reports[0].Seen; seen != 0 {
		t.Errorf("seen = %d", seen)
	}
	if err := f.Step(t.Context(), 0); err != nil {
		t.Fatal(err)
	}
	if len(f.agents.jobs) != 1 {
		t.Errorf("%d agents were started, want 1", len(f.agents.jobs))
	}
	if len(f.server.started) != 1 || f.server.started[0].Session != "session-1" {
		t.Errorf("the server was told %+v, want session-1 once", f.server.started)
	}
	// The failed step left the node's view of the server where it was.
	if seen := f.server.reports[1].Seen; seen != 0 {
		t.Errorf("after a failed step the node says it saw version %d, want 0", seen)
	}
}

func TestANodeSaysWhenAnAgentDoesNotStart(t *testing.T) {
	lodash, other := starting(t, "maintenance/tiro/dependencies/lodash"), starting(t, "maintenance/loki/dependencies/lodash")
	f := newFixture(t, lodash, other)
	f.agents.err = errors.New("t3 is down")
	if err := f.Step(t.Context(), 0); err != nil {
		t.Fatal(err)
	}
	if len(f.server.notStarted) != 2 || len(f.server.started) != 0 {
		t.Fatalf("the server was told %+v and %+v", f.server.notStarted, f.server.started)
	}
	reasons := f.server.notStarted[0].Reason + " | " + f.server.notStarted[1].Reason
	for _, want := range []string{"t3 is down", "node mini has no folder for project loki"} {
		if !strings.Contains(reasons, want) {
			t.Errorf("the reasons %q lack %q", reasons, want)
		}
	}
	if log := strings.Join(f.log, "\n"); !strings.Contains(log, "not started: maintenance/tiro/dependencies/lodash (failed start 1; it will be tried again): t3 is down") {
		t.Errorf("the node's log:\n%s", log)
	}
}

// A unit that ran before gets a message in the session it has.
func TestAUnitThatRanBeforeGoesBackToItsSession(t *testing.T) {
	u := starting(t, "maintenance/tiro/dependencies/lodash")
	u.Session = "thread-7"
	f := newFixture(t, u)
	if err := f.Step(t.Context(), 0); err != nil {
		t.Fatal(err)
	}
	if len(f.agents.jobs) != 0 || !reflect.DeepEqual(f.agents.sends, []string{"thread-7"}) {
		t.Errorf("started %d agents and sent to %v, want a message to thread-7", len(f.agents.jobs), f.agents.sends)
	}
	if len(f.server.started) != 1 || f.server.started[0].Session != "thread-7" {
		t.Errorf("the server was told %+v", f.server.started)
	}
}

// The file for the how, .delta-flume/vessels/README.md, is not an instance.
func TestTheReportNamesPausedInstances(t *testing.T) {
	f := newFixture(t)
	other := t.TempDir()
	f.Projects["loki"] = other
	vessels := filepath.Join(f.root, ".delta-flume", "vessels")
	for file, status := range map[string]string{
		"maintenance/dependencies.md": "paused", "maintenance/docs.md": "active",
		"testing/snapshot-tests.md": "paused", "README.md": "paused",
	} {
		os.MkdirAll(filepath.Dir(filepath.Join(vessels, file)), 0o755)
		os.WriteFile(filepath.Join(vessels, file), []byte("---\nstatus: "+status+"\n---\n"), 0o644)
	}
	if err := f.Step(t.Context(), 0); err != nil {
		t.Fatal(err)
	}
	want := []wire.Project{{Name: "loki"}, {Name: "tiro", Paused: []string{"maintenance/dependencies", "testing/snapshot-tests"}}}
	if got := f.server.reports[0].Projects; !reflect.DeepEqual(got, want) {
		t.Errorf("projects %+v, want %+v", got, want)
	}
}

// A node keeps trying when the server does not answer, and stops when it is
// told to.
func TestANodeKeepsAsking(t *testing.T) {
	f := newFixture(t)
	ctx, stop := context.WithCancel(t.Context())
	f.server.sync = func(n int) (wire.Desired, error) {
		if n == 1 {
			return wire.Desired{}, errors.New("no answer from the flume server")
		}
		stop()
		return wire.Desired{}, ctx.Err()
	}
	done := make(chan struct{})
	go func() {
		f.Run(ctx)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("the node did not stop")
	}
	if len(f.server.reports) != 2 {
		t.Errorf("the node asked %d times, want 2", len(f.server.reports))
	}
	if want := "no answer from the flume server; trying again in 1s"; len(f.log) != 1 || f.log[0] != want {
		t.Errorf("the node's log %q, want %q", f.log, want)
	}
}
