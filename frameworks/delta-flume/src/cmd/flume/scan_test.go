package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeScanner stands in for osv-scanner: it prints the fixture report from the
// scan package and exits 1, as the real one does when it finds advisories.
func fakeScanner(t *testing.T, scanScript string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "osv-scanner")
	script := "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 'osv-scanner version: 2.7.1'; exit 0; fi\n" + scanScript + "\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestScanPrintsOneFindingPerLine(t *testing.T) {
	report, err := filepath.Abs("../../internal/scan/testdata/report.json")
	if err != nil {
		t.Fatal(err)
	}
	scanner := fakeScanner(t, "cat '"+report+"'; exit 1")

	code, out, errs := flume(t, "scan", "-project", "tiro", "-osv-scanner", scanner, t.TempDir())
	if code != 0 {
		t.Fatalf("code %d, stderr %q", code, errs)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) != 2 ||
		!strings.HasPrefix(lines[0], `{"key":"maintenance/tiro/dependencies/minimist","weight":"critical"`) ||
		!strings.HasPrefix(lines[1], `{"key":"maintenance/tiro/dependencies/lodash","weight":"high"`) {
		t.Errorf("stdout:\n%s", out)
	}
	if want := "tiro: 2 findings: 1 critical, 1 high (osv-scanner 2.7.1)\n"; errs != want {
		t.Errorf("stderr %q, want %q", errs, want)
	}
}

func TestScanWithNothingToScan(t *testing.T) {
	code, out, errs := flume(t, "scan", "-project", "tiro", "-osv-scanner", fakeScanner(t, "exit 128"), t.TempDir())
	if code != 0 || out != "" || !strings.Contains(errs, "nothing was scanned") {
		t.Errorf("code %d, stdout %q, stderr %q", code, out, errs)
	}
}

func TestScanFailsLoudly(t *testing.T) {
	code, out, errs := flume(t, "scan", "-project", "tiro", "-osv-scanner", fakeScanner(t, "echo boom >&2; exit 127"), t.TempDir())
	if code != 1 || out != "" || !strings.Contains(errs, "boom") {
		t.Errorf("code %d, stdout %q, stderr %q", code, out, errs)
	}
}
