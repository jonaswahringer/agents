package gateway_test

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/gateway"
	"github.com/jonaswahringer/delta-flume/src/internal/unit"
)

// node is a machine that can run every unit, with room for limit of them.
func node(name string, limit int) gateway.Node {
	return gateway.Node{Name: name, Limit: limit, Can: func(unit.Unit) (bool, string) { return true, "" }}
}

func TestAssignTakesTheHeadOfTheQueue(t *testing.T) {
	f := newFixture(t)
	if u, waiting, err := f.Assign(ctx, node("mini", 1)); err != nil || u != nil || waiting != "the queue is empty" {
		t.Fatalf("empty queue: unit %v, waiting %q, err %v", u, waiting, err)
	}
	f.accept(t, "maintenance/tiro/dependencies/low-1", unit.Low, `{}`)
	f.clock.tick()
	f.accept(t, "maintenance/tiro/dependencies/high-1", unit.High, `{}`)
	f.clock.tick()

	u, _, err := f.Assign(ctx, node("mini", 1))
	if err != nil || u == nil || u.Key.Subject != "high-1" || u.State != unit.Starting || u.Node != "mini" {
		t.Fatalf("assigned %+v, err %v; want high-1, starting on mini", u, err)
	}
	if got := f.queueKeys(t); got != "low-1" {
		t.Errorf("queue = %q, want low-1", got)
	}

	// At its limit the node is overloaded and the queue waits. Another node
	// has its own room.
	if u, waiting, _ := f.Assign(ctx, node("mini", 1)); u != nil || waiting != "mini is overloaded: 1 active, and its limit is 1" {
		t.Errorf("at the limit: unit %v, waiting %q", u, waiting)
	}
	if u, _, _ := f.Assign(ctx, node("box", 1)); u == nil || u.Key.Subject != "low-1" || u.Node != "box" {
		t.Errorf("another node: %v, want low-1 on box", u)
	}
}

func TestAssignSkipsWhatTheNodeCannotRun(t *testing.T) {
	f := newFixture(t)
	f.accept(t, "maintenance/tiro/dependencies/high-1", unit.High, `{}`)
	f.accept(t, "testing/tiro/suite/low-1", unit.Low, `{}`)
	noMaintenance := gateway.Node{Name: "mini", Limit: 5, Can: func(u unit.Unit) (bool, string) {
		return u.Key.Vessel != "maintenance", "belongs to an instance that is paused there"
	}}

	u, _, err := f.Assign(ctx, noMaintenance)
	if err != nil || u == nil || u.Key.Vessel != "testing" {
		t.Fatalf("assigned %+v, err %v; want the testing unit", u, err)
	}
	want := "mini cannot start maintenance/tiro/dependencies/high-1: it belongs to an instance that is paused there"
	if u, waiting, _ := f.Assign(ctx, noMaintenance); u != nil || waiting != want {
		t.Errorf("only a paused unit left: unit %v, waiting %q", u, waiting)
	}
	if got := f.queueKeys(t); got != "high-1" {
		t.Errorf("queue = %q, want high-1 still waiting", got)
	}
}

// A failed start does not block the queue: the unit waits, twice as long
// after every failure, and the units behind it start meanwhile.
func TestAFailedStartWaitsLongerEachTime(t *testing.T) {
	f := newFixture(t)
	f.accept(t, "maintenance/tiro/dependencies/first", unit.High, `{}`)
	f.clock.tick()
	f.accept(t, "maintenance/tiro/dependencies/second", unit.High, `{}`)
	f.clock.tick()
	first, mini := mustKey(t, "maintenance/tiro/dependencies/first"), node("mini", 1)

	for i, want := range []time.Duration{2 * time.Minute, 4 * time.Minute, 8 * time.Minute} {
		u, waiting, err := f.Assign(ctx, mini)
		if err != nil || u == nil || u.Key != first {
			t.Fatalf("try %d: assigned %v, waiting %q, err %v; want first", i+1, u, waiting, err)
		}
		after, err := f.NotStarted(ctx, first, "mini", "t3 is down")
		if err != nil {
			t.Fatal(err)
		}
		if after.State != unit.Queued || after.FailedStarts != i+1 || after.NotBefore.Sub(f.clock.at) != want {
			t.Fatalf("try %d: %s, %d failed starts, next try in %v; want queued, %d, %v",
				i+1, after.State, after.FailedStarts, after.NotBefore.Sub(f.clock.at), i+1, want)
		}
		if next, _ := f.NextTry(ctx); !next.Equal(after.NotBefore) {
			t.Errorf("try %d: next try at %v, want %v", i+1, next, after.NotBefore)
		}
		// While first waits, the unit behind it can start.
		if i == 0 {
			u, _, _ := f.Assign(ctx, mini)
			if u == nil || u.Key.Subject != "second" {
				t.Fatalf("while first waits: assigned %v, want second", u)
			}
			if _, err := f.NotStarted(ctx, u.Key, "box", "wrong node"); err == nil {
				t.Error("a node cannot report on a unit that is starting on another node")
			}
			if err := f.Started(ctx, u.Key, "mini", "thread-2"); err != nil {
				t.Fatal(err)
			}
			f.setState(t, "maintenance/tiro/dependencies/second", unit.Landing)
		}
		if u, waiting, _ := f.Assign(ctx, mini); u != nil || !strings.Contains(waiting, "first: it waits after a failed start, next try in "+strings.TrimSuffix(want.String(), "0s")) {
			t.Errorf("try %d, before the wait is over: unit %v, waiting %q", i+1, u, waiting)
		}
		f.clock.at = after.NotBefore
	}
	if _, err := f.NotStarted(ctx, first, "mini", "again"); err == nil {
		t.Error("a unit that is not starting cannot fail to start")
	}

	// A start that works forgets the failures.
	u, _, _ := f.Assign(ctx, mini)
	if err := f.Started(ctx, u.Key, "mini", "thread-1"); err != nil {
		t.Fatal(err)
	}
	running, _ := f.db.Units(ctx, unit.Running)
	if len(running) != 1 || running[0].Session != "thread-1" || running[0].FailedStarts != 0 || !running[0].NotBefore.IsZero() {
		t.Errorf("running = %+v, want first with its session and no failed starts", running)
	}
	if next, _ := f.NextTry(ctx); !next.IsZero() {
		t.Errorf("next try at %v, want none", next)
	}
}

