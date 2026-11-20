package store

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/unit"
)

var ctx = context.Background()

func sample(t *testing.T) unit.Unit {
	t.Helper()
	key, err := unit.ParseKey("maintenance/tiro/dependencies/@types/node")
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 11, 20, 9, 0, 0, 0, time.UTC)
	return unit.Unit{
		Key: key, Weight: unit.High, State: unit.Queued,
		Content: []byte(`{"a":1}`), Fingerprint: "abc",
		Node: "mini", Session: "thread-1", PR: "https://example.test/pr/1",
		FailedStarts: 2, FailingSince: at.Add(-2 * time.Minute), NotBefore: at.Add(4 * time.Minute),
		Queued: at, Created: at.Add(-time.Hour), Updated: at.Add(time.Second),
	}
}

func TestAUnitSurvivesClosingTheFile(t *testing.T) {
	// A folder that does not exist yet, with a space and a question mark.
	path := filepath.Join(t.TempDir(), "new folder", "what?.db")
	want := sample(t)

	db, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	err = db.Change(ctx, want.Key, func(old *unit.Unit) (*unit.Unit, *unit.Event, error) {
		if old != nil {
			t.Errorf("a new file already holds %+v", old)
		}
		return &want, &unit.Event{At: want.Queued, Key: want.Key.String(), Kind: "accepted", Detail: "why"}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("the file is not where it was asked for: %v", err)
	}

	db, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	units, err := db.Units(ctx)
	if err != nil || len(units) != 1 || !reflect.DeepEqual(units[0], want) {
		t.Errorf("units = %+v, err %v\nwant %+v", units, err, want)
	}
	events, err := db.Events(ctx, 0)
	wantEvent := unit.Event{At: want.Queued, Key: want.Key.String(), Kind: "accepted", Detail: "why"}
	if err != nil || len(events) != 1 || events[0] != wantEvent {
		t.Errorf("events = %+v, err %v", events, err)
	}
	if queued, _ := db.Units(ctx, unit.Queued, unit.Running); len(queued) != 1 {
		t.Errorf("queued or running = %d units, want 1", len(queued))
	}
	if landed, _ := db.Units(ctx, unit.Landed); len(landed) != 0 {
		t.Errorf("landed = %d units, want 0", len(landed))
	}
}

func TestAFailedChangeWritesNothing(t *testing.T) {
	db, err := Open(ctx, filepath.Join(t.TempDir(), "flume.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	u := sample(t)
	boom := errors.New("boom")

	err = db.Change(ctx, u.Key, func(*unit.Unit) (*unit.Unit, *unit.Event, error) {
		return &u, &unit.Event{Key: u.Key.String(), Kind: "accepted"}, boom
	})
	if !errors.Is(err, boom) {
		t.Errorf("err = %v, want boom", err)
	}
	other := u
	other.Key.Subject = "lodash"
	err = db.Change(ctx, u.Key, func(*unit.Unit) (*unit.Unit, *unit.Event, error) {
		return &other, &unit.Event{Key: u.Key.String(), Kind: "accepted"}, nil
	})
	if err == nil {
		t.Error("saving a unit under another unit's key must fail")
	}
	units, _ := db.Units(ctx)
	events, _ := db.Events(ctx, 0)
	if len(units) != 0 || len(events) != 0 {
		t.Errorf("stored %d units and %d events, want none", len(units), len(events))
	}
}

func TestAFileFromANewerFlumeIsRefused(t *testing.T) {
	path := filepath.Join(t.TempDir(), "flume.db")
	db, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()

	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec("PRAGMA user_version = 99"); err != nil {
		t.Fatal(err)
	}
	raw.Close()

	if _, err := Open(ctx, path); err == nil || !strings.Contains(err.Error(), "newer flume") {
		t.Errorf("err = %v, want a refusal that names a newer flume", err)
	}
}
