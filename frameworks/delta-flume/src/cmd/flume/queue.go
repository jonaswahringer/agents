package main

import (
	"context"
	"fmt"
	"text/tabwriter"
	"time"
)

var queueCommand = command{
	name:    "queue",
	args:    "[flags]",
	summary: "List the units waiting to start, in start order.",
	run:     app.runQueue,
}

// runQueue lists the units waiting to start, in start order. With -all it
// lists every unit the server remembers, by key.
func (a app) runQueue(ctx context.Context, c command, args []string) int {
	flags, address := a.serverFlags(c)
	all := flags.Bool("all", false, "list every unit with its state, not only the queue")
	if exit, ok := parse(flags, args, 0); !ok {
		return exit
	}
	server, err := a.connect(*address)
	if err != nil {
		return a.fail(c.name, err)
	}
	table := tabwriter.NewWriter(a.stdout, 0, 0, 2, ' ', 0)
	if *all {
		units, err := server.Units(ctx)
		if err != nil {
			return a.fail(c.name, err)
		}
		if len(units) == 0 {
			fmt.Fprintln(a.stderr, "there are no units")
			return 0
		}
		fmt.Fprintln(table, "STATE\tWEIGHT\tKEY\tNODE\tSESSION\tPR")
		for _, u := range units {
			fmt.Fprintf(table, "%s\t%s\t%s\t%s\t%s\t%s\n", u.State, u.Weight, u.Key, orDash(u.Node), orDash(u.Session), orDash(u.PR))
		}
		if err := table.Flush(); err != nil {
			return a.fail(c.name, err)
		}
		return 0
	}
	units, err := server.Queue(ctx)
	if err != nil {
		return a.fail(c.name, err)
	}
	if len(units) == 0 {
		fmt.Fprintln(a.stderr, "the queue is empty")
		return 0
	}
	now := a.now()
	// The last column only shows up when a start has failed.
	failed := false
	for _, u := range units {
		failed = failed || u.FailedStarts > 0
	}
	header := "WEIGHT\tKEY\tWAITING"
	if failed {
		header += "\tFAILED STARTS"
	}
	fmt.Fprintln(table, header)
	for _, u := range units {
		line := fmt.Sprintf("%s\t%s\t%s", u.Weight, u.Key, waiting(now.Sub(u.Queued)))
		switch {
		case !failed:
		case u.FailedStarts == 0:
			line += "\t-"
		case u.NotBefore.After(now):
			line += fmt.Sprintf("\t%d, next try in %s", u.FailedStarts, waiting(u.NotBefore.Sub(now)))
		default:
			line += fmt.Sprintf("\t%d, next try now", u.FailedStarts)
		}
		fmt.Fprintln(table, line)
	}
	if err := table.Flush(); err != nil {
		return a.fail(c.name, err)
	}
	return 0
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

// waiting shows a duration in its largest whole unit: 45s, 12m, 3h, 2d.
func waiting(d time.Duration) string {
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", max(0, int(d/time.Second)))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d/time.Minute))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d/time.Hour))
	}
	return fmt.Sprintf("%dd", int(d/(24*time.Hour)))
}