// A unit that still cannot start six hours after its first failure becomes a
// dead letter. New input brings it back.
func TestAUnitThatKeepsFailingBecomesADeadLetter(t *testing.T) {
	f := newFixture(t)
	f.accept(t, "maintenance/tiro/dependencies/stuck", unit.High, `{"v":1}`)
	key, mini := mustKey(t, "maintenance/tiro/dependencies/stuck"), node("mini", 1)
	begin := f.clock.at

	var after unit.Unit
	tries := 0
	for after.State != unit.DeadLetter {
		if tries++; tries > 50 {
			t.Fatal("the unit never became a dead letter")
		}
		if u, waiting, _ := f.Assign(ctx, mini); u == nil {
			t.Fatalf("try %d: nothing assigned: %s", tries, waiting)
		}
		var err error
		if after, err = f.NotStarted(ctx, key, "mini", "the branch exists"); err != nil {
			t.Fatal(err)
		}
		if after.State == unit.Queued {
			f.clock.at = after.NotBefore
		}
	}
	// 2, 4, 8, 16 and 32 minutes, then an hour each: the 11th failure is the
	// first one six hours after the first.
	if tries != 11 || f.clock.at.Sub(begin) != 6*time.Hour+2*time.Minute {
		t.Errorf("a dead letter after %d tries and %v, want 11 and 6h2m", tries, f.clock.at.Sub(begin))
	}
	events, _ := f.db.Events(ctx, 1)
	want := "failed start 11 on mini, 6h2m after the first: the branch exists"
	if len(events) != 1 || events[0].Kind != "dead letter" || events[0].Detail != want {
		t.Errorf("last event = %+v, want a dead letter with %q", events, want)
	}
	if u, waiting, _ := f.Assign(ctx, mini); u != nil || waiting != "the queue is empty" {
		t.Errorf("a dead letter is not in the queue: unit %v, waiting %q", u, waiting)
	}
	if d := f.accept(t, "maintenance/tiro/dependencies/stuck", unit.High, `{"v":1}`); d.Outcome != gateway.Declined {
		t.Errorf("the same input again: %+v, want declined", d)
	}

	if d := f.accept(t, "maintenance/tiro/dependencies/stuck", unit.High, `{"v":2}`); d.Outcome != gateway.Accepted {
		t.Fatalf("new input: %+v, want accepted", d)
	}
	u, _, _ := f.Assign(ctx, mini)
	if u == nil || u.FailedStarts != 0 || !u.FailingSince.IsZero() {
		t.Errorf("after new input: %+v, want it assigned with its failed starts forgotten", u)
	}
}

// A unit that ran before goes back to the node that has its session.
func TestAUnitThatComesBackStaysOnItsNode(t *testing.T) {
	f := newFixture(t)
	f.accept(t, "maintenance/tiro/dependencies/lodash", unit.High, `{"v":1}`)
	key := mustKey(t, "maintenance/tiro/dependencies/lodash")
	if u, _, _ := f.Assign(ctx, node("mini", 1)); u == nil {
		t.Fatal("nothing assigned")
	}
	if err := f.Started(ctx, key, "mini", "thread-1"); err != nil {
		t.Fatal(err)
	}
	if err := f.PullRequest(ctx, key, "https://example.test/pr/1", true); err != nil {
		t.Fatal(err)
	}
	f.accept(t, "maintenance/tiro/dependencies/lodash", unit.High, `{"v":2}`)

	want := "box cannot start maintenance/tiro/dependencies/lodash: it has its session on mini"
	if u, waiting, _ := f.Assign(ctx, node("box", 1)); u != nil || waiting != want {
		t.Errorf("another node: unit %v, waiting %q", u, waiting)
	}
	u, _, _ := f.Assign(ctx, node("mini", 1))
	if u == nil || u.Session != "thread-1" || u.PR == "" {
		t.Errorf("its own node: %+v, want it with its session and pull request", u)
	}
}

