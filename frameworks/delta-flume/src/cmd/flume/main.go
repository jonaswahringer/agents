// Command flume runs the deterministic parts of a delta-flume vessel.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"slices"
	"strings"
	"syscall"
	"time"
)

// commands are flume's commands, in the order the help lists them. Each one
// is described in its own file.
var commands = []command{
	serveCommand, nodeCommand, scanCommand, submitCommand, queueCommand, logCommand, branchCommand,
}

// worktreeCommands are the ones an agent runs inside its unit's worktree.
var worktreeCommands = []command{
	prepareCommand, pushCommand, prCommand,
}

func main() {
	// Ctrl-C and a service manager's stop both end the context. What flume
	// is running then is asked to stop too, and the server is still told
	// where a unit stands.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	a := app{stdin: os.Stdin, stdout: os.Stdout, stderr: os.Stderr, now: time.Now, getenv: os.Getenv, dir: "."}
	os.Exit(a.run(ctx, os.Args[1:]))
}

// run reads the arguments: the first names the command, the rest are its own.
func (a app) run(ctx context.Context, args []string) int {
	if len(args) == 0 {
		fmt.Fprint(a.stderr, usage())
		return 2
	}
	name, rest := args[0], args[1:]
	if name == "help" || name == "-h" || name == "--help" {
		fmt.Fprint(a.stdout, usage())
		return 0
	}
	for _, c := range slices.Concat(commands, worktreeCommands) {
		if c.name == name {
			return c.run(a, ctx, c, rest)
		}
	}
	fmt.Fprintf(a.stderr, "flume: unknown command %q\n\n%s", name, usage())
	return 2
}

// usage is the help text. Its command lines come from the commands
// themselves, so the help cannot drift from what flume can do.
func usage() string {
	help := command{name: "help", summary: "Show this help."}
	groups := []struct {
		title    string
		commands []command
	}{
		{"Usage:", append(slices.Clone(commands), help)},
		{"Run inside a unit's worktree:", worktreeCommands},
	}
	width := 0
	for _, g := range groups {
		for _, c := range g.commands {
			width = max(width, len(c.synopsis()))
		}
	}
	var text strings.Builder
	text.WriteString("flume runs the deterministic parts of a delta-flume vessel.\n")
	for _, g := range groups {
		fmt.Fprintf(&text, "\n%s\n", g.title)
		for _, c := range g.commands {
			fmt.Fprintf(&text, "  %-*s   %s\n", width, c.synopsis(), c.summary)
		}
	}
	text.WriteString(`
A key is <vessel>/<project>/<instance>/<subject>, for example
maintenance/tiro/dependencies/lodash. Run a command with -h for its flags.

The server holds the units. A command finds it at -server, else
$FLUME_SERVER, else ` + defaultServer + `.
`)
	return text.String()
}
