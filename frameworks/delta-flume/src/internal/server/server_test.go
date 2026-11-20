package server_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/client"
	"github.com/jonaswahringer/delta-flume/src/internal/gateway"
	"github.com/jonaswahringer/delta-flume/src/internal/server"
	"github.com/jonaswahringer/delta-flume/src/internal/store"
	"github.com/jonaswahringer/delta-flume/src/internal/unit"
	"github.com/jonaswahringer/delta-flume/src/internal/wire"
)

// fixture is a server on a real SQLite file, reached over real HTTP, so the
// SQL and the JSON are tested too.
type fixture struct {
	*client.Client
	url string

	mu  sync.Mutex
	now time.Time
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{now: time.Date(2026, 11, 20, 9, 0, 0, 0, time.UTC)}
	db, err := store.Open(t.Context(), filepath.Join(t.TempDir(), "flume.db"))
	if err != nil {
		t.Fatal(err)
	}
	web := httptest.NewServer(server.New(db, f.clock, func(string, ...any) {}).Handler())
	t.Cleanup(func() {
		web.Close()
		db.Close()
	})
	if f.Client, err = client.New(web.URL); err != nil {
		t.Fatal(err)
	}
	f.url = web.URL
	return f
}

func (f *fixture) clock() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.now
}

func (f *fixture) later(d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.now = f.now.Add(d)
}

func (f *fixture) submit(t *testing.T, subjects ...string) {
	t.Helper()
	var submissions []gateway.Submission
	for _, subject := range subjects {
		key, err := unit.ParseKey("maintenance/tiro/dependencies/" + subject)
		if err != nil {
			t.Fatal(err)
		}
		submissions = append(submissions, gateway.Submission{Key: key, Weight: unit.High, Content: []byte(`{}`)})
	}
	if _, err := f.Submit(t.Context(), submissions); err != nil {
		t.Fatal(err)
	}
}

// report is a node with the project tiro and room for limit units.
func report(node string, limit int) wire.Report {
	return wire.Report{Node: node, MaxRunning: limit, Projects: []wire.Project{{Name: "tiro"}}}
}

