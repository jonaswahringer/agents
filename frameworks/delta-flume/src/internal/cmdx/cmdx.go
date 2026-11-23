// Package cmdx runs the other programs flume leans on: git, gh, t3,
// osv-scanner and launchctl. It is the only place that starts a program, so
// every one of them has a time limit and none can make flume hang.
package cmdx

import (
	"context"
	"errors"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// grace is how long a program gets to stop after it was asked to, before it
// is killed. It is also how long Output waits for a program that has ended
// but left a child behind that still holds its output open.
const grace = 3 * time.Second

// Cmd is a program that is ready to run. It is an exec.Cmd: set Dir, Stdin
// or Env on it as on any other, then run it with Output or Run.
type Cmd struct {
	*exec.Cmd
	limit time.Duration
	// parent is the context flume itself runs in; ctx is parent with the
	// program's time limit. Telling them apart tells a program that took too
	// long from a flume that was told to stop.
	parent, ctx context.Context
	stop        context.CancelFunc
}

// Command prepares a program that may take at most limit.
//
// At the limit, or when ctx ends, the program is asked to stop with SIGTERM.
// One that has not stopped a few seconds later is killed, and its output is
// let go of, so the longest wait is the limit plus those seconds.
func Command(ctx context.Context, limit time.Duration, name string, args ...string) *Cmd {
	limited, stop := context.WithTimeout(ctx, limit)
	cmd := exec.CommandContext(limited, name, args...)
	cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGTERM) }
	cmd.WaitDelay = grace
	return &Cmd{Cmd: cmd, limit: limit, parent: ctx, ctx: limited, stop: stop}
}

// Output runs the program and returns what it printed on stdout, also when
// it fails. A failure is an *Error.
func (c *Cmd) Output() ([]byte, error) {
	defer c.stop()
	out, err := c.Cmd.Output()
	// ErrWaitDelay: the program ended well, but something it started still
	// held its output open. What the program printed is complete.
	if err == nil || errors.Is(err, exec.ErrWaitDelay) {
		return out, nil
	}
	failure := &Error{Command: c.name(), Err: err}
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		failure.Stderr = clip(string(exit.Stderr))
	}
	switch {
	case c.parent.Err() != nil:
		failure.Err = c.parent.Err()
	case c.ctx.Err() != nil:
		failure.Err = timeout{c.limit}
	}
	return out, failure
}

// Run is Output for a program whose output does not matter.
func (c *Cmd) Run() error {
	_, err := c.Output()
	return err
}

// name is the program and what it was asked to do, such as "git push".
func (c *Cmd) name() string {
	what := filepath.Base(c.Path)
	if len(c.Args) > 1 && !strings.HasPrefix(c.Args[1], "-") {
		what += " " + c.Args[1]
	}
	return what
}

// Error is a program that did not end well.
type Error struct {
	// Command names the program and what it was asked to do, such as "git push".
	Command string
	// Stderr is what the program wrote to stderr. A long text keeps its
	// start and its end.
	Stderr string
	// Err is why: an *exec.ExitError when the program ran to its end, an
	// error that is context.DeadlineExceeded at the time limit, the context's
	// error when flume was told to stop, or why the program did not start.
	Err error
}

func (e *Error) Error() string {
	_, exited := ExitCode(e.Err)
	oneLine := !strings.Contains(e.Stderr, "\n")
	switch {
	case e.Stderr == "":
		return e.Command + ": " + e.Err.Error()
	case oneLine && exited:
		// The program's own words say more than "exit status 1".
		return e.Command + ": " + e.Stderr
	case oneLine:
		return e.Command + ": " + e.Err.Error() + ": " + e.Stderr
	default:
		return e.Command + ": " + e.Err.Error() + ":\n  " + strings.ReplaceAll(e.Stderr, "\n", "\n  ")
	}
}

func (e *Error) Unwrap() error { return e.Err }

// ExitCode is the code a program exited with. It reports false when err is
// not about a program that ran to its end: one that was stopped or killed,
// or one that never started.
func ExitCode(err error) (code int, ok bool) {
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.Exited() {
		return exit.ExitCode(), true
	}
	return 0, false
}

// timeout is the error of a program that was stopped at its time limit.
type timeout struct{ limit time.Duration }

func (t timeout) Error() string { return "stopped at its time limit of " + t.limit.String() }

func (t timeout) Is(target error) bool { return target == context.DeadlineExceeded }

// kept is how much of a long stderr survives at each end. The cause tends to
// be in the first lines or the last ones.
const kept = 2000

func clip(text string) string {
	text = strings.TrimSpace(text)
	if len(text) > 2*kept {
		text = text[:kept] + "\n[…]\n" + text[len(text)-kept:]
	}
	return strings.ToValidUTF8(text, "")
}
