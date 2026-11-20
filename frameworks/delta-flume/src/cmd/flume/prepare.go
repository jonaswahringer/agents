package main

import (
	"context"
	"fmt"

	"github.com/jonaswahringer/delta-flume/src/internal/claudecode"
)

var prepareCommand = command{
	name:    "prepare",
	args:    "[flags]",
	summary: "Write the agent's rules file into a new worktree, before the agent starts.",
	run:     app.runPrepare,
}

// runPrepare writes the agent's rules file into a unit's new worktree. T3
// Code runs it in every new worktree, so on any other branch it does nothing
// and exits 0.
func (a app) runPrepare(ctx context.Context, c command, args []string) int {
	flags, address, gh := a.worktreeFlags(c)
	if exit, ok := parse(flags, args, 0); !ok {
		return exit
	}
	p, r, project, err := a.worktree(ctx, *address, *gh)
	if err != nil {
		return a.fail(c.name, err)
	}
	file, err := p.Prepare(ctx, r, project, claudecode.Rules())
	if err != nil {
		return a.fail(c.name, err)
	}
	if file == "" {
		fmt.Fprintln(a.stderr, "not a unit's branch, so there is nothing to prepare")
		return 0
	}
	fmt.Fprintln(a.stderr, "the agent's rules are in", file)
	return 0
}