// ask is a node asking once, without letting the server hold the question.
func (f *fixture) ask(t *testing.T, r wire.Report) wire.Desired {
	t.Helper()
	d, err := f.Sync(t.Context(), r)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func subjects(d wire.Desired) string {
	var parts []string
	for _, u := range d.Units {
		parts = append(parts, u.Key.Subject+":"+string(u.State))
	}
	return strings.Join(parts, " ")
}

// The server holds a node's question open, and answers the moment there is
// something for the node to do.
func TestAQuestionIsHeldOpenUntilSomethingChanges(t *testing.T) {
	f := newFixture(t)
	first := f.ask(t, report("mini", 1))
	if len(first.Units) != 0 || first.Version == 0 {
		t.Fatalf("first answer: %+v, want no units and a version", first)
	}

	answers := make(chan wire.Desired, 1)
	go func() {
		held := report("mini", 1)
		held.Seen, held.WaitSeconds = first.Version, 30
		d, err := f.Sync(t.Context(), held)
		if err != nil {
			t.Error(err)
		}
		answers <- d
	}()
	select {
	case d := <-answers:
		t.Fatalf("with nothing new the question was answered at once: %+v", d)
	case <-time.After(200 * time.Millisecond):
	}

	asked := time.Now()
	f.submit(t, "lodash")
	select {
	case d := <-answers:
		if subjects(d) != "lodash:starting" || d.Version == first.Version || d.Units[0].Node != "mini" {
			t.Errorf("answer: %+v, want lodash starting on mini under a new version", d)
		}
		if took := time.Since(asked); took > 2*time.Second {
			t.Errorf("the answer took %v", took)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the question was still held open 5s after a unit arrived")
	}
}

// With nothing new, the answer comes when the node's wait is over, and it is
// the same picture.
func TestAQuestionWithNothingNewIsAnsweredWhenItsWaitIsOver(t *testing.T) {
	f := newFixture(t)
	f.submit(t, "lodash")
	first := f.ask(t, report("mini", 1))

	again := report("mini", 1)
	again.Seen, again.WaitSeconds = first.Version, 1
	asked := time.Now()
	second := f.ask(t, again)
	if took := time.Since(asked); took < 900*time.Millisecond || took > 5*time.Second {
		t.Errorf("the answer took %v, want about the node's wait of 1s", took)
	}
	if second.Version != first.Version || subjects(second) != "lodash:starting" {
		t.Errorf("second answer %+v, want the first again: %+v", second, first)
	}
}

func TestTwoNodesShareTheQueue(t *testing.T) {
	f := newFixture(t)
	f.ask(t, report("box", 1))
	f.ask(t, report("mini", 1))
	f.submit(t, "a", "b", "c")

	// Each node has room for one. The third unit waits.
	box, mini := f.ask(t, report("box", 1)), f.ask(t, report("mini", 1))
	if subjects(box) != "a:starting" || subjects(mini) != "b:starting" {
		t.Fatalf("box has %q and mini has %q, want a and b starting", subjects(box), subjects(mini))
	}
	if queue, _ := f.Queue(t.Context()); len(queue) != 1 || queue[0].Key.Subject != "c" {
		t.Errorf("queue = %+v, want c", queue)
	}

	// A node only reports on its own units.
	if err := f.Started(t.Context(), wire.Started{Key: box.Units[0].Key, Node: "mini", Session: "s"}); err == nil || !strings.Contains(err.Error(), "is starting on box, not on mini") {
		t.Errorf("mini reporting on box's unit: %v", err)
	}
	for _, d := range []wire.Desired{box, mini} {
		u := d.Units[0]
		if err := f.Started(t.Context(), wire.Started{Key: u.Key, Node: u.Node, Session: "thread-" + u.Key.Subject}); err != nil {
			t.Fatal(err)
		}
	}
	if got := subjects(f.ask(t, report("mini", 1))); got != "b:running" {
		t.Errorf("mini has %q, want b running", got)
	}

	// When mini's unit reaches Land, mini has room for the third.
	if err := f.PullRequest(t.Context(), mini.Units[0].Key, "https://example.test/pr/1", true); err != nil {
		t.Fatal(err)
	}
	if got := subjects(f.ask(t, report("mini", 1))); got != "c:starting" {
		t.Errorf("mini has %q, want c starting", got)
	}
}

// When a start fails, the node's room goes to the next unit at once.
func TestAFailedStartMakesRoomForTheNextUnit(t *testing.T) {
	f := newFixture(t)
	f.ask(t, report("mini", 1))
	f.submit(t, "a", "b")
	a := f.ask(t, report("mini", 1)).Units[0]

	after, err := f.NotStarted(t.Context(), wire.NotStarted{Key: a.Key, Node: "mini", Reason: "t3 is down"})
	if err != nil || after.State != unit.Queued || after.FailedStarts != 1 {
		t.Fatalf("after the failed start: %+v, err %v", after, err)
	}
	if got := subjects(f.ask(t, report("mini", 1))); got != "b:starting" {
		t.Errorf("mini has %q, want b starting while a waits", got)
	}
}

// A node that has not asked for a while gets no new work.
func TestANodeThatWentQuietGetsNothing(t *testing.T) {
	f := newFixture(t)
	f.ask(t, report("mini", 1))
	f.later(5 * time.Minute)
	f.submit(t, "lodash")
	if queue, _ := f.Queue(t.Context()); len(queue) != 1 {
		t.Fatalf("queue = %+v, want lodash still waiting for a node", queue)
	}
	if got := subjects(f.ask(t, report("mini", 1))); got != "lodash:starting" {
		t.Errorf("when mini asks again it has %q, want lodash starting", got)
	}
}

func TestANodeOnlyGetsWhatItCanRun(t *testing.T) {
	f := newFixture(t)
	f.submit(t, "lodash")
	paused := report("mini", 1)
	paused.Projects[0].Paused = []string{"maintenance/dependencies"}
	other := report("box", 1)
	other.Projects[0].Name = "loki"
	none := report("idle", 0)
	for _, r := range []wire.Report{paused, other, none} {
		if d := f.ask(t, r); len(d.Units) != 0 {
			t.Errorf("node %s got %q, want nothing", r.Node, subjects(d))
		}
	}
	if got := subjects(f.ask(t, report("mini", 1))); got != "lodash:starting" {
		t.Errorf("once the instance is active again mini has %q, want lodash starting", got)
	}
}

func TestWhatTheServerTurnsDown(t *testing.T) {
	f := newFixture(t)
	post := func(path, body string) (int, string) {
		t.Helper()
		res, err := http.Post(f.url+path, "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		text, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(text)
	}
	for _, tc := range []struct {
		path, body string
		status     int
		want       string
	}{
		{"/v1/sync", `nope`, 400, "not the JSON this call takes"},
		{"/v1/sync", `{}`, 422, "a report needs the node's name"},
		{"/v1/sync", `{"node":"mini","max_running":-1}`, 422, "cannot be negative"},
		{"/v1/submit", `[{"key":"nope","weight":"high","content":{}}]`, 400, "want <vessel>/<project>/<instance>/<subject>"},
		{"/v1/submit", `[{"key":"maintenance/tiro/dependencies/x","weight":"high","content":[]}]`, 422, "content is not a JSON object"},
		{"/v1/owner", `{"project":"tiro","branch":"main"}`, 422, "is not a unit's branch"},
		{"/v1/started", `{"key":"maintenance/tiro/dependencies/x","node":"mini","session":"s"}`, 422, "there is no unit maintenance/tiro/dependencies/x"},
		{"/v1/pushed", `{"key":"maintenance/tiro/dependencies/x"}`, 422, "there is no unit"},
	} {
		status, text := post(tc.path, tc.body)
		if status != tc.status || !strings.Contains(text, tc.want) || !strings.HasPrefix(text, `{"error":`) {
			t.Errorf("%s %s: %d %s, want %d with %q", tc.path, tc.body, status, text, tc.status, tc.want)
		}
	}
	if res, err := http.Get(f.url + "/v1/units?state=nope"); err != nil || res.StatusCode != 400 {
		t.Errorf("an unknown state: %v, %v", res, err)
	}
	// The client hands the server's reason on as it is.
	if _, err := f.Owner(t.Context(), "tiro", "vessel/maintenance/dependencies/x"); err == nil || err.Error() != "no unit of project tiro owns branch vessel/maintenance/dependencies/x" {
		t.Errorf("owner of a stray branch: %v", err)
	}
}
