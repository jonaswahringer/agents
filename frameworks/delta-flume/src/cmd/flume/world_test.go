package main

import (
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/client"
	"github.com/jonaswahringer/delta-flume/src/internal/node"
	"github.com/jonaswahringer/delta-flume/src/internal/server"
	"github.com/jonaswahringer/delta-flume/src/internal/store"
	"github.com/jonaswahringer/delta-flume/src/internal/t3"
)

// world is a flume server on a new store, with a clock the test sets. The
// commands of a test talk to it over HTTP, as they do outside tests.
type world struct {
	url string

	mu  sync.Mutex
	now time.Time
	log strings.Builder
}

func newWorld(t *testing.T) *world {
	t.Helper()
	w := &world{now: testNow}
	db, err := store.Open(t.Context(), filepath.Join(t.TempDir(), "flume.db"))
	if err != nil {
		t.Fatal(err)
	}
	control := server.New(db, w.clock, w.logf, nil)
	web := httptest.NewServer(control.Handler())
	t.Cleanup(func() {
		web.Close()
		db.Close()
	})
	w.url = web.URL
	return w
}

func (w *world) clock() time.Time {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.now
}

// at sets the time for the server and for the commands that follow.
func (w *world) at(now time.Time) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.now = now
}

func (w *world) logf(format string, args ...any) {
	w.mu.Lock()
	defer w.mu.Unlock()
	fmt.Fprintf(&w.log, format+"\n", args...)
}

// logged is what the server has logged so far.
func (w *world) logged() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.log.String()
}

// flume runs one command against the world's server.
func (w *world) flume(t *testing.T, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	return w.flumeIn(t, ".", "", args...)
}

// flumeIn runs one command in a folder, with stdin as its input.
func (w *world) flumeIn(t *testing.T, dir, stdin string, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	args = append([]string{args[0], "-server", w.url}, args[1:]...)
	return flumeIn(t, dir, w.clock(), stdin, args...)
}

// node is this machine as a node of the world's server, with room for limit
// units. Its agents are started by the t3 stand-in at t3Path.
func (w *world) node(t *testing.T, name string, limit int, t3Path string, roots ...string) *node.Node {
	t.Helper()
	srv, err := client.New(w.url)
	if err != nil {
		t.Fatal(err)
	}
	projects, err := projectFolders(t.Context(), roots)
	if err != nil {
		t.Fatal(err)
	}
	return &node.Node{
		Name: name, MaxRunning: limit, Projects: projects,
		Server: srv, Provider: t3.CLI{Path: t3Path}, Logf: w.logf,
	}
}

// step lets a node ask the server once and do what the answer says.
func step(t *testing.T, n *node.Node) {
	t.Helper()
	if err := n.Step(t.Context(), 0); err != nil {
		t.Fatalf("node %s: %v", n.Name, err)
	}
}
