package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

var prCommand = command{
	name:    "pr",
	args:    "[flags]",
	summary: "Open or update the unit's pull request.",
	run:     app.runPR,
}

// runPR opens or updates the pull request of the checked-out branch if it is
// a unit's branch. It prints the URL on stdout.
func (a app) runPR(ctx context.Context, c command, args []string) int {
	flags, address, gh := a.worktreeFlags(c)
	title := flags.String("title", "", "the pull request's title; needed for a new one")
	bodyFile := flags.String("body-file", "", "file with the description, or - for stdin; needed for a new one")
	base := flags.String("base", "", "branch to merge into (default: the default branch of origin)")
	if exit, ok := parse(flags, args, 0); !ok {
		return exit
	}
	p, r, project, err := a.worktree(ctx, *address, *gh)
	if err != nil {
		return a.fail(c.name, err)
	}

	var body []byte
	switch *bodyFile {
	case "":
	case "-":
		body, err = io.ReadAll(a.stdin)
	default:
		path := *bodyFile
		if !filepath.IsAbs(path) {
			path = filepath.Join(a.dir, path)
		}
		body, err = os.ReadFile(path)
	}
	if err != nil {
		return a.fail(c.name, err)
	}
	url, opened, err := p.PR(ctx, r, r, project, *base, *title, string(body))
	if err != nil {
		return a.fail(c.name, fmt.Errorf("no pull request was opened or changed: %w", err))
	}
	fmt.Fprintln(a.stdout, url)
	if opened {
		fmt.Fprintln(a.stderr, "opened the pull request; the unit now waits at Land")
	} else {
		fmt.Fprintln(a.stderr, "the pull request is open; the unit waits at Land")
	}
	return 0
}
