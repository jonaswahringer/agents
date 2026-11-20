// Package agent is the contract between flume and whatever runs a unit's
// agent loop. flume knows a provider only through it, so a provider can be
// replaced without touching the gateway or the commands.
package agent

import "context"

// Job is what a provider needs to start the agent of one unit.
type Job struct {
	// Root is the folder the project lives in, on the machine the provider
	// runs on.
	Root string
	// Base is what the unit's branch starts from, such as main.
	Base string
	// Branch is the unit's branch. The provider creates it, in a checkout of
	// its own, under exactly this name.
	Branch string
	// Title names the session for a human.
	Title string
	// Message is the agent's task.
	Message string
}

// Provider starts agents and reaches the ones it started.
type Provider interface {
	// Start starts an agent on the job. It returns the session's id, in
	// whatever form the provider uses; flume only stores it and hands it
	// back.
	Start(ctx context.Context, job Job) (session string, err error)
	// Send gives a session a new message. The session keeps its branch and
	// its checkout.
	Send(ctx context.Context, session, message string) error
}

// Rules keep an agent from publishing on its own. They are a file in the
// unit's checkout, in the form the agent's own program reads.
type Rules struct {
	// File is where the rules go, relative to the checkout's top folder.
	File string
	// Content is the file's content.
	Content []byte
}
