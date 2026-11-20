package main

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

// output is a place two goroutines may write to and read from.
type output struct {
	mu   sync.Mutex
	text strings.Builder
}

func (o *output) Write(p []byte) (int, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.text.Write(p)
}

func (o *output) String() string {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.text.String()
}

// running is a flume command that runs until it is told to stop, such as
// "flume serve".
type running struct {
	stderr *output
	stop   context.CancelFunc
	done   chan int
}

// start runs a command on the real clock, in the background.
func start(t *testing.T, args ...string) *running {
	t.Helper()
	ctx, stop := context.WithCancel(context.Background())
	r := &running{stderr: &output{}, stop: stop, done: make(chan int, 1)}
	a := app{
		stdin: strings.NewReader(""), stdout: &output{}, stderr: r.stderr,
		now: time.Now, getenv: func(string) string { return "" }, dir: ".",
	}
	go func() { r.done <- a.run(ctx, args) }()
	t.Cleanup(func() { r.end(t) })
	return r
}

// end tells the command to stop and returns its exit code.
func (r *running) end(t *testing.T) int {
	t.Helper()
	r.stop()
	select {
	case code := <-r.done:
		r.done <- code
		return code
	case <-time.After(15 * time.Second):
		t.Fatalf("the command did not stop; it wrote:\n%s", r.stderr)
		return -1
	}
}

// eventually waits for something that another goroutine brings about.
func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if ok() {
			return
		}
	}
	t.Fatalf("waited 10s for %s", what)
}

var listening = regexp.MustCompile(`listening on (http://127\.0\.0\.1:\d+)`)

// address waits for a server to say where it listens.
func (r *running) address(t *testing.T) string {
	t.Helper()
	var found []string
	eventually(t, "the server's address", func() bool {
		found = listening.FindStringSubmatch(r.stderr.String())
		return found != nil
	})
	return found[1]
}

func fileHas(path, text string) func() bool {
	return func() bool {
		data, err := os.ReadFile(path)
		return err == nil && strings.Contains(string(data), text)
	}
}

// One "flume serve" with a project folder is all one machine needs: a unit
// that is submitted starts at once, without anything running on a timer.
func TestServeIsServerAndNode(t *testing.T) {
	root, _ := project(t)
	t3, t3Log := threadScript(t)
	db := filepath.Join(t.TempDir(), "flume.db")
	serve := start(t, "serve", "-listen", "127.0.0.1:0", "-db", db, "-name", "mini", "-t3", t3, root)
	url := serve.address(t)
	// Let the node ask its first question, so the next one is held open.
	eventually(t, "the node to join", func() bool { return strings.Contains(serve.stderr.String(), "node mini joined") })
	time.Sleep(300 * time.Millisecond)

	submitted := time.Now()
	if code, _, errs := flumeAt(t, testNow, lodashUnit(`"GHSA-1"`), "submit", "-server", url); code != 0 {
		t.Fatalf("submit: %s", errs)
	}
	eventually(t, "the agent to start", fileHas(t3Log, "thread start --worktree main --branch "+lodashBranch))
	if took := time.Since(submitted); took > 5*time.Second {
		t.Errorf("the agent started %v after the unit was submitted; the server should tell the node at once", took)
	}
	eventually(t, "the server to hear of the start", func() bool {
		_, out, _ := flume(t, "queue", "-server", url, "-all")
		return strings.Contains(out, "running") && strings.Contains(out, "mini  thread-1")
	})

	if code := serve.end(t); code != 0 {
		t.Errorf("serve ended with code %d:\n%s", code, serve.stderr)
	}
	for _, want := range []string{"with the units in " + db, "told mini to start " + lodashKey, "started " + lodashKey + " on mini in session thread-1", "stopped"} {
		if !strings.Contains(serve.stderr.String(), want) {
			t.Errorf("serve's log lacks %q:\n%s", want, serve.stderr)
		}
	}
	// The units outlive the server.
	again := start(t, "serve", "-listen", "127.0.0.1:0", "-db", db)
	if _, out, _ := flume(t, "queue", "-server", again.address(t), "-all"); !strings.Contains(out, lodashKey) {
		t.Errorf("after a restart the unit is gone:\n%s", out)
	}
}

// A server with no project folder only holds the queue. A node on another
// machine dials in and does the work.
func TestANodeDialsInToAServer(t *testing.T) {
	root, _ := project(t)
	t3, t3Log := threadScript(t)
	serve := start(t, "serve", "-listen", "127.0.0.1:0", "-db", filepath.Join(t.TempDir(), "flume.db"))
	url := serve.address(t)
	if code, _, errs := flumeAt(t, testNow, lodashUnit(`"GHSA-1"`), "submit", "-server", url); code != 0 {
		t.Fatalf("submit: %s", errs)
	}
	if !strings.Contains(serve.stderr.String(), "this machine only holds the queue") {
		t.Errorf("serve's log:\n%s", serve.stderr)
	}

	box := start(t, "node", "-server", url, "-name", "box", "-t3", t3, root)
	eventually(t, "the agent to start", fileHas(t3Log, "thread start "))
	eventually(t, "the server to hear of the start", func() bool {
		_, out, _ := flume(t, "queue", "-server", url, "-all")
		fields := strings.Fields(out)
		return strings.Contains(out, "running") && len(fields) > 2 && strings.Join(fields[len(fields)-3:], " ") == "box thread-1 -"
	})
	if code := box.end(t); code != 0 || !strings.Contains(box.stderr.String(), "started "+lodashKey) {
		t.Errorf("node ended with code %d:\n%s", code, box.stderr)
	}

	// With the server gone, a node keeps trying and still stops when told.
	serve.end(t)
	lost := start(t, "node", "-server", url, "-name", "box", "-t3", t3, root)
	eventually(t, "the node to say the server is gone", func() bool {
		return strings.Contains(lost.stderr.String(), "no answer from the flume server at "+url)
	})
	if code := lost.end(t); code != 0 {
		t.Errorf("a node without a server ended with code %d:\n%s", code, lost.stderr)
	}
}

func TestServeSaysWhenItCannotListen(t *testing.T) {
	taken := start(t, "serve", "-listen", "127.0.0.1:0", "-db", filepath.Join(t.TempDir(), "flume.db"))
	address := strings.TrimPrefix(taken.address(t), "http://")
	code, _, errs := flume(t, "serve", "-listen", address, "-db", filepath.Join(t.TempDir(), "other.db"))
	if code != 1 || !strings.Contains(errs, "flume serve: listen tcp "+address) {
		t.Errorf("code %d, stderr %q", code, errs)
	}
}

func TestOwnAddress(t *testing.T) {
	for listening, want := range map[string]string{
		"127.0.0.1:7117": "http://127.0.0.1:7117",
		"0.0.0.0:7117":   "http://127.0.0.1:7117",
		"[::]:7117":      "http://127.0.0.1:7117",
		"100.64.0.7:80":  "http://100.64.0.7:80",
	} {
		addr, err := net.ResolveTCPAddr("tcp", listening)
		if err != nil {
			t.Fatal(err)
		}
		if got := ownAddress(addr); got != want {
			t.Errorf("ownAddress(%s) = %s, want %s", listening, got, want)
		}
	}
}
