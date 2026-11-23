package alert

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jonaswahringer/delta-flume/src/internal/unit"
)

func TestGitHubIssue(t *testing.T) {
	dir := t.TempDir()
	log := filepath.Join(dir, "log")
	gh := filepath.Join(dir, "gh")
	os.WriteFile(gh, []byte("#!/bin/sh\nprintf '%s\\n' \"$@\" > '"+log+"'\necho https://github.test/o/tiro/issues/3\n"), 0o755)
	key, _ := unit.ParseKey("maintenance/tiro/dependencies/lodash")
	a := Alert{Key: key, Weight: unit.High, Kind: "stuck", Text: "session s1 on mini showed no sign of life for 20m"}

	where, err := GitHubIssue{GH: gh}.Send(t.Context(), Target{Repo: "o/tiro"}, a)
	if err != nil || where != "https://github.test/o/tiro/issues/3" {
		t.Fatalf("send: %q, %v", where, err)
	}
	args, _ := os.ReadFile(log)
	for _, want := range []string{"issue\ncreate\n--repo\no/tiro\n", "--title\nflume: maintenance/tiro/dependencies/lodash is stuck\n", "no sign of life for 20m", "Weight: high"} {
		if !strings.Contains(string(args), want) {
			t.Errorf("gh got:\n%s\nwant %q in it", args, want)
		}
	}
	if _, err := (GitHubIssue{GH: gh}).Send(t.Context(), Target{}, a); err == nil {
		t.Error("a project with no known repository must fail")
	}
}
