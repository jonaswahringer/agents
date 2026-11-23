package gateway

import (
	"context"
	"fmt"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/unit"
)

// The watcher's times. v0.1 has no estimates, so they are the same for
// every unit.
const (
	// Silent is how long a session may go without a sign of life before the
	// watcher calls it stuck. A node that does not say whether it started a
	// unit gets as long.
	Silent = 20 * time.Minute
	// Ceiling is how long a unit may run.
	Ceiling = 2 * time.Hour
	// raiseAfter is how long a queued unit waits before it gets one level
	// heavier, up to raiseUpTo. Only a human or a trigger makes a unit
	// critical.
	raiseAfter = 24 * time.Hour
	raiseUpTo  = unit.High
)

// Sighting is what a node saw of the session of a unit it runs.
type Sighting struct {
	Key     unit.Key
	Session string
	// Busy: the agent is working on a turn now. That counts as alive.
	Busy bool
	// Asking: the session waits for a human's answer.
	Asking bool
	// Quiet is how long ago the session last changed.
	Quiet time.Duration
	// Status is the provider's word for the session's state.
	Status string
	// Error says why the node could not look. A sighting with one shows no
	// sign of life.
	Error string
}

// Verdict is something the watcher did to a unit, or found about it.
type Verdict struct {
	// Unit is the unit as it now stands.
	Unit unit.Unit
	// Kind is the event's kind, such as "stuck".
	Kind   string
	Detail string
	// Alert: a human must be told.
	Alert bool
}

// Seen records what a node saw of its sessions: when each last showed a
// sign of life, and whether it waits for a human. A session that starts
// waiting for an answer is a verdict to alert on. Sightings of units the
// node does not run, or of another session, are old news and change nothing.
func (g *Gateway) Seen(ctx context.Context, node string, sightings []Sighting) ([]Verdict, error) {
	now := g.now()
	var verdicts []Verdict
	for _, s := range sightings {
		if s.Error != "" {
			continue
		}
		err := g.store.Change(ctx, s.Key, func(old *unit.Unit) (*unit.Unit, *unit.Event, error) {
			if old == nil || old.State != unit.Running || old.Node != node || old.Session != s.Session {
				return nil, nil, nil
			}
			alive := now.Add(-max(s.Quiet, 0))
			if s.Busy {
				alive = now
			}
			changed := false
			if alive.After(old.Alive) {
				old.Alive, changed = alive, true
			}
			var event *unit.Event
			switch {
			case s.Asking && old.Asking.IsZero():
				old.Asking, changed = now, true
				event = &unit.Event{At: now, Key: s.Key.String(), Kind: "asking",
					Detail: fmt.Sprintf("session %s on %s waits for a human's answer", s.Session, node)}
				verdicts = append(verdicts, Verdict{Unit: *old, Kind: event.Kind, Detail: event.Detail, Alert: true})
			case !s.Asking && !old.Asking.IsZero():
				old.Asking, changed = time.Time{}, true
				event = &unit.Event{At: now, Key: s.Key.String(), Kind: "answered",
					Detail: fmt.Sprintf("session %s no longer waits for an answer", s.Session)}
			}
			if !changed {
				return nil, nil, nil
			}
			return old, event, nil
		})
		if err != nil {
			return verdicts, err
		}
	}
	return verdicts, nil
}

// Watch judges every unit by the server's clock:
//
//   - a unit that a node was told to start, and that it has not reported on
//     for Silent, counts as a failed start;
//   - a running unit past its Ceiling becomes a dead letter;
//   - a running unit whose session showed no sign of life for Silent is
//     stuck, and becomes a dead letter, unless it waits for a human's
//     answer;
//   - a queued unit that has waited raiseAfter since it was weighed gets one
//     level heavier.
//
// It returns what it did. Calling it twice does nothing the second time.
func (g *Gateway) Watch(ctx context.Context) ([]Verdict, error) {
	units, err := g.store.Units(ctx, unit.Queued, unit.Starting, unit.Running)
	if err != nil {
		return nil, err
	}
	var verdicts []Verdict
	for _, u := range units {
		var v *Verdict
		switch u.State {
		case unit.Starting:
			v, err = g.unreported(ctx, u)
		case unit.Running:
			v, err = g.judgeRun(ctx, u.Key)
		case unit.Queued:
			v, err = g.raise(ctx, u.Key)
		}
		if err != nil {
			return verdicts, err
		}
		if v != nil {
			verdicts = append(verdicts, *v)
		}
	}
	return verdicts, nil
}

