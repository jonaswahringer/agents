package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/agent"
	"github.com/jonaswahringer/delta-flume/src/internal/node"
	"github.com/jonaswahringer/delta-flume/src/internal/server"
	"github.com/jonaswahringer/delta-flume/src/internal/store"
)

var serveCommand = command{
	name:    "serve",
	args:    "[flags] [project]...",
	summary: "Run the server that holds the queue, and work on units for the project folders.",
	run:     app.runServe,
}

// runServe is the control plane. It holds the queue in one SQLite file,
// decides which node starts which unit, and answers the nodes and the other
// commands until it is told to stop. With project folders it is also a node
// itself, so one machine needs nothing else.
func (a app) runServe(ctx context.Context, c command, args []string) int {
	flags := a.flags(c)
	dbPath := flags.String("db", "", "SQLite file that holds the units (default: $FLUME_DB, else ~/.flume/flume.db)")
	listen := flags.String("listen", defaultListen, "address to listen on")
	settings := nodeFlags(flags)
	// Any number of projects may follow the flags.
	if exit, ok := parse(flags, args, len(args)); !ok {
		return exit
	}
	projects, err := projectFolders(ctx, flags.Args())
	if err != nil {
		return a.fail(c.name, err)
	}
	run, err := provider(*settings.agent, *settings.t3)
	if err != nil {
		return a.fail(c.name, err)
	}

	path, err := a.storePath(*dbPath)
	if err != nil {
		return a.fail(c.name, err)
	}
	db, err := store.Open(ctx, path)
	if err != nil {
		return a.fail(c.name, err)
	}
	defer db.Close()
	listener, err := net.Listen("tcp", *listen)
	if err != nil {
		return a.fail(c.name, err)
	}
	defer listener.Close()
	address := "http://" + listener.Addr().String()
	log := &logger{out: a.stderr, now: a.now}
	log.printf("listening on %s, with the units in %s", address, path)
	if host, _, _ := net.SplitHostPort(listener.Addr().String()); !net.ParseIP(host).IsLoopback() {
		log.printf("warning: this address is open to other machines, and the server asks nobody who they are")
	}
	// This machine's own node reaches the server on the machine itself,
	// whatever other addresses the server listens on.
	self, err := a.connect(ownAddress(listener.Addr()))
	if err != nil {
		return a.fail(c.name, err)
	}

	ctx, stop := context.WithCancel(ctx)
	defer stop()
	control := server.New(db, a.now, log.printf)
	web := &http.Server{Handler: control.Handler(), ReadHeaderTimeout: 10 * time.Second}
	var work, ownNode sync.WaitGroup
	failed := make(chan error, 1)
	work.Go(func() {
		if err := web.Serve(listener); !errors.Is(err, http.ErrServerClosed) {
			failed <- err
			stop()
		}
	})
	work.Go(func() { control.Run(ctx) })
	if len(projects) > 0 {
		n := settings.node(projects, self, run, log.printf)
		n.Quiet = true
		ownNode.Go(func() { n.Run(ctx) })
	} else {
		log.printf("no project folder was named, so this machine only holds the queue")
	}

	<-ctx.Done()
	// The node goes first: it tells the server where its units stand, and
	// the server still has to be there to hear it. Then the questions other
	// nodes have open are answered, and the server stops.
	ownNode.Wait()
	control.Stop()
	closing, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := web.Shutdown(closing); err != nil {
		web.Close()
	}
	work.Wait()
	select {
	case err := <-failed:
		return a.fail(c.name, err)
	default:
	}
	log.printf("stopped")
	return 0
}

// ownAddress is where a program on this machine reaches a listener. A
// listener on every address is reached on the loopback one.
func ownAddress(listening net.Addr) string {
	if tcp, ok := listening.(*net.TCPAddr); ok && tcp.IP.IsUnspecified() {
		return "http://" + net.JoinHostPort("127.0.0.1", strconv.Itoa(tcp.Port))
	}
	return "http://" + listening.String()
}

// storePath is the SQLite file the server keeps the units in.
func (a app) storePath(path string) (string, error) {
	if path == "" {
		path = a.getenv("FLUME_DB")
	}
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("no home folder for the default file, so pass -db: %w", err)
		}
		path = filepath.Join(home, ".flume", "flume.db")
	}
	return filepath.Abs(path)
}

// logger writes one line per message, with the time in front. The server
// and its node write at once, so it takes turns.
type logger struct {
	mu  sync.Mutex
	out io.Writer
	now func() time.Time
}

func (l *logger) printf(format string, args ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	fmt.Fprintf(l.out, "%s  %s\n", l.now().Format("2006-01-02 15:04:05"), fmt.Sprintf(format, args...))
}

// nodeSettings are the flags that say how this machine works on units.
type nodeSettings struct {
	name, agent, t3, base *string
	maxRunning            *int
}

func nodeFlags(flags *flag.FlagSet) nodeSettings {
	host, _ := os.Hostname()
	host, _, _ = strings.Cut(strings.ToLower(host), ".")
	if host == "" {
		host = "node"
	}
	s := nodeSettings{
		name:       flags.String("name", host, "this node's name, which tells it apart from other nodes"),
		maxRunning: flags.Int("max-running", 1, "how many units this node works on at once"),
		base:       flags.String("base", "", "what a unit's branch starts from (default: the default branch of origin)"),
	}
	s.agent, s.t3 = agentFlags(flags)
	return s
}

func (s nodeSettings) node(projects map[string]string, srv node.Server, run agent.Provider, logf func(string, ...any)) *node.Node {
	return &node.Node{
		Name: *s.name, MaxRunning: *s.maxRunning, Projects: projects,
		Server: srv, Provider: run, Base: *s.base, Logf: logf,
	}
}

// projectFolders maps each project's name, as the keys spell it, to its
// folder on this machine.
func projectFolders(ctx context.Context, dirs []string) (map[string]string, error) {
	projects := map[string]string{}
	for _, dir := range dirs {
		root, err := filepath.Abs(dir)
		if err == nil {
			root, err = filepath.EvalSymlinks(root)
		}
		if err != nil {
			return nil, err
		}
		if info, err := os.Stat(root); err != nil || !info.IsDir() {
			return nil, fmt.Errorf("%s is not a folder", dir)
		}
		name := projectName(ctx, root)
		if other, taken := projects[name]; taken && other != root {
			return nil, fmt.Errorf("%s and %s are both project %s", other, root, name)
		}
		projects[name] = root
	}
	return projects, nil
}
