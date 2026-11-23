package cmdx

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// sh prepares a shell script as the program, with a short grace so a test
// about a stuck program does not take seconds.
func sh(ctx context.Context, limit time.Duration, script string) *Cmd {
	cmd := Command(ctx, limit, "/bin/sh", "-c", script)
	cmd.WaitDelay = 200 * time.Millisecond
	return cmd
}

func TestOutputIsWhatTheProgramPrinted(t *testing.T) {
	dir := t.TempDir()
	cmd := sh(t.Context(), time.Minute, `cat; echo " in $(basename "$PWD")"`)
	cmd.Dir = dir
	cmd.Stdin = strings.NewReader("hello")
	out, err := cmd.Output()
	if want := "hello in " + filepath.Base(dir) + "\n"; err != nil || string(out) != want {
		t.Errorf("output %q, error %v, want %q", out, err, want)
	}
}

func TestAFailureKeepsTheExitCodeAndAllOfStderr(t *testing.T) {
	out, err := sh(t.Context(), time.Minute, `echo partial; echo ' ! [rejected] main' >&2; echo 'hint: see the help' >&2; exit 3`).Output()
	if string(out) != "partial\n" {
		t.Errorf("stdout %q: what was printed before the failure is lost", out)
	}
	if code, ok := ExitCode(err); !ok || code != 3 {
		t.Errorf("exit code %d, %v, want 3", code, ok)
	}
	if want := "sh: exit status 3:\n  ! [rejected] main\n  hint: see the help"; err == nil || err.Error() != want {
		t.Errorf("error %q, want %q", err, want)
	}
	var failure *Error
	if !errors.As(err, &failure) || failure.Stderr != "! [rejected] main\nhint: see the help" {
		t.Errorf("error %#v", err)
	}
}

func TestAOneLineFailureReadsAsOneLine(t *testing.T) {
	err := Command(t.Context(), time.Minute, "/bin/sh", "push", "-c", "ignored").Run()
	// sh fails to open a script called push; what matters is the shape.
	if err == nil || !strings.HasPrefix(err.Error(), "sh push: ") || strings.Contains(err.Error(), "\n") || strings.Contains(err.Error(), "exit status") {
		t.Errorf("error %q, want one line that starts with the command and carries no exit status", err)
	}
	err = sh(t.Context(), time.Minute, "exit 4").Run()
	if err == nil || err.Error() != "sh: exit status 4" {
		t.Errorf("a failure without stderr: %q", err)
	}
}

func TestALongStderrKeepsItsStartAndItsEnd(t *testing.T) {
	err := sh(t.Context(), time.Minute, `echo first-line >&2; i=0; while [ $i -lt 400 ]; do echo "filler line number $i of the scanner's log" >&2; i=$((i+1)); done; echo last-line >&2; exit 1`).Run()
	var failure *Error
	if !errors.As(err, &failure) {
		t.Fatalf("error %v", err)
	}
	if !strings.HasPrefix(failure.Stderr, "first-line\n") || !strings.HasSuffix(failure.Stderr, "\nlast-line") || len(failure.Stderr) > 2*kept+10 {
		t.Errorf("stderr is %d bytes: %.60q … %.60q", len(failure.Stderr), failure.Stderr, failure.Stderr[len(failure.Stderr)-60:])
	}
}

func TestAProgramThatHangsIsStoppedAtItsLimit(t *testing.T) {
	start := time.Now()
	err := sh(t.Context(), 300*time.Millisecond, `echo 'waiting for a password' >&2; sleep 30`).Run()
	if took := time.Since(start); took > 5*time.Second {
		t.Errorf("it took %s to give up on a program with a limit of 300ms", took)
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("error %v, want one that is context.DeadlineExceeded", err)
	}
	if _, ok := ExitCode(err); ok {
		t.Errorf("a stopped program has no exit code of its own: %v", err)
	}
	if want := "sh: stopped at its time limit of 300ms: waiting for a password"; err == nil || err.Error() != want {
		t.Errorf("error %q, want %q", err, want)
	}
}

// A program that ignores the request to stop is killed. One that leaves a
// child behind, which holds the output open, does not hold flume either.
func TestAProgramThatWillNotStopIsKilled(t *testing.T) {
	start := time.Now()
	err := sh(t.Context(), 300*time.Millisecond, `trap '' TERM; sleep 4; sleep 4`).Run()
	if took := time.Since(start); took > 3*time.Second {
		t.Errorf("it took %s; the program was not killed, or its child held the output", took)
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("error %v, want one that is context.DeadlineExceeded", err)
	}
}

func TestAChildLeftBehindDoesNotHoldASuccessfulProgram(t *testing.T) {
	start := time.Now()
	out, err := sh(t.Context(), time.Minute, `sleep 4 & echo done`).Output()
	if took := time.Since(start); took > 3*time.Second {
		t.Errorf("it took %s: the child that was left behind held the output", took)
	}
	if err != nil || string(out) != "done\n" {
		t.Errorf("output %q, error %v", out, err)
	}
}

func TestWhenFlumeIsToldToStopTheErrorSaysSo(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	time.AfterFunc(200*time.Millisecond, cancel)
	start := time.Now()
	err := sh(ctx, time.Minute, `sleep 30`).Run()
	if took := time.Since(start); took > 5*time.Second {
		t.Errorf("it took %s to stop", took)
	}
	if !errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("error %v, want context.Canceled and not a time limit", err)
	}
}

func TestAProgramThatIsNotInstalled(t *testing.T) {
	out, err := Command(t.Context(), time.Minute, "no-such-program-for-flume", "push").Output()
	if len(out) != 0 || !errors.Is(err, exec.ErrNotFound) || !strings.HasPrefix(err.Error(), "no-such-program-for-flume push: ") {
		t.Errorf("output %q, error %v", out, err)
	}
	if _, ok := ExitCode(err); ok {
		t.Errorf("a program that never started has no exit code: %v", err)
	}
}

// Every program flume runs has to go through this package, or it has no
// time limit.
func TestNothingElseStartsAProgram(t *testing.T) {
	root := filepath.Join("..", "..")
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		if filepath.Dir(path) == filepath.Join(root, "internal", "cmdx") {
			return nil
		}
		source, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, call := range []string{"exec.Command(", "exec.CommandContext(", "os.StartProcess("} {
			if strings.Contains(string(source), call) {
				t.Errorf("%s calls %s: use cmdx.Command, which sets a time limit", path, strings.TrimSuffix(call, "("))
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
