// Package store keeps units and their record in one SQLite file. Only the
// server opens it.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite" // the SQLite driver, in pure Go

	"github.com/jonaswahringer/delta-flume/src/internal/unit"
)

// schemaVersion is stored in the file. A file from a newer flume is refused
// instead of being read wrongly.
const schemaVersion = 1

// Times are stored as milliseconds since 1970, UTC. A time that is not set
// is stored as 0.
const schema = `
CREATE TABLE units (
  key           TEXT PRIMARY KEY,
  weight        INTEGER NOT NULL,
  state         TEXT NOT NULL,
  fingerprint   TEXT NOT NULL,
  content       TEXT NOT NULL,
  node          TEXT NOT NULL,
  session       TEXT NOT NULL,
  pr            TEXT NOT NULL,
  failed_starts INTEGER NOT NULL,
  failing_since INTEGER NOT NULL,
  not_before    INTEGER NOT NULL,
  queued_at     INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE TABLE events (
  id     INTEGER PRIMARY KEY,
  at     INTEGER NOT NULL,
  key    TEXT NOT NULL,
  kind   TEXT NOT NULL,
  detail TEXT NOT NULL
);
`

// DB is an open store.
type DB struct{ sql *sql.DB }

// Open opens the store at path and creates the file and its folder if they
// are missing.
func Open(ctx context.Context, path string) (*DB, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	// A command waits up to five seconds for another one to finish. Every
	// transaction takes the write lock when it begins, so what it reads
	// cannot go stale before it writes.
	//
	// The file stays in SQLite's default journal mode. Switching a new file
	// to WAL fails at once with "database is locked" when two commands open
	// it together, and transactions this short gain nothing from WAL.
	options := url.Values{
		"_pragma": {"busy_timeout(5000)"},
		"_txlock": {"immediate"},
	}
	dsn := (&url.URL{Scheme: "file", Path: path, RawQuery: options.Encode()}).String()
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db := &DB{sql: conn}
	if err := db.migrate(ctx); err != nil {
		conn.Close()
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	return db, nil
}

func (db *DB) Close() error { return db.sql.Close() }

// migrate creates the tables in a new file. A file that is already current
// is only read, so a command that lists units never waits for the write lock.
func (db *DB) migrate(ctx context.Context) error {
	version, err := schemaOf(ctx, db.sql)
	if err != nil || version == schemaVersion {
		return err
	}
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Read it again under the write lock: another command may have just
	// created the tables.
	version, err = schemaOf(ctx, tx)
	if err != nil || version == schemaVersion {
		return err
	}
	if _, err := tx.ExecContext(ctx, schema); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", schemaVersion)); err != nil {
		return err
	}
	return tx.Commit()
}

// querier is a connection or a transaction.
type querier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func schemaOf(ctx context.Context, q querier) (int, error) {
	var version int
	if err := q.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return 0, err
	}
	if version > schemaVersion {
		return 0, fmt.Errorf("the file has schema %d and this flume knows %d; use a newer flume", version, schemaVersion)
	}
	return version, nil
}

const unitColumns = "key, weight, state, fingerprint, content, node, session, pr, failed_starts, failing_since, not_before, queued_at, created_at, updated_at"

// Change runs fn in one transaction on the unit stored under key, nil if
// there is none. It saves the unit and appends the event that fn returns;
// either may be nil. If fn fails, nothing is written.
func (db *DB) Change(ctx context.Context, key unit.Key, fn func(old *unit.Unit) (*unit.Unit, *unit.Event, error)) error {
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var old *unit.Unit
	row := tx.QueryRowContext(ctx, "SELECT "+unitColumns+" FROM units WHERE key = ?", key.String())
	switch u, err := scanUnit(row); {
	case errors.Is(err, sql.ErrNoRows):
	case err != nil:
		return err
	default:
		old = &u
	}

	save, event, err := fn(old)
	if err != nil {
		return err
	}
	if save != nil && save.Key != key {
		return fmt.Errorf("change %s: the unit to save has key %s", key, save.Key)
	}
	if err := write(ctx, tx, save, event); err != nil {
		return err
	}
	return tx.Commit()
}

// Pick runs fn in one transaction on every unit in the given states. It
// saves the unit and appends the event that fn returns; either may be nil.
// Two commands that pick at once cannot pick the same unit.
func (db *DB) Pick(ctx context.Context, states []unit.State, fn func(units []unit.Unit) (*unit.Unit, *unit.Event, error)) error {
	tx, err := db.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	units, err := unitsIn(ctx, tx, states)
	if err != nil {
		return err
	}
	save, event, err := fn(units)
	if err != nil {
		return err
	}
	if err := write(ctx, tx, save, event); err != nil {
		return err
	}
	return tx.Commit()
}

