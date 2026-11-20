package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"github.com/jonaswahringer/delta-flume/src/internal/scan"
	"github.com/jonaswahringer/delta-flume/src/internal/unit"
)

var scanCommand = command{
	name:    "scan",
	args:    "[flags] [dir]",
	summary: "Print a project's security findings, one JSON object per line.",
	run:     app.runScan,
}

// runScan prints findings on stdout and a one-line summary on stderr. Findings
// are data, not a failure, so it exits 0 whether or not it found any.
func (a app) runScan(ctx context.Context, c command, args []string) int {
	stdout, stderr := a.stdout, a.stderr
	flags := a.flags(c)
	project := flags.String("project", "", "project name in the keys (default: the git remote's repository name, else the directory name)")
	instance := flags.String("instance", "dependencies", "the project's instance of the maintenance vessel that keeps its dependencies; its name goes into the keys")
	scanner := flags.String("osv-scanner", "osv-scanner", "osv-scanner binary to run")
	if exit, ok := parse(flags, args, 1); !ok {
		return exit
	}
	dir := "."
	if flags.NArg() == 1 {
		dir = flags.Arg(0)
	}

	fail := func(err error) int {
		fmt.Fprintln(stderr, "flume scan:", err)
		return 1
	}

	osv := scan.OSVScanner{Path: *scanner}
	version, err := osv.Version(ctx)
	if err != nil {
		return fail(err)
	}
	name, findings, err := scanProject(ctx, osv, dir, *project, *instance)
	if errors.Is(err, scan.ErrNoSources) {
		fmt.Fprintf(stderr, "%s: %s\n", name, nothingScanned)
		return 0
	}
	if err != nil {
		return fail(err)
	}
	if err := writeFindings(stdout, findings); err != nil {
		return fail(err)
	}
	fmt.Fprintf(stderr, "%s: %s (osv-scanner %s)\n", name, summary(findings), version)
	return 0
}

const nothingScanned = "no lockfile or manifest found, so nothing was scanned"

// scanProject scans the project in dir. It returns the project's name as the
// keys spell it, which project overrides, and the findings of its instance.
func scanProject(ctx context.Context, osv scan.OSVScanner, dir, project, instance string) (name string, findings []scan.Finding, err error) {
	// The scanner reports resolved paths, so resolve the root the same way.
	root, err := filepath.Abs(dir)
	if err == nil {
		root, err = filepath.EvalSymlinks(root)
	}
	if err != nil {
		return "", nil, err
	}
	name = project
	if name == "" {
		name = projectName(ctx, root)
	}
	report, err := osv.Report(ctx, root)
	if err != nil {
		return name, nil, err
	}
	findings, err = scan.Findings(report, name, instance, root)
	return name, findings, err
}

// writeFindings prints one finding per line, the form "flume submit" reads.
func writeFindings(w io.Writer, findings []scan.Finding) error {
	out := json.NewEncoder(w)
	out.SetEscapeHTML(false)
	for _, finding := range findings {
		if err := out.Encode(finding); err != nil {
			return err
		}
	}
	return nil
}

func summary(findings []scan.Finding) string {
	if len(findings) == 0 {
		return "no findings"
	}
	counts := map[unit.Weight]int{}
	malicious := 0
	for _, f := range findings {
		counts[f.Weight]++
		if f.Malicious() {
			malicious++
		}
	}
	var parts []string
	for w := unit.Critical; w >= unit.Low; w-- {
		if counts[w] > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", counts[w], w))
		}
	}
	noun := "findings"
	if len(findings) == 1 {
		noun = "finding"
	}
	text := fmt.Sprintf("%d %s: %s", len(findings), noun, strings.Join(parts, ", "))
	if malicious > 0 {
		text += fmt.Sprintf("; %d malicious", malicious)
	}
	return text
}
