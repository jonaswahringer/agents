package main

import (
	"context"
	"errors"
)

var nodeCommand = command{
	name:    "node",
	args:    "[flags] <project>...",
	summary: "Work on units for the project folders, as a server on another machine says.",
	run:     app.runNode,
}

// runNode makes this machine a node of a server that runs elsewhere. It
// keeps asking the server what it should be working on, starts those units'
// agents here, and reports back, until it is told to stop.
func (a app) runNode(ctx context.Context, c command, args []string) int {
	flags, address := a.serverFlags(c)
	settings := nodeFlags(flags)
	if exit, ok := parse(flags, args, len(args)); !ok {
		return exit
	}
	if flags.NArg() == 0 {
		return a.fail(c.name, errors.New("name at least one project folder; a node only gets units of projects it has"))
	}
	projects, err := projectFolders(ctx, flags.Args())
	if err != nil {
		return a.fail(c.name, err)
	}
	run, err := provider(*settings.agent, *settings.t3)
	if err != nil {
		return a.fail(c.name, err)
	}
	srv, err := a.connect(*address)
	if err != nil {
		return a.fail(c.name, err)
	}
	log := &logger{out: a.stderr, now: a.now}
	log.printf("node %s works for the server at %s on %d projects", *settings.name, firstNonEmpty(*address, a.getenv("FLUME_SERVER"), defaultServer), len(projects))
	settings.node(projects, srv, run, log.printf).Run(ctx)
	log.printf("stopped")
	return 0
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