func write(ctx context.Context, tx *sql.Tx, save *unit.Unit, event *unit.Event) error {
	if save != nil {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO units (`+unitColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (key) DO UPDATE SET
			  weight = excluded.weight, state = excluded.state, fingerprint = excluded.fingerprint,
			  content = excluded.content, node = excluded.node, session = excluded.session,
			  pr = excluded.pr, failed_starts = excluded.failed_starts,
			  failing_since = excluded.failing_since, not_before = excluded.not_before,
			  queued_at = excluded.queued_at, created_at = excluded.created_at,
			  updated_at = excluded.updated_at`,
			save.Key.String(), int(save.Weight), string(save.State), save.Fingerprint, string(save.Content),
			save.Node, save.Session, save.PR,
			save.FailedStarts, millis(save.FailingSince), millis(save.NotBefore),
			millis(save.Queued), millis(save.Created), millis(save.Updated))
		if err != nil {
			return err
		}
	}
	if event != nil {
		_, err := tx.ExecContext(ctx, "INSERT INTO events (at, key, kind, detail) VALUES (?, ?, ?, ?)",
			millis(event.At), event.Key, event.Kind, event.Detail)
		if err != nil {
			return err
		}
	}
	return nil
}

// Units returns the units in any of the given states, or all of them when no
// state is given, ordered by key.
func (db *DB) Units(ctx context.Context, states ...unit.State) ([]unit.Unit, error) {
	return unitsIn(ctx, db.sql, states)
}

func unitsIn(ctx context.Context, q querier, states []unit.State) ([]unit.Unit, error) {
	query := "SELECT " + unitColumns + " FROM units"
	var args []any
	if len(states) > 0 {
		query += " WHERE state IN (?" + strings.Repeat(", ?", len(states)-1) + ")"
		for _, s := range states {
			args = append(args, string(s))
		}
	}
	rows, err := q.QueryContext(ctx, query+" ORDER BY key", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	units := []unit.Unit{}
	for rows.Next() {
		u, err := scanUnit(rows)
		if err != nil {
			return nil, err
		}
		units = append(units, u)
	}
	return units, rows.Err()
}

// Events returns the newest events, oldest first: at most limit of them, or
// all when limit is 0.
func (db *DB) Events(ctx context.Context, limit int) ([]unit.Event, error) {
	if limit <= 0 {
		limit = -1 // SQLite reads a negative limit as no limit.
	}
	rows, err := db.sql.QueryContext(ctx, `
		SELECT at, key, kind, detail FROM
		  (SELECT id, at, key, kind, detail FROM events ORDER BY id DESC LIMIT ?)
		ORDER BY id`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []unit.Event{}
	for rows.Next() {
		var e unit.Event
		var at int64
		if err := rows.Scan(&at, &e.Key, &e.Kind, &e.Detail); err != nil {
			return nil, err
		}
		e.At = fromMillis(at)
		events = append(events, e)
	}
	return events, rows.Err()
}

func scanUnit(row interface{ Scan(...any) error }) (unit.Unit, error) {
	var (
		u                        unit.Unit
		key, state, content      string
		weight                   int
		failingSince, notBefore  int64
		queued, created, updated int64
	)
	err := row.Scan(&key, &weight, &state, &u.Fingerprint, &content, &u.Node, &u.Session, &u.PR,
		&u.FailedStarts, &failingSince, &notBefore, &queued, &created, &updated)
	if err != nil {
		return unit.Unit{}, err
	}
	parsed, err := unit.ParseKey(key)
	if err != nil {
		return unit.Unit{}, fmt.Errorf("stored unit: %w", err)
	}
	u.Key, u.Weight, u.State, u.Content = parsed, unit.Weight(weight), unit.State(state), []byte(content)
	u.FailingSince, u.NotBefore = fromMillis(failingSince), fromMillis(notBefore)
	u.Queued, u.Created, u.Updated = fromMillis(queued), fromMillis(created), fromMillis(updated)
	return u, nil
}

// millis is a time as it is stored. A time that is not set is 0.
func millis(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UnixMilli()
}

func fromMillis(ms int64) time.Time {
	if ms == 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms).UTC()
}
