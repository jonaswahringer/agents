// Package t3 starts a unit's agent loop as a thread in T3 Code, through the
// t3 command.
package t3

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/agent"
	"github.com/jonaswahringer/delta-flume/src/internal/cmdx"
)

// CLI is the t3 command. Path is the binary to run.
type CLI struct{ Path string }

var _ agent.Provider = CLI{}

// limit is how long t3 may take to accept a thread or a message. It answers
// once the server has taken the request, not when the agent is done.
const limit = time.Minute

// run gives t3 the message on stdin, so its length and quoting never matter.
func (c CLI) run(ctx context.Context, dir, message string, args ...string) ([]byte, error) {
	cmd := cmdx.Command(ctx, limit, c.Path, args...)
	cmd.Dir = dir
	cmd.Stdin = strings.NewReader(message)
	return cmd.Output()
}

// Start starts a thread in the job's project. T3 makes a new worktree from
// the base, on a new branch with exactly the job's name, and gives the agent
// the message. The session is the thread's id. T3 prepares the worktree
// after this returns, and refuses a branch that already exists.
func (c CLI) Start(ctx context.Context, job agent.Job) (string, error) {
	out, err := c.run(ctx, job.Root, job.Message,
		"thread", "start", "--worktree", job.Base, "--branch", job.Branch, "--title", job.Title, "--json", job.Root, "-")
	if err != nil {
		return "", err
	}
	var started struct {
		ThreadID string `json:"threadId"`
	}
	if err := json.Unmarshal(out, &started); err != nil || started.ThreadID == "" {
		return "", fmt.Errorf("t3 thread start printed no thread id: %q", out)
	}
	return started.ThreadID, nil
}

// Send gives a thread a new message. A busy thread gets it as its next turn.
func (c CLI) Send(ctx context.Context, thread, message string) error {
	_, err := c.run(ctx, "", message, "thread", "send", "--json", thread, "-")
	return err
}
