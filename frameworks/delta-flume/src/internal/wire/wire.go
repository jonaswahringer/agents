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
}

// Project is one project on a node.
type Project struct {
	Name string `json:"name"`
	// Paused names the vessel instances this project has paused, each as
	// <vessel>/<instance>.
	Paused []string `json:"paused,omitempty"`
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
