package scan

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/cmdx"
)

// OSVScanner runs Google's osv-scanner, which reads a project's lockfiles and
// asks OSV.dev for advisories. flume reads its JSON and nothing else.
type OSVScanner struct {
	// Path is the binary to run. A bare name is looked up on PATH.
	Path string
}

// SupportedMajor is the osv-scanner major version whose JSON flume reads.
const SupportedMajor = "2"

const installHint = "install it with `go install github.com/google/osv-scanner/v2/cmd/osv-scanner@v2.7.1` and put the Go bin folder on PATH, or see https://google.github.io/osv-scanner/installation/"

const (
	versionLimit = 15 * time.Second
	// scanLimit is how long one project's scan may take. The scanner asks
	// OSV.dev about every package it finds.
	scanLimit = 5 * time.Minute
)

// ErrNoSources means the scanned directory holds no lockfile or manifest.
var ErrNoSources = errors.New("no lockfile or manifest found")

// Version returns the scanner's version, such as "2.7.1", and fails when its
// major version is not the one flume reads.
func (o OSVScanner) Version(ctx context.Context) (string, error) {
	out, err := cmdx.Command(ctx, versionLimit, o.Path, "--version").Output()
	if err != nil {
		return "", fmt.Errorf("%w; %s", err, installHint)
	}
	const prefix = "osv-scanner version:"
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		version := strings.TrimSpace(strings.TrimPrefix(line, prefix))
		if major, _, _ := strings.Cut(version, "."); major != SupportedMajor {
			return "", fmt.Errorf("osv-scanner %s is not supported: flume reads version %s.x; %s", version, SupportedMajor, installHint)
		}
		return version, nil
	}
	return "", fmt.Errorf("%s --version printed no version", o.Path)
}

// Report scans dir and its subdirectories and returns the scanner's JSON
// report. It returns ErrNoSources when there is nothing to scan.
func (o OSVScanner) Report(ctx context.Context, dir string) ([]byte, error) {
	out, err := cmdx.Command(ctx, scanLimit, o.Path, "scan", "source", "--recursive", "--format", "json", dir).Output()

	// osv-scanner exits 0 with no advisories, 1 with advisories, and 128 when
	// it finds nothing to scan. Anything else is a failure.
	switch code, exited := cmdx.ExitCode(err); {
	case err == nil, exited && code == 1:
		return out, nil
	case exited && code == 128:
		return nil, ErrNoSources
	default:
		return nil, err
	}
}
