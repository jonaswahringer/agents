package main

import (
	"context"
	"fmt"
	"strings"
	"text/tabwriter"
)

var logCommand = command{
	name:    "log",
	args:    "[flags]",
	summary: "Show what was decided and done, newest last.",
	run:     app.runLog,
}

// runLog shows what the gateway decided, newest last.
func (a app) runLog(ctx context.Context, c command, args []string) int {
	flags, address := a.serverFlags(c)
	limit := flags.Int("n", 20, "how many of the newest decisions to show; 0 shows all")
	if exit, ok := parse(flags, args, 0); !ok {
		return exit
	}
	server, err := a.connect(*address)
	if err != nil {
		return a.fail(c.name, err)
	}
	events, err := server.Events(ctx, *limit)
	if err != nil {
		return a.fail(c.name, err)
	}
	if len(events) == 0 {
		fmt.Fprintln(a.stderr, "the log is empty")
		return 0
	}
	// Times are shown in the clock's zone: local time outside tests.
	zone := a.now().Location()
	table := tabwriter.NewWriter(a.stdout, 0, 0, 2, ' ', 0)
	for _, e := range events {
		line := fmt.Sprintf("%s\t%s\t%s", e.At.In(zone).Format("2006-01-02 15:04:05"), e.Kind, e.Key)
		if e.Detail != "" {
			// A detail can be several lines, such as what git wrote when a
			// push failed. The log keeps one line per event.
			line += "\t" + strings.Join(strings.Fields(e.Detail), " ")
		}
		fmt.Fprintln(table, line)
	}
	if err := table.Flush(); err != nil {
		return a.fail(c.name, err)
	}
	return 0
}
