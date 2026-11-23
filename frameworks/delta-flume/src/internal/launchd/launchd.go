// Package launchd has macOS run a command on a timer for the user. A job is
// a file in ~/Library/LaunchAgents that the launchctl command loads.
package launchd

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/cmdx"
)

// Job is one command that launchd runs on a timer.
type Job struct {
	// Label names the job in launchd, and its file.
	Label string
	// Program is the command and its arguments. launchd does not search PATH
	// for the command, so its path is absolute.
	Program []string
	// Every is the time between two runs.
	Every time.Duration
	// Path is the PATH the command runs with. launchd's own is too short to
	// find git, t3 or node.
	Path string
	// Log is the file that collects what the command prints.
	Log string
}

var labelForm = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

func (j Job) check() error {
	switch {
	case !labelForm.MatchString(j.Label):
		return fmt.Errorf("label %q: use letters, digits, dots, dashes and underscores", j.Label)
	case len(j.Program) == 0 || !filepath.IsAbs(j.Program[0]):
		return fmt.Errorf("the command needs an absolute path, got %q", j.Program)
	case j.Every < time.Minute:
		return fmt.Errorf("every %s is too often: one minute at least", j.Every)
	case j.Every%time.Second != 0:
		return fmt.Errorf("every %s: launchd counts whole seconds", j.Every)
	case !filepath.IsAbs(j.Log):
		return fmt.Errorf("the log needs an absolute path, got %q", j.Log)
	}
	return nil
}

// File is the job as launchd reads it. The job waits for its timer: it does
// not run at the moment it is loaded, nor at login.
func (j Job) File() ([]byte, error) {
	if err := j.check(); err != nil {
		return nil, err
	}
	var b bytes.Buffer
	text := func(tag, value string) {
		b.WriteString("<" + tag + ">")
		xml.EscapeText(&b, []byte(value))
		b.WriteString("</" + tag + ">\n")
	}
	b.WriteString(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
`)
	b.WriteString("\t")
	text("key", "Label")
	b.WriteString("\t")
	text("string", j.Label)
	b.WriteString("\t<key>ProgramArguments</key>\n\t<array>\n")
	for _, arg := range j.Program {
		b.WriteString("\t\t")
		text("string", arg)
	}
	b.WriteString("\t</array>\n")
	fmt.Fprintf(&b, "\t<key>StartInterval</key>\n\t<integer>%d</integer>\n", int(j.Every/time.Second))
	if j.Path != "" {
		b.WriteString("\t<key>EnvironmentVariables</key>\n\t<dict>\n\t\t<key>PATH</key>\n\t\t")
		text("string", j.Path)
		b.WriteString("\t</dict>\n")
	}
	for _, key := range []string{"StandardOutPath", "StandardErrorPath"} {
		b.WriteString("\t")
		text("key", key)
		b.WriteString("\t")
		text("string", j.Log)
	}
	b.WriteString("\t<key>ProcessType</key>\n\t<string>Background</string>\n</dict>\n</plist>\n")
	return b.Bytes(), nil
}

// Agents is the user's set of launchd jobs.
type Agents struct {
	// Dir is where the job files live: ~/Library/LaunchAgents.
	Dir string
	// Launchctl is the binary to run.
	Launchctl string
	// Domain is the user's part of launchd, such as gui/501.
	Domain string
}

// File is where the job with this label has its file.
func (a Agents) File(label string) string {
	return filepath.Join(a.Dir, label+".plist")
}

// Install writes the job's file and loads it. A job that already has the
// label is replaced. It returns the file.
func (a Agents) Install(ctx context.Context, j Job) (file string, err error) {
	data, err := j.File()
	if err != nil {
		return "", err
	}
	if err := a.available(); err != nil {
		return "", err
	}
	if err := os.MkdirAll(a.Dir, 0o755); err != nil {
		return "", err
	}
	// launchd creates the log file, but not the folder it is in.
	if err := os.MkdirAll(filepath.Dir(j.Log), 0o755); err != nil {
		return "", err
	}
	if err := a.unload(ctx, j.Label); err != nil {
		return "", err
	}
	file = a.File(j.Label)
	if err := writeFile(file, data); err != nil {
		return "", err
	}
	if err := a.launchctl(ctx, "bootstrap", a.Domain, file); err != nil {
		return "", fmt.Errorf("%s is written but not loaded: %w", file, err)
	}
	return file, nil
}

// Remove unloads the job and deletes its file. It reports whether there was
// anything to remove.
func (a Agents) Remove(ctx context.Context, label string) (removed bool, err error) {
	if !labelForm.MatchString(label) {
		return false, fmt.Errorf("label %q: use letters, digits, dots, dashes and underscores", label)
	}
	if err := a.available(); err != nil {
		return false, err
	}
	if removed, err = a.loaded(ctx, label); err != nil {
		return false, err
	}
	if err := a.unload(ctx, label); err != nil {
		return false, err
	}
	switch err := os.Remove(a.File(label)); {
	case err == nil:
		return true, nil
	case errors.Is(err, os.ErrNotExist):
		return removed, nil
	default:
		return removed, err
	}
}

// limit is how long one launchctl command may take.
const limit = 15 * time.Second

func (a Agents) launchctl(ctx context.Context, args ...string) error {
	return cmdx.Command(ctx, limit, a.Launchctl, args...).Run()
}

func (a Agents) available() error {
	if _, err := exec.LookPath(a.Launchctl); err != nil {
		return fmt.Errorf("%s not found: a schedule needs macOS's launchd. Elsewhere, run \"flume tick\" from cron or a systemd timer", a.Launchctl)
	}
	return nil
}

// loaded asks launchd whether it holds the job. launchctl print exits with a
// code other than 0 when it does not. No answer at all is an error, not a no.
func (a Agents) loaded(ctx context.Context, label string) (bool, error) {
	err := a.launchctl(ctx, "print", a.Domain+"/"+label)
	if _, exited := cmdx.ExitCode(err); err == nil || exited {
		return err == nil, nil
	}
	return false, err
}

// unload takes the job out of launchd and waits until it is gone: launchd
// refuses to load a label it still holds.
func (a Agents) unload(ctx context.Context, label string) error {
	loaded, err := a.loaded(ctx, label)
	if err != nil || !loaded {
		return err
	}
	if err := a.launchctl(ctx, "bootout", a.Domain+"/"+label); err != nil {
		return err
	}
	for range 50 {
		if loaded, err := a.loaded(ctx, label); err != nil || !loaded {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return fmt.Errorf("launchd still holds %s after 5 seconds", label)
}

// writeFile replaces the file in one step, so launchd never reads half of it.
func writeFile(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".flume-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
