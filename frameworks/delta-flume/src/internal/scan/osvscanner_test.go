package scan

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeScanner writes a shell script that stands in for osv-scanner.
func fakeScanner(t *testing.T, script string) OSVScanner {
	t.Helper()
	path := filepath.Join(t.TempDir(), "osv-scanner")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+script+"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return OSVScanner{Path: path}
}

func TestReportExitCodes(t *testing.T) {
	ctx := context.Background()

	for _, code := range []string{"0", "1"} {
		out, err := fakeScanner(t, `echo '{"results": []}'; exit `+code).Report(ctx, ".")
		if err != nil || !strings.Contains(string(out), "results") {
			t.Errorf("exit %s: out %q, err %v; want the report", code, out, err)
		}
	}

	if _, err := fakeScanner(t, "exit 128").Report(ctx, "."); !errors.Is(err, ErrNoSources) {
		t.Errorf("exit 128: err %v, want ErrNoSources", err)
	}

	_, err := fakeScanner(t, "echo noise >&2; echo 'network is down' >&2; exit 127").Report(ctx, ".")
	if err == nil || !strings.Contains(err.Error(), "network is down") {
		t.Errorf("exit 127: err %v, want the scanner's last stderr line", err)
	}
}

func TestReportPassesTheDirectory(t *testing.T) {
	out, err := fakeScanner(t, `echo "$@"`).Report(context.Background(), "/work/tiro")
	if err != nil {
		t.Fatal(err)
	}
	if got, want := strings.TrimSpace(string(out)), "scan source --recursive --format json /work/tiro"; got != want {
		t.Errorf("arguments = %q, want %q", got, want)
	}
}

func TestVersion(t *testing.T) {
	ctx := context.Background()

	version, err := fakeScanner(t, "echo 'osv-scanner version: 2.7.1'; echo 'commit: abc'").Version(ctx)
	if err != nil || version != "2.7.1" {
		t.Errorf("version %q, err %v; want 2.7.1", version, err)
	}
	if _, err := fakeScanner(t, "echo 'osv-scanner version: 1.9.2'").Version(ctx); err == nil {
		t.Error("version 1.x must be refused")
	}
	if _, err := (OSVScanner{Path: filepath.Join(t.TempDir(), "missing")}).Version(ctx); err == nil || !strings.Contains(err.Error(), "install") {
		t.Errorf("missing binary: err %v, want an install hint", err)
	}
}
