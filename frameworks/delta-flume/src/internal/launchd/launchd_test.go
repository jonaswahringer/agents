package launchd

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func tickJob() Job {
	return Job{
		Label:   "test.flume",
		Program: []string{"/opt/go/bin/flume", "tick", "-max-running", "1", "/work/tiro & co"},
		Every:   30 * time.Minute,
		Path:    "/opt/go/bin:/usr/bin:/bin",
		Log:     "/home/me/.flume/tick.log",
	}
}

func TestTheJobFile(t *testing.T) {
	data, err := tickJob().File()
	if err != nil {
		t.Fatal(err)
	}
	want := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>test.flume</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/go/bin/flume</string>
		<string>tick</string>
		<string>-max-running</string>
		<string>1</string>
		<string>/work/tiro &amp; co</string>
	</array>
	<key>StartInterval</key>
	<integer>1800</integer>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>/opt/go/bin:/usr/bin:/bin</string>
	</dict>
	<key>StandardOutPath</key>
	<string>/home/me/.flume/tick.log</string>
	<key>StandardErrorPath</key>
	<string>/home/me/.flume/tick.log</string>
	<key>ProcessType</key>
	<string>Background</string>
</dict>
</plist>
`
	if string(data) != want {
		t.Errorf("job file:\n%s\nwant:\n%s", data, want)
	}

	// macOS's own check of the format, where there is one.
	plutil, err := exec.LookPath("plutil")
	if err != nil {
		t.Log("plutil is not installed, so the file was not checked by macOS")
		return
	}
	file := filepath.Join(t.TempDir(), "job.plist")
	if err := os.WriteFile(file, data, 0o644); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command(plutil, "-lint", file).CombinedOutput(); err != nil {
		t.Errorf("plutil -lint: %v\n%s", err, out)
	}
}

func TestAJobThatCannotRunIsRefused(t *testing.T) {
	for name, tc := range map[string]struct {
		change func(*Job)
		want   string
	}{
		"a label with a slash":    {func(j *Job) { j.Label = "../evil" }, "label"},
		"a command found by PATH": {func(j *Job) { j.Program[0] = "flume" }, "absolute path"},
		"no command":              {func(j *Job) { j.Program = nil }, "absolute path"},
		"every ten seconds":       {func(j *Job) { j.Every = 10 * time.Second }, "too often"},
		"half seconds":            {func(j *Job) { j.Every = 90500 * time.Millisecond }, "whole seconds"},
		"a log found by folder":   {func(j *Job) { j.Log = "tick.log" }, "log needs an absolute path"},
	} {
		job := tickJob()
		tc.change(&job)
		if _, err := job.File(); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: error %v, want one about %q", name, err, tc.want)
		}
	}
}

func TestWithoutLaunchctlTheErrorSaysWhatToDo(t *testing.T) {
	agents := Agents{Dir: t.TempDir(), Launchctl: filepath.Join(t.TempDir(), "launchctl"), Domain: "gui/501"}
	_, err := agents.Install(t.Context(), tickJob())
	if err == nil || !strings.Contains(err.Error(), "cron or a systemd timer") {
		t.Errorf("error %v", err)
	}
	if entries, _ := os.ReadDir(agents.Dir); len(entries) != 0 {
		t.Errorf("a job file was written although it cannot be loaded: %v", entries)
	}
}

// A launchctl that dies without an answer does not say "the job is not
// loaded", so nothing is written on its word.
func TestNoAnswerFromLaunchctlIsNotANo(t *testing.T) {
	launchctl := filepath.Join(t.TempDir(), "launchctl")
	if err := os.WriteFile(launchctl, []byte("#!/bin/sh\nkill -KILL $$\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	agents := Agents{Dir: t.TempDir(), Launchctl: launchctl, Domain: "gui/501"}
	job := tickJob()
	job.Log = filepath.Join(t.TempDir(), "tick.log")

	if _, err := agents.Install(t.Context(), job); err == nil || !strings.Contains(err.Error(), "launchctl print") {
		t.Errorf("install: error %v, want one about launchctl print", err)
	}
	if entries, _ := os.ReadDir(agents.Dir); len(entries) != 0 {
		t.Errorf("a job file was written: %v", entries)
	}
	if _, err := agents.Remove(t.Context(), job.Label); err == nil {
		t.Error("remove: no error")
	}
}
