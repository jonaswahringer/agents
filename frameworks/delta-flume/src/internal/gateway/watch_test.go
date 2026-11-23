package gateway_test

import (
	"strings"
	"testing"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/gateway"
	"github.com/jonaswahringer/delta-flume/src/internal/unit"
)

const watched = "maintenance/tiro/dependencies/lodash"

// running puts lodash in the queue, has mini start it in session s1, and
// returns its key.
func (f fixture) running(t *testing.T) unit.Key {
	t.Helper()
	f.accept(t, watched, unit.High, `{}`)
	if u, _, err := f.Assign(ctx, node("mini", 1)); err != nil || u == nil {
		t.Fatalf("assign: %v, %v", u, err)
	}
	key := mustKey(t, watched)
	if err := f.Started(ctx, key, "mini", "s1"); err != nil {
		t.Fatal(err)
	}
	return key
}

func (f fixture) unit(t *testing.T) unit.Unit {
	t.Helper()
	units, err := f.db.Units(ctx)
	if err != nil || len(units) != 1 {
		t.Fatalf("units = %+v, err %v", units, err)
	}
	return units[0]
}

func (f fixture) watch(t *testing.T) []gateway.Verdict {
	t.Helper()
	verdicts, err := f.Watch(ctx)
	if err != nil {
		t.Fatal(err)
	}
	return verdicts
}

func kinds(verdicts []gateway.Verdict) string {
	var parts []string
	for _, v := range verdicts {
		parts = append(parts, v.Kind)
	}
	return strings.Join(parts, " ")
}

func TestASilentSessionIsStuck(t *testing.T) {
	f := newFixture(t)
	key := f.running(t)

	// Signs of life keep it running: the session changed 2 minutes ago.
	f.clock.at = f.clock.at.Add(15 * time.Minute)
	if _, err := f.Seen(ctx, "mini", []gateway.Sighting{{Key: key, Session: "s1", Quiet: 2 * time.Minute}}); err != nil {
		t.Fatal(err)
	}
	f.clock.at = f.clock.at.Add(15 * time.Minute)
	if v := f.watch(t); len(v) != 0 {
		t.Fatalf("17 minutes after the last sign of life: %s, want nothing", kinds(v))
	}
	// A sighting the node could not make, or of another session, is no sign
	// of life.
	f.Seen(ctx, "mini", []gateway.Sighting{{Key: key, Session: "s1", Error: "t3 is down"}, {Key: key, Session: "old", Busy: true}})

	f.clock.at = f.clock.at.Add(3 * time.Minute)
	v := f.watch(t)
	if kinds(v) != "stuck" || !v[0].Alert || v[0].Unit.State != unit.DeadLetter || !strings.Contains(v[0].Detail, "no sign of life for 20m") {
		t.Fatalf("20 minutes after the last sign of life: %+v, want stuck, a dead letter, an alert", v)
	}
	if v := f.watch(t); len(v) != 0 {
		t.Errorf("watching again: %s, want nothing", kinds(v))
	}
}

func TestABusySessionIsAliveUntilItsCeiling(t *testing.T) {
	f := newFixture(t)
	key := f.running(t)
	for range 11 {
		f.clock.at = f.clock.at.Add(10 * time.Minute)
		f.Seen(ctx, "mini", []gateway.Sighting{{Key: key, Session: "s1", Busy: true, Quiet: time.Hour}})
		if v := f.watch(t); len(v) != 0 {
			t.Fatalf("busy at %s: %s, want nothing", f.clock.at.Format("15:04"), kinds(v))
		}
	}
	f.clock.at = f.clock.at.Add(10 * time.Minute)
	v := f.watch(t)
	if kinds(v) != "over ceiling" || !v[0].Alert || v[0].Unit.State != unit.DeadLetter || !strings.Contains(v[0].Detail, "run for 2h") {
		t.Fatalf("after 2 hours: %+v, want over ceiling", v)
	}
}

// A session that waits for a human is not stuck, and a human is told once.
func TestASessionThatAsksIsAlertedOnce(t *testing.T) {
	f := newFixture(t)
	key := f.running(t)
	asking := []gateway.Sighting{{Key: key, Session: "s1", Asking: true, Quiet: time.Minute}}
	v, err := f.Seen(ctx, "mini", asking)
	if err != nil || kinds(v) != "asking" || !v[0].Alert {
		t.Fatalf("first sighting: %+v, %v; want an alert", v, err)
	}
	if v, _ := f.Seen(ctx, "mini", asking); len(v) != 0 {
		t.Errorf("second sighting: %s, want nothing new", kinds(v))
	}
	f.clock.at = f.clock.at.Add(time.Hour)
	if v := f.watch(t); len(v) != 0 {
		t.Errorf("an hour of waiting for an answer: %s, want nothing", kinds(v))
	}

	// Answered, the silence counts again, from the last sign of life.
	f.Seen(ctx, "mini", []gateway.Sighting{{Key: key, Session: "s1", Quiet: 30 * time.Minute}})
	if f.unit(t).Asking.IsZero() != true {
		t.Error("the unit still waits for an answer")
	}
	if v := f.watch(t); kinds(v) != "stuck" {
		t.Errorf("answered, then silent for 30m: %s, want stuck", kinds(v))
	}
}

// A node told to start a unit that never says what came of it has failed
// the start, and the unit waits for its next try.
func TestAStartNobodyReportsFails(t *testing.T) {
	f := newFixture(t)
	f.accept(t, watched, unit.High, `{}`)
	f.Assign(ctx, node("mini", 1))
	f.clock.at = f.clock.at.Add(19 * time.Minute)
	if v := f.watch(t); len(v) != 0 {
		t.Fatalf("after 19 minutes: %s, want nothing", kinds(v))
	}
	f.clock.at = f.clock.at.Add(time.Minute)
	v := f.watch(t)
	if kinds(v) != "start failed" || v[0].Alert || v[0].Unit.State != unit.Queued || v[0].Unit.FailedStarts != 1 {
		t.Fatalf("after 20 minutes: %+v, want a failed start", v)
	}
}

func TestAWaitingUnitGetsHeavier(t *testing.T) {
	f := newFixture(t)
	f.accept(t, watched, unit.None, `{}`)
	steps := []unit.Weight{unit.Low, unit.Normal, unit.High, unit.High}
	for _, want := range steps {
		f.clock.at = f.clock.at.Add(23 * time.Hour)
		if v := f.watch(t); len(v) != 0 {
			t.Fatalf("after 23 hours: %s, want nothing", kinds(v))
		}
		f.clock.at = f.clock.at.Add(time.Hour)
		f.watch(t)
		if got := f.unit(t).Weight; got != want {
			t.Fatalf("weight %s, want %s", got, want)
		}
	}
	// New input is weighed again, and waits a day from then.
	f.accept(t, watched, unit.Low, `{"new":1}`)
	f.clock.at = f.clock.at.Add(23 * time.Hour)
	f.watch(t)
	if got := f.unit(t).Weight; got != unit.Low {
		t.Errorf("weight %s, want low", got)
	}
}
