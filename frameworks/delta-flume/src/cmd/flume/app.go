package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/client"
	"github.com/jonaswahringer/delta-flume/src/internal/cmdx"
	"github.com/jonaswahringer/delta-flume/src/internal/permit"
	"github.com/jonaswahringer/delta-flume/src/internal/repo"
)

// app is everything a command touches outside its arguments. main passes the
// real ones in; a test passes its own.
type app struct {
	stdin          io.Reader
	stdout, stderr io.Writer
	now            func() time.Time
	getenv         func(string) string
	// dir is the folder the command runs in.
	dir string
}

// command is one flume command, as its own file describes it.
type command struct {
	name string
	// args is what follows the name on the command line, such as "[flags] [dir]".
	args string
	// summary is the command's line in the help.
	summary string
	run     func(a app, ctx context.Context, c command, args []string) int
}

// synopsis is how the command is called, such as "flume node [flags] <project>...".
func (c command) synopsis() string {
	return strings.TrimSpace("flume " + c.name + " " + c.args)
}

// flags sets up a command's flags. Its -h shows how the command is called
// and what it does, then the flags.
func (a app) flags(c command) *flag.FlagSet {
	flags := flag.NewFlagSet("flume "+c.name, flag.ContinueOnError)
	flags.SetOutput(a.stderr)
	flags.Usage = func() {
		fmt.Fprintf(a.stderr, "usage: %s\n\n%s\n\n", c.synopsis(), c.summary)
		flags.PrintDefaults()
	}
	return flags
}

// The server listens here unless it is told otherwise, and the commands
// look for it here.
const (
	defaultListen = "127.0.0.1:7117"
	defaultServer = "http://" + defaultListen
)

// serverFlags is flags for a command that asks the server: it adds -server.
func (a app) serverFlags(c command) (flags *flag.FlagSet, server *string) {
	flags = a.flags(c)
	server = flags.String("server", "", "address of the flume server (default: $FLUME_SERVER, else "+defaultServer+")")
	return flags, server
}

// connect reaches the server at address, or where the environment says.
func (a app) connect(address string) (*client.Client, error) {
	if address == "" {
		address = a.getenv("FLUME_SERVER")
	}
	if address == "" {
		address = defaultServer
	}
	return client.New(address)
}

// parse reads a command's flags and allows up to maxArgs arguments after
// them. When it returns false the command ends with the exit code: 0 after
// -h, 2 after a mistake on the command line.
func parse(flags *flag.FlagSet, args []string, maxArgs int) (exit int, ok bool) {
	switch err := flags.Parse(args); {
	case errors.Is(err, flag.ErrHelp):
		return 0, false
	case err != nil:
		return 2, false
	case flags.NArg() > maxArgs:
		flags.Usage()
		return 2, false
	}
	return 0, true
}

// worktreeFlags is serverFlags for a command that runs inside a unit's
// worktree: it adds -gh.
func (a app) worktreeFlags(c command) (flags *flag.FlagSet, server, gh *string) {
	flags, server = a.serverFlags(c)
	gh = flags.String("gh", "gh", "gh binary to run")
	return flags, server, gh
}

// worktree is what a command that runs inside a unit's worktree needs: the
// permit, the checkout, and the project's name as the keys spell it.
func (a app) worktree(ctx context.Context, server, gh string) (*permit.Permit, repo.Repo, string, error) {
	r := repo.Repo{Dir: a.dir, Git: "git", GH: gh}
	top, err := r.Top(ctx)
	if err != nil {
		return nil, repo.Repo{}, "", err
	}
	ledger, err := a.connect(server)
	if err != nil {
		return nil, repo.Repo{}, "", err
	}
	return permit.New(ledger), r, projectName(ctx, top), nil
}

// projectName names the project after its git remote, so a worktree with a
// generated directory name still gets the right keys.
func projectName(ctx context.Context, root string) string {
	cmd := cmdx.Command(ctx, 15*time.Second, "git", "config", "--get", "remote.origin.url")
	cmd.Dir = root
	if out, err := cmd.Output(); err == nil {
		url := strings.TrimSuffix(strings.TrimSpace(string(out)), ".git")
		if i := strings.LastIndexAny(url, "/:"); i >= 0 && i < len(url)-1 {
			return strings.ToLower(url[i+1:])
		}
	}
	return strings.ToLower(filepath.Base(root))
}

func (a app) fail(command string, err error) int {
	fmt.Fprintf(a.stderr, "flume %s: %v\n", command, err)
	return 1
}
