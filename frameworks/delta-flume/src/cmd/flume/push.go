package main

import (
	"context"
	"fmt"
)

var pushCommand = command{
	name:    "push",
	args:    "[flags]",
	summary: "Push the unit's branch, and nothing else.",
	run:     app.runPush,
}

// runPush pushes the checked-out branch if it is a unit's branch.
func (a app) runPush(ctx context.Context, c command, args []string) int {
	flags, address, gh := a.worktreeFlags(c)
	if exit, ok := parse(flags, args, 0); !ok {
		return exit
	}
	p, r, project, err := a.worktree(ctx, *address, *gh)
	if err != nil {
		return a.fail(c.name, err)
	}
	u, err := p.Push(ctx, r, project)
	if err != nil {
		return a.fail(c.name, fmt.Errorf("nothing was pushed: %w", err))
	}
	fmt.Fprintf(a.stderr, "pushed %s for %s\n", u.Key.Branch(), u.Key)
	return 0
}
