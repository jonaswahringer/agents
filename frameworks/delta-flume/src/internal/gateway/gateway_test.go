package gateway_test

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/gateway"
	"github.com/jonaswahringer/delta-flume/src/internal/store"
	"github.com/jonaswahringer/delta-flume/src/internal/unit"
)

var ctx = context.Background()

// clock is a hand-set clock. Each call to tick moves it one minute on.
type clock struct{ at time.Time }

func (c *clock) now() time.Time { return c.at }
func (c *clock) tick()          { c.at = c.at.Add(time.Minute) }

// fixture is a gateway on a real SQLite file, so the SQL is tested too.
type fixture struct {
	*gateway.Gateway
	db    *store.DB
	clock *clock
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "flume.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	c := &clock{at: time.Date(2026, 11, 20, 9, 0, 0, 0, time.UTC)}
	return fixture{Gateway: gateway.New(db, c.now), db: db, clock: c}
}

func submission(t *testing.T, key string, weight unit.Weight, content string) gateway.Submission {
	t.Helper()
	k, err := unit.ParseKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return gateway.Submission{Key: k, Weight: weight, Content: []byte(content)}
}

func mustKey(t *testing.T, key string) unit.Key {
	t.Helper()
	k, err := unit.ParseKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func (f fixture) accept(t *testing.T, key string, weight unit.Weight, content string) gateway.Decision {
	t.Helper()
	d, err := f.Accept(ctx, submission(t, key, weight, content))
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// setState puts a unit where a test needs it, such as landed: what a human
// does with a pull request is not built yet.
func (f fixture) setState(t *testing.T, key string, state unit.State) {
	t.Helper()
	k, _ := unit.ParseKey(key)
	err := f.db.Change(ctx, k, func(old *unit.Unit) (*unit.Unit, *unit.Event, error) {
		if old == nil {
			return nil, nil, fmt.Errorf("no unit %s", key)
		}
		old.State = state
		return old, nil, nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func (f fixture) queueKeys(t *testing.T) string {
	t.Helper()
	units, err := f.Queue(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var keys []string
	for _, u := range units {
		keys = append(keys, u.Key.Subject)
	}
	return strings.Join(keys, " ")
}

const lodash = "maintenance/tiro/dependencies/lodash"

func TestAcceptByKey(t *testing.T) {
	f := newFixture(t)

	if d := f.accept(t, lodash, unit.High, `{"input": ["A"]}`); d.Outcome != gateway.Accepted || d.Key != lodash {
		t.Fatalf("a new unit: %+v, want accepted", d)
	}
	// The same content again, written differently, is still the same input.
	if d := f.accept(t, lodash, unit.High, `{ "input":["A"] }`); d.Outcome != gateway.Declined {
		t.Errorf("the same input again: %+v, want declined", d)
	}
	if d := f.accept(t, lodash, unit.Critical, `{"input": ["A", "B"]}`); d.Outcome != gateway.Updated {
		t.Errorf("new input while queued: %+v, want updated", d)
	}
	if units, _ := f.Queue(ctx); len(units) != 1 || units[0].Weight != unit.Critical || string(units[0].Content) != `{"input":["A","B"]}` {
		t.Errorf("queue after the update = %+v, want one critical unit with the new content", units)
	}
}

func TestAcceptFollowsTheUnitsState(t *testing.T) {
	for _, tc := range []struct {
		state    unit.State
		same     gateway.Outcome // the same input again
		newInput gateway.Outcome
	}{
		{unit.Queued, gateway.Declined, gateway.Updated},
		{unit.Starting, gateway.Declined, gateway.Declined},
		{unit.Running, gateway.Declined, gateway.Declined},
		{unit.Landing, gateway.Declined, gateway.Accepted},
		{unit.Landed, gateway.Declined, gateway.Accepted},
		{unit.Rejected, gateway.Declined, gateway.Accepted},
		{unit.DeadLetter, gateway.Declined, gateway.Accepted},
	} {
		t.Run(string(tc.state), func(t *testing.T) {
			f := newFixture(t)
			f.accept(t, lodash, unit.High, `{"v": 1}`)
			f.setState(t, lodash, tc.state)

			if d := f.accept(t, lodash, unit.High, `{"v": 1}`); d.Outcome != tc.same || d.Reason == "" {
				t.Errorf("same input: %+v, want %s with a reason", d, tc.same)
			}
			d := f.accept(t, lodash, unit.High, `{"v": 2}`)
			if d.Outcome != tc.newInput {
				t.Errorf("new input: %+v, want %s", d, tc.newInput)
			}
			units, err := f.db.Units(ctx)
			if err != nil || len(units) != 1 {
				t.Fatalf("units %+v, err %v", units, err)
			}
			wantState, wantContent := tc.state, `{"v":1}`
			if d.Outcome != gateway.Declined {
				wantState, wantContent = unit.Queued, `{"v":2}`
			}
			if units[0].State != wantState || string(units[0].Content) != wantContent {
				t.Errorf("stored: %s with %s; want %s with %s", units[0].State, units[0].Content, wantState, wantContent)
			}
		})
	}
}

// A run in progress read the old input. The new input is declined and not
// stored, so it still counts as new once the run has ended.
func TestNewInputDuringARunIsNotLost(t *testing.T) {
	f := newFixture(t)
	f.accept(t, lodash, unit.High, `{"v": 1}`)
	f.setState(t, lodash, unit.Running)
	f.accept(t, lodash, unit.High, `{"v": 2}`)
	f.setState(t, lodash, unit.Landing)

	if d := f.accept(t, lodash, unit.High, `{"v": 2}`); d.Outcome != gateway.Accepted {
		t.Errorf("after the run: %+v, want accepted", d)
	}
}

func TestQueueIsHeaviestFirstThenLongestWaiting(t *testing.T) {
	f := newFixture(t)
	for _, u := range []struct {
		subject string
		weight  unit.Weight
	}{
		{"normal-1", unit.Normal}, {"high-1", unit.High}, {"low-1", unit.Low},
		{"critical-1", unit.Critical}, {"high-2", unit.High}, {"normal-2", unit.Normal},
	} {
		f.accept(t, "maintenance/tiro/dependencies/"+u.subject, u.weight, `{}`)
		f.clock.tick()
	}
	if got, want := f.queueKeys(t), "critical-1 high-1 high-2 normal-1 normal-2 low-1"; got != want {
		t.Errorf("queue = %s\n   want  %s", got, want)
	}

	// New input makes a unit heavier and keeps its place among its new peers
	// by when it joined the queue. A unit that is not queued is not listed.
	f.accept(t, "maintenance/tiro/dependencies/normal-1", unit.High, `{"v": 2}`)
	f.setState(t, "maintenance/tiro/dependencies/critical-1", unit.Running)
	if got, want := f.queueKeys(t), "normal-1 high-1 high-2 normal-2 low-1"; got != want {
		t.Errorf("queue = %s\n   want  %s", got, want)
	}
}

func TestEveryDecisionIsLogged(t *testing.T) {
	f := newFixture(t)
	f.accept(t, lodash, unit.High, `{"v": 1}`)
	f.clock.tick()
	f.accept(t, lodash, unit.High, `{"v": 1}`)
	f.clock.tick()
	f.accept(t, lodash, unit.High, `{"v": 2}`)

	events, err := f.db.Events(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	var kinds []string
	for _, e := range events {
		kinds = append(kinds, e.Kind)
		if e.Key != lodash {
			t.Errorf("event for %s, want %s", e.Key, lodash)
		}
	}
	if got := strings.Join(kinds, " "); got != "accepted declined updated" {
		t.Errorf("events = %s", got)
	}
	if !events[1].At.Equal(events[0].At.Add(time.Minute)) {
		t.Errorf("event times %s, %s: want the clock's time", events[0].At, events[1].At)
	}
	if last, _ := f.db.Events(ctx, 1); len(last) != 1 || last[0].Kind != "updated" {
		t.Errorf("newest event = %+v, want the update", last)
	}
}

func TestContentMustBeAJSONObject(t *testing.T) {
	f := newFixture(t)
	for _, content := range []string{``, `not json`, `[1]`, `null`, `"text"`} {
		if _, err := f.Accept(ctx, submission(t, lodash, unit.Low, content)); err == nil {
			t.Errorf("content %q was accepted", content)
		}
	}
	if units, _ := f.db.Units(ctx); len(units) != 0 {
		t.Errorf("stored %d units, want none", len(units))
	}
}

// Several commands can submit the same unit at once, even before the file
// exists. Exactly one may win, and none may fail.
func TestTheSameUnitSubmittedAtOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "flume.db")
	const submitters = 24
	outcomes := make(chan gateway.Outcome, submitters)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < submitters; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			// Each submitter opens the file itself, as a separate command would.
			db, err := store.Open(ctx, path)
			if err != nil {
				t.Error(err)
				return
			}
			defer db.Close()
			d, err := gateway.New(db, time.Now).Accept(ctx, submission(t, lodash, unit.High, `{"v": 1}`))
			if err != nil {
				t.Error(err)
				return
			}
			outcomes <- d.Outcome
		}()
	}
	close(start)
	wg.Wait()
	close(outcomes)
	counts := map[gateway.Outcome]int{}
	for o := range outcomes {
		counts[o]++
	}
	if counts[gateway.Accepted] != 1 || counts[gateway.Declined] != submitters-1 {
		t.Errorf("outcomes = %v, want 1 accepted and %d declined", counts, submitters-1)
	}
}
