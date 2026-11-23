// Package wire holds what crosses the line between the server and whatever
// calls it: a node, or a command. Everything is JSON over HTTP.
package wire

import (
	"github.com/jonaswahringer/delta-flume/src/internal/unit"
)

// Report is what a node tells the server each time it asks what it should be
// working on.
type Report struct {
	// Node is the node's name. It is how the server tells nodes apart.
	Node string `json:"node"`
	// MaxRunning is how many units the node will work on at once.
	MaxRunning int `json:"max_running"`
	// Projects are the projects the node has a folder for.
	Projects []Project `json:"projects"`
	// Seen is the version of the last answer the node got, 0 before the
	// first. The server answers at once when it has another one.
	Seen int64 `json:"seen"`
	// WaitSeconds is how long the server may hold the question open when it
	// has nothing new.
	WaitSeconds int `json:"wait_seconds"`
	// Sessions is what the node sees of the sessions of the units it runs.
	Sessions []Session `json:"sessions,omitempty"`
}

// Session is what a node sees of the session of a unit it runs. The server
// judges it by its own clock, so times are spans, not dates.
type Session struct {
	Key     unit.Key `json:"key"`
	Session string   `json:"session"`
	// Busy: the agent is working on a turn now.
	Busy bool `json:"busy,omitempty"`
	// Asking: the session waits for a human's answer.
	Asking bool `json:"asking,omitempty"`
	// QuietSeconds is how long ago the session last changed.
	QuietSeconds int64 `json:"quiet_seconds"`
	// Status is the provider's word for the session's state.
	Status string `json:"status,omitempty"`
	// Error says why the node could not look. Then nothing else is known.
	Error string `json:"error,omitempty"`
}

// Project is one project on a node.
type Project struct {
	Name string `json:"name"`
	// Paused names the vessel instances this project has paused, each as
	// <vessel>/<instance>.
	Paused []string `json:"paused,omitempty"`
	// Repo is the project's repository on GitHub, as owner/name, if it has
	// one.
	Repo string `json:"repo,omitempty"`
	// Alerts names the alert channels of each instance that names any, by
	// <vessel>/<instance>.
	Alerts map[string][]string `json:"alerts,omitempty"`
}

// Desired is everything a node should be working on: the units it should
// start, and the ones it started that are still running. It is always the
// whole picture, so an answer that got lost changes nothing.
type Desired struct {
	Version int64       `json:"version"`
	Units   []unit.Unit `json:"units"`
}

// Started says a node started the agent of a unit it was told to start.
type Started struct {
	Key     unit.Key `json:"key"`
	Node    string   `json:"node"`
	Session string   `json:"session"`
}

// NotStarted says a node could not start the agent of a unit.
type NotStarted struct {
	Key    unit.Key `json:"key"`
	Node   string   `json:"node"`
	Reason string   `json:"reason"`
}

// Branch names a branch of a project.
type Branch struct {
	Project string `json:"project"`
	Branch  string `json:"branch"`
}

// Pushed says a unit's agent pushed its branch.
type Pushed struct {
	Key unit.Key `json:"key"`
}

// PullRequest says a unit's pull request is open at URL: opened now, or
// changed.
type PullRequest struct {
	Key    unit.Key `json:"key"`
	URL    string   `json:"url"`
	Opened bool     `json:"opened"`
}

// Error is the body of every answer that is not a success.
type Error struct {
	Error string `json:"error"`
}