func (g *Gateway) unreported(ctx context.Context, u unit.Unit) (*Verdict, error) {
	if g.now().Sub(u.Updated) < Silent {
		return nil, nil
	}
	reason := fmt.Sprintf("%s did not say whether it started the unit, %s after it was told to", u.Node, span(Silent))
	after, err := g.NotStarted(ctx, u.Key, u.Node, reason)
	if err != nil {
		return nil, err
	}
	kind := "start failed"
	if after.State == unit.DeadLetter {
		kind = "dead letter"
	}
	return &Verdict{Unit: after, Kind: kind, Detail: reason, Alert: after.State == unit.DeadLetter}, nil
}

func (g *Gateway) judgeRun(ctx context.Context, key unit.Key) (*Verdict, error) {
	now := g.now()
	var v *Verdict
	err := g.store.Change(ctx, key, func(old *unit.Unit) (*unit.Unit, *unit.Event, error) {
		if old == nil || old.State != unit.Running {
			return nil, nil, nil
		}
		started := old.Started
		if started.IsZero() {
			// A unit from a file older than the watcher.
			started = old.Updated
		}
		alive := old.Alive
		if alive.Before(started) {
			alive = started
		}
		var kind, detail string
		switch {
		case now.Sub(started) >= Ceiling:
			kind = "over ceiling"
			detail = fmt.Sprintf("session %s on %s has run for %s; the ceiling is %s", old.Session, old.Node, span(now.Sub(started)), span(Ceiling))
		case old.Asking.IsZero() && now.Sub(alive) >= Silent:
			kind = "stuck"
			detail = fmt.Sprintf("session %s on %s showed no sign of life for %s", old.Session, old.Node, span(now.Sub(alive)))
		default:
			return nil, nil, nil
		}
		old.State, old.Asking, old.Updated = unit.DeadLetter, time.Time{}, now
		v = &Verdict{Unit: *old, Kind: kind, Detail: detail + "; now a dead letter", Alert: true}
		return old, &unit.Event{At: now, Key: key.String(), Kind: kind, Detail: v.Detail}, nil
	})
	return v, err
}

func (g *Gateway) raise(ctx context.Context, key unit.Key) (*Verdict, error) {
	now := g.now()
	var v *Verdict
	err := g.store.Change(ctx, key, func(old *unit.Unit) (*unit.Unit, *unit.Event, error) {
		if old == nil || old.State != unit.Queued || old.Weight >= raiseUpTo {
			return nil, nil, nil
		}
		since := old.Queued
		if old.Weighed.After(since) {
			since = old.Weighed
		}
		if now.Sub(since) < raiseAfter {
			return nil, nil, nil
		}
		from := old.Weight
		old.Weight, old.Weighed, old.Updated = from+1, now, now
		detail := fmt.Sprintf("%s → %s: it waited %s", from, old.Weight, span(now.Sub(since)))
		v = &Verdict{Unit: *old, Kind: "weight raised", Detail: detail}
		return old, &unit.Event{At: now, Key: key.String(), Kind: v.Kind, Detail: detail}, nil
	})
	return v, err
}

// Record adds a line to a unit's record without changing the unit.
func (g *Gateway) Record(ctx context.Context, key unit.Key, kind, detail string) error {
	now := g.now()
	return g.store.Change(ctx, key, func(*unit.Unit) (*unit.Unit, *unit.Event, error) {
		return nil, &unit.Event{At: now, Key: key.String(), Kind: kind, Detail: detail}, nil
	})
}
