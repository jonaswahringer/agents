package main

import (
	"context"
	"fmt"

	"github.com/jonaswahringer/delta-flume/src/internal/unit"
)

var branchCommand = command{
	name:    "branch",
	args:    "<key>",
	summary: "Print the branch a unit's agent may write to.",
	run:     app.runBranch,
}

// runBranch prints the branch that belongs to a key.
func (a app) runBranch(_ context.Context, c command, args []string) int {
	flags := a.flags(c)
	if exit, ok := parse(flags, args, 1); !ok {
		return exit
	}
	if flags.NArg() != 1 {
		flags.Usage()
		return 2
	}
	key, err := unit.ParseKey(flags.Arg(0))
	if err != nil {
		fmt.Fprintln(a.stderr, "flume:", err)
		return 1
	}
	fmt.Fprintln(a.stdout, key.Branch())
	return 0
}