func TestOnlyAUnitsOwnBranchMayBePublished(t *testing.T) {
	f := newFixture(t)
	f.accept(t, "maintenance/tiro/dependencies/lodash", unit.High, `{}`)
	key := mustKey(t, "maintenance/tiro/dependencies/lodash")
	branch := key.Branch()

	for name, tc := range map[string]struct{ project, branch, want string }{
		"not a unit's branch": {"tiro", "main", "is not a unit's branch"},
		"another project":     {"loki", branch, "no unit of project loki owns"},
		"no such unit":        {"tiro", "vessel/maintenance/dependencies/other", "no unit of project tiro owns"},
		"still queued":        {"tiro", branch, "is queued"},
	} {
		if _, err := f.Owner(ctx, tc.project, tc.branch); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: err %v, want one with %q", name, err, tc.want)
		}
	}
	if err := f.Pushed(ctx, key); err == nil {
		t.Error("a queued unit cannot push")
	}

	// Its setup runs while the node is still starting it.
	f.Assign(ctx, node("mini", 1))
	if u, err := f.Owner(ctx, "tiro", branch); err != nil || u.Key != key {
		t.Errorf("while starting: unit %v, err %v", u, err)
	}
	f.Started(ctx, key, "mini", "thread-1")
	if err := f.Pushed(ctx, key); err != nil {
		t.Errorf("while running: %v", err)
	}
	if err := f.PullRequest(ctx, key, "https://example.test/pr/1", true); err != nil {
		t.Fatal(err)
	}
	u, err := f.Owner(ctx, "tiro", branch)
	if err != nil || u.State != unit.Landing || u.PR != "https://example.test/pr/1" {
		t.Errorf("at Land: unit %+v, err %v", u, err)
	}
	f.setState(t, key.String(), unit.Landed)
	if _, err := f.Owner(ctx, "tiro", branch); err == nil || !strings.Contains(err.Error(), "is landed") {
		t.Errorf("after Land: err %v, want a refusal", err)
	}
}

// Several calls can assign at once. They never take the same unit, and
// never more than the node's limit.
func TestAssignsAtOnce(t *testing.T) {
	f := newFixture(t)
	for _, subject := range []string{"a", "b", "c", "d"} {
		f.accept(t, "maintenance/tiro/dependencies/"+subject, unit.High, `{}`)
	}
	const callers, limit = 12, 3
	assigned := make(chan string, callers)
	var wg sync.WaitGroup
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			u, _, err := f.Assign(ctx, node("mini", limit))
			if err != nil {
				t.Error(err)
			} else if u != nil {
				assigned <- u.Key.Subject
			}
		}()
	}
	wg.Wait()
	close(assigned)
	seen := map[string]bool{}
	for subject := range assigned {
		if seen[subject] {
			t.Errorf("%s was assigned twice", subject)
		}
		seen[subject] = true
	}
	if len(seen) != limit {
		t.Errorf("assigned %d units, want the limit of %d", len(seen), limit)
	}
}

func TestReadInstance(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, ".delta-flume", "vessels", "maintenance")
	os.MkdirAll(dir, 0o755)
	for name, tc := range map[string]struct {
		content string
		want    gateway.Instance
	}{
		"paused":       {"---\nvessel: maintenance\nstatus: paused\n---\n# x\n", gateway.Instance{Paused: true}},
		"active":       {"---\nvessel: maintenance\nstatus: active\n---\n", gateway.Instance{}},
		"spaced":       {"---\nstatus:   paused  \n---\n", gateway.Instance{Paused: true}},
		"no-status":    {"---\nvessel: maintenance\n---\nstatus: paused\n", gateway.Instance{}},
		"no-front":     {"# Maintenance\n\nstatus: paused\n", gateway.Instance{}},
		"empty":        {"", gateway.Instance{}},
		"unterminated": {"---\nvessel: x\n", gateway.Instance{}},
		"alerts":       {"---\nalerts: github-issue, mail ,\n---\n", gateway.Instance{Alerts: []string{"github-issue", "mail"}}},
	} {
		os.WriteFile(filepath.Join(dir, name+".md"), []byte(tc.content), 0o644)
		if got, err := gateway.ReadInstance(root, "maintenance", name); err != nil || !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s: %+v, err %v; want %+v", name, got, err, tc.want)
		}
	}
	if got, err := gateway.ReadInstance(root, "maintenance", "missing"); err != nil || !reflect.DeepEqual(got, gateway.Instance{}) {
		t.Errorf("a project without the file: %+v, err %v; want active with no channels", got, err)
	}
}
