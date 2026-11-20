package unit

import (
	"encoding/json"
	"time"
)

// State is where a unit is in its life.
type State string

const (
	// Queued: accepted, waiting to start.
	Queued State = "queued"
	// Starting: a node has been told to start its agent.
	Starting State = "starting"
	// Running: an agent loop is working on it.
	Running State = "running"
	// Landing: its output, such as a PR, waits for a human at Land.
	Landing State = "landing"
	// Landed: a human let the output land.
	Landed State = "landed"
	// Rejected: a human turned the output down.
	Rejected State = "rejected"
	// DeadLetter: stuck or over its ceiling. A human is notified.
	DeadLetter State = "dead-letter"
)

// Unit is one piece of work as the gateway remembers it. There is one per key.
type Unit struct {
	Key    Key    `json:"key"`
	Weight Weight `json:"weight"`
	State  State  `json:"state"`
	// Content is the unit as its trigger submitted it: a JSON object.
	Content json.RawMessage `json:"content"`
	// Fingerprint is the SHA-256 of Content, in hex, taken after Content is
	// rewritten with sorted keys and no spacing. Key order and spacing
	// therefore never change it; any change to a value does.
	Fingerprint string `json:"fingerprint"`
	// Node is the machine that runs the unit, or ran it last. Its session,
	// its branch and its checkout live there.
	Node string `json:"node,omitempty"`
	// Session is the agent session that runs the unit, once it has started:
	// an id in the form the agent provider uses, such as a T3 Code thread.
	Session string `json:"session,omitempty"`
	// PR is the URL of the unit's pull request, once it is open.
	PR string `json:"pr,omitempty"`
	// FailedStarts counts the starts in a row that did not work. A start
	// that works sets it back to 0, and so does new input.
	FailedStarts int `json:"failed_starts,omitempty"`
	// FailingSince is when the first of those starts failed.
	FailingSince time.Time `json:"failing_since,omitzero"`
	// NotBefore is the earliest time the next start may be tried.
	NotBefore time.Time `json:"not_before,omitzero"`
	// Queued is when the unit last entered the queue.
	Queued  time.Time `json:"queued"`
	Created time.Time `json:"created"`
	Updated time.Time `json:"updated"`
}

// Active reports whether the unit takes up room on its node: a node has
// been told to start it, or its agent is running.
func (u Unit) Active() bool { return u.State == Starting || u.State == Running }

// Event is one line of a unit's record: what was decided, and why.
type Event struct {
	At     time.Time `json:"at"`
	Key    string    `json:"key"`
	Kind   string    `json:"kind"`
	Detail string    `json:"detail,omitempty"`
}
