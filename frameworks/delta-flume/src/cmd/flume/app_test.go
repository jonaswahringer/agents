package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// testNow is the time every test command runs at.
var testNow = time.Date(2026, 11, 20, 9, 0, 0, 0, time.UTC)

func flume(t *testing.T, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	return flumeAt(t, testNow, "", args...)
}

// flumeAt runs one command at a set time with stdin as its input.
func flumeAt(t *testing.T, now time.Time, stdin string, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	return flumeIn(t, ".", now, stdin, args...)
}

// flumeIn runs one command in a folder, as an agent in a worktree would.
func flumeIn(t *testing.T, dir string, now time.Time, stdin string, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	return flumeEnv(t, nil, dir, now, stdin, args...)
}

// flumeEnv runs one command with the given environment variables and no
// others.
func flumeEnv(t *testing.T, env map[string]string, dir string, now time.Time, stdin string, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errs bytes.Buffer
	a := app{
		stdin: strings.NewReader(stdin), stdout: &out, stderr: &errs,
		now:    func() time.Time { return now },
		getenv: func(name string) string { return env[name] },
		dir:    dir,
	}
	code = a.run(context.Background(), args)
	return code, out.String(), errs.String()
}

func TestProjectNameFallsBackToTheDirectory(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "Tiro")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := projectName(context.Background(), dir); got != "tiro" {
		t.Errorf("projectName = %q, want tiro", got)
	}
}
