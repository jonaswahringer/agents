package main

import (
	"slices"
	"strings"
	"testing"
)

func TestHelpListsEveryCommand(t *testing.T) {
	code, out, _ := flume(t, "help")
	if code != 0 {
		t.Fatalf("help: code %d", code)
	}
	seen := map[string]bool{}
	for _, c := range slices.Concat(commands, worktreeCommands) {
		if c.name == "" || c.summary == "" || c.run == nil {
			t.Errorf("command %+v lacks a name, a summary or its function", c)
		}
		if seen[c.name] {
			t.Errorf("two commands are called %s", c.name)
		}
		seen[c.name] = true
		if !strings.Contains(out, "  "+c.synopsis()+" ") || !strings.Contains(out, c.summary) {
			t.Errorf("the help lacks %s:\n%s", c.name, out)
		}
	}
	if len(seen) != 10 {
		t.Errorf("%d commands are listed, want 10: a command file whose command is in neither list is unreachable", len(seen))
	}

	if code, out, errs := flume(t); code != 2 || out != "" || !strings.HasPrefix(errs, "flume runs") {
		t.Errorf("no arguments: code %d, stdout %q", code, out)
	}
	if code, _, errs := flume(t, "nope"); code != 2 || !strings.HasPrefix(errs, `flume: unknown command "nope"`) {
		t.Errorf("unknown command: code %d, stderr %q", code, errs)
	}
}

// Asking a command for help is not a mistake; a flag it does not know is.
func TestEveryCommandExplainsItself(t *testing.T) {
	for _, c := range slices.Concat(commands, worktreeCommands) {
		code, out, errs := flume(t, c.name, "-h")
		if code != 0 || out != "" || !strings.HasPrefix(errs, "usage: "+c.synopsis()+"\n\n"+c.summary+"\n") {
			t.Errorf("%s -h: code %d, stderr %q", c.name, code, errs)
		}
		if code, _, _ := flume(t, c.name, "-no-such-flag"); code != 2 {
			t.Errorf("%s with an unknown flag: code %d, want 2", c.name, code)
		}
	}
	if code, _, errs := flume(t, "branch"); code != 2 || !strings.HasPrefix(errs, "usage: flume branch <key>\n") {
		t.Errorf("branch without a key: code %d, stderr %q", code, errs)
	}
}
