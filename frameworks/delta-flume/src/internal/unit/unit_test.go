package unit

import (
	"os/exec"
	"testing"
)

func TestParseKeyRoundTrips(t *testing.T) {
	for _, s := range []string{
		"maintenance/tiro/dependencies/lodash",
		"maintenance/tiro/dependencies/@types/node",
		"maintenance/delta-flume/dependencies/github.com/BurntSushi/toml",
		"maintenance/tiro/doc/docs/setup.md",
	} {
		k, err := ParseKey(s)
		if err != nil {
			t.Errorf("ParseKey(%q): %v", s, err)
			continue
		}
		if got := k.String(); got != s {
			t.Errorf("ParseKey(%q).String() = %q", s, got)
		}
	}
}

func TestParseKeyRejects(t *testing.T) {
	for _, s := range []string{
		"",
		"maintenance/tiro/dep",
		"maintenance/tiro/dependencies/",
		"Maintenance/tiro/dependencies/lodash",
		"maintenance//dependencies/lodash",
		"maintenance/tiro/dependencies/a//b",
		"maintenance/tiro/dependencies/lodash/",
		"maintenance/tiro/dependencies/lo dash",
		"maintenance/tiro/dependencies/lo\tdash",
	} {
		if k, err := ParseKey(s); err == nil {
			t.Errorf("ParseKey(%q) = %+v, want an error", s, k)
		}
	}
}

func TestBranch(t *testing.T) {
	for _, tc := range []struct{ key, want string }{
		{"maintenance/tiro/dependencies/lodash", "vessel/maintenance/dependencies/lodash"},
		{"maintenance/tiro/dependencies/@types/node", "vessel/maintenance/dependencies/@types/node"},
		{"maintenance/tiro/dependencies/github.com/BurntSushi/toml", "vessel/maintenance/dependencies/github.com/BurntSushi/toml"},
		{"maintenance/tiro/dependencies/org.apache:commons", "vessel/maintenance/dependencies/org.apache-commons"},
		{"maintenance/tiro/doc/.github/a..b", "vessel/maintenance/doc/-github/a.-b"},
		{"maintenance/tiro/dependencies/yarn.lock", "vessel/maintenance/dependencies/yarn.lock-"},
		{"maintenance/tiro/dependencies/trailing.", "vessel/maintenance/dependencies/trailing-"},
		{"maintenance/tiro/dependencies/a@{b}~^:?*[\\", "vessel/maintenance/dependencies/a@-b--------"},
	} {
		k, err := ParseKey(tc.key)
		if err != nil {
			t.Fatalf("ParseKey(%q): %v", tc.key, err)
		}
		got := k.Branch()
		if got != tc.want {
			t.Errorf("Branch of %q = %q, want %q", tc.key, got, tc.want)
		}
		checkRefFormat(t, got)
	}
}

// checkRefFormat asks git itself whether the branch name is legal, so the
// rules in refPart cannot drift from git's.
func checkRefFormat(t *testing.T, branch string) {
	t.Helper()
	git, err := exec.LookPath("git")
	if err != nil {
		t.Skip("git is not installed")
	}
	if out, err := exec.Command(git, "check-ref-format", "--branch", branch).CombinedOutput(); err != nil {
		t.Errorf("git rejects branch %q: %v %s", branch, err, out)
	}
}

func TestWeight(t *testing.T) {
	for _, s := range []string{"low", "normal", "high", "critical"} {
		w, err := ParseWeight(s)
		if err != nil {
			t.Fatalf("ParseWeight(%q): %v", s, err)
		}
		if w.String() != s {
			t.Errorf("ParseWeight(%q).String() = %q", s, w.String())
		}
	}
	if !(Low < Normal && Normal < High && High < Critical) {
		t.Error("weights must sort from low to critical")
	}
	if _, err := ParseWeight("urgent"); err == nil {
		t.Error(`ParseWeight("urgent") must fail`)
	}
}
