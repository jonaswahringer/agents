package main

import (
	"strings"
	"testing"
)

func TestBranch(t *testing.T) {
	code, out, _ := flume(t, "branch", "maintenance/tiro/dependencies/@types/node")
	if code != 0 || out != "vessel/maintenance/dependencies/@types/node\n" {
		t.Errorf("code %d, out %q", code, out)
	}
	if code, _, errs := flume(t, "branch", "maintenance/tiro/dep"); code != 1 || !strings.Contains(errs, "want <vessel>") {
		t.Errorf("bad key: code %d, stderr %q", code, errs)
	}
}
