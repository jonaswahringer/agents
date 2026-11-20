package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/agent"
	"github.com/jonaswahringer/delta-flume/src/internal/claudecode"
)

const (
	lodashKey    = "maintenance/tiro/dependencies/lodash"
	lodashBranch = "vessel/maintenance/dependencies/lodash"
	minimistKey  = "maintenance/tiro/dependencies/minimist"
)

func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

// project makes a project called tiro: a checkout whose origin is a bare
// repository next to it, with one commit on main. It returns both folders.
func project(t *testing.T) (root, origin string) {
	t.Helper()
	// Keep the machine's own git settings out of the test.
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	for _, who := range []string{"AUTHOR", "COMMITTER"} {
		t.Setenv("GIT_"+who+"_NAME", "Test")
		t.Setenv("GIT_"+who+"_EMAIL", "test@example.test")
	}
	base, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	origin, root = filepath.Join(base, "tiro.git"), filepath.Join(base, "tiro")
	git(t, base, "init", "--quiet", "--bare", "--initial-branch", "main", origin)
	git(t, base, "clone", "--quiet", origin, root)
	git(t, root, "checkout", "--quiet", "-b", "main")
	git(t, root, "commit", "--quiet", "--allow-empty", "-m", "start")
	git(t, root, "push", "--quiet", "origin", "main")
	git(t, root, "remote", "set-head", "origin", "main")
	return root, origin
}

// script writes a stand-in for another program. It appends its arguments,
// one call per line, and its stdin to a log next to it.
func script(t *testing.T, name, body string) (path, log string) {
	t.Helper()
	dir := t.TempDir()
	path, log = filepath.Join(dir, name), filepath.Join(dir, "log")
	text := "#!/bin/sh\necho \"$*\" >> '" + log + "'\n" + body + "\n"
	if err := os.WriteFile(path, []byte(text), 0o755); err != nil {
		t.Fatal(err)
	}
	return path, log
}

// threadScript stands in for a T3 Code that starts every thread.
func threadScript(t *testing.T) (path, log string) {
	t.Helper()
	return script(t, "t3", `cat > /dev/null
echo '{"threadId":"thread-1","projectId":"p","runId":"r"}'`)
}

func read(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func lodashUnit(advisories string) string {
	return fmt.Sprintf(`{"key":%q,"weight":"high","advisories":[%s]}`+"\n", lodashKey, advisories)
}

// The whole life of a unit up to Land, with stand-ins for T3 Code and GitHub,
// a real git repository, and a real server between the commands.
func TestAUnitFromTheQueueToLand(t *testing.T) {
	root, origin := project(t)
	w := newWorld(t)
	messages := filepath.Join(t.TempDir(), "messages")
	t3, t3Log := script(t, "t3", `cat >> '`+messages+`'
echo '{"threadId":"thread-1","projectId":"p","runId":"r"}'`)
	stateFile := filepath.Join(t.TempDir(), "pr-open")
	gh, ghLog := script(t, "gh", `case "$1 $2" in
"pr list") [ -f '`+stateFile+`' ] && echo https://github.test/tiro/pull/7 || echo ;;
"pr create") touch '`+stateFile+`'; echo https://github.test/tiro/pull/7 ;;
esac`)
	mini := w.node(t, "mini", 1, t3, root)

	if code, _, errs := w.flumeIn(t, ".", lodashUnit(`"GHSA-1"`), "submit"); code != 0 {
		t.Fatalf("submit: %s", errs)
	}

	// The node asks, is told to start the unit, and does: T3 gets the derived
	// branch, the default branch as its base, and the project's folder.
	step(t, mini)
	if want := "thread start --worktree main --branch " + lodashBranch + " --title " + lodashKey + " --json " + root + " -\n"; read(t, t3Log) != want {
		t.Errorf("t3 was called with:\n%swant:\n%s", read(t, t3Log), want)
	}
	for _, want := range []string{"Unit:   " + lodashKey, "Branch: " + lodashBranch, `"GHSA-1"`, `Publish with "flume push"`} {
		if !strings.Contains(read(t, messages), want) {
			t.Errorf("the agent's message lacks %q:\n%s", want, read(t, messages))
		}
	}
	for _, want := range []string{"node mini joined: 1 projects, room for 1 units", "started " + lodashKey + " on mini in session thread-1"} {
		if !strings.Contains(w.logged(), want) {
			t.Errorf("the server's log lacks %q:\n%s", want, w.logged())
		}
	}
	// Asking again changes nothing: the unit is running, not to be started.
	step(t, mini)
	if log := read(t, t3Log); strings.Count(log, "\n") != 1 {
		t.Errorf("t3 was called again:\n%s", log)
	}

	// T3 Code's part: a worktree on the new branch. Then its setup script.
	worktree := filepath.Join(filepath.Dir(root), "worktree")
	git(t, root, "worktree", "add", "--quiet", "-b", lodashBranch, worktree, "main")
	if code, _, errs := w.flumeIn(t, worktree, "", "prepare"); code != 0 {
		t.Fatalf("prepare: %s", errs)
	}
	if got := read(t, filepath.Join(worktree, claudecode.Rules().File)); got != string(claudecode.Rules().Content) {
		t.Errorf("rules file:\n%s", got)
	}
	if status := git(t, worktree, "status", "--porcelain"); status != "" {
		t.Errorf("the rules file shows up in git status: %q", status)
	}
	if code, _, errs := w.flumeIn(t, worktree, "", "prepare"); code != 0 {
		t.Errorf("prepare twice: %s", errs)
	}

	// The agent's part: a commit, then publishing through flume.
	git(t, worktree, "commit", "--quiet", "--allow-empty", "-m", "bump lodash")
	if code, _, errs := w.flumeIn(t, worktree, "", "push"); code != 0 {
		t.Fatalf("push: %s", errs)
	}
	if pushed, head := git(t, origin, "rev-parse", "refs/heads/"+lodashBranch), git(t, worktree, "rev-parse", "HEAD"); pushed != head {
		t.Errorf("origin has %s, the worktree has %s", pushed, head)
	}

	if code, _, errs := w.flumeIn(t, worktree, "", "pr", "-gh", gh); code != 1 || !strings.Contains(errs, "needs a title and a description") {
		t.Errorf("pr without a title: code %d, stderr %q", code, errs)
	}
	code, out, errs := w.flumeIn(t, worktree, "Why: GHSA-1.\n", "pr", "-gh", gh, "-title", "deps: bump lodash", "-body-file", "-")
	if code != 0 || out != "https://github.test/tiro/pull/7\n" {
		t.Fatalf("pr: code %d, stdout %q, stderr %q", code, out, errs)
	}
	if log := read(t, ghLog); !strings.Contains(log, "pr create --head "+lodashBranch+" --base main --title deps: bump lodash --body Why: GHSA-1.") ||
		!strings.Contains(log, "Unit: `"+lodashKey+"`") {
		t.Errorf("gh was called with:\n%s", log)
	}
	_, out, _ = w.flume(t, "queue", "-all")
	if want := "landing  high    " + lodashKey + "  mini  thread-1  https://github.test/tiro/pull/7\n"; !strings.HasSuffix(out, want) {
		t.Errorf("queue -all:\n%s", out)
	}

	// New input while the pull request is open: the unit runs again, in the
	// thread it already has.
	w.at(testNow.Add(time.Hour))
	if _, out, _ := w.flumeIn(t, ".", lodashUnit(`"GHSA-1","GHSA-2"`), "submit"); !strings.Contains(out, `"outcome":"accepted"`) {
		t.Fatalf("submit with new input: %s", out)
	}
	step(t, mini)
	if log := read(t, t3Log); !strings.HasSuffix(log, "thread send --json thread-1 -\n") {
		t.Errorf("t3 was called with:\n%s", log)
	}
	if !strings.Contains(read(t, messages), "has new input") || !strings.Contains(read(t, messages), `"GHSA-2"`) {
		t.Errorf("the second message does not carry the new input:\n%s", read(t, messages))
	}
	// Running again, the agent pushes and the description is updated.
	if code, _, errs := w.flumeIn(t, worktree, "Why: GHSA-1 and GHSA-2.\n", "pr", "-gh", gh, "-body-file", "-"); code != 0 {
		t.Fatalf("pr again: %s", errs)
	}
	if log := read(t, ghLog); !strings.Contains(log, "pr edit https://github.test/tiro/pull/7 --body Why: GHSA-1 and GHSA-2.") {
		t.Errorf("gh was called with:\n%s", log)
	}

	_, out, _ = w.flume(t, "log", "-n", "0")
	for _, want := range []string{"accepted", "assigned", "started", "pushed", "pr opened", "pr updated"} {
		if !strings.Contains(out, "  "+want+"  ") {
			t.Errorf("the log has no %q line:\n%s", want, out)
		}
	}
}

func TestPublishingIsRefusedOffAUnitsBranch(t *testing.T) {
	root, origin := project(t)
	w := newWorld(t)
	gh, ghLog := script(t, "gh", "echo")
	w.flumeIn(t, ".", lodashUnit(`"GHSA-1"`), "submit")

	// On main: nothing to prepare, nothing to push.
	if code, _, errs := w.flumeIn(t, root, "", "prepare"); code != 0 || !strings.Contains(errs, "not a unit's branch") {
		t.Errorf("prepare on main: code %d, stderr %q", code, errs)
	}
	git(t, root, "commit", "--quiet", "--allow-empty", "-m", "on main")
	if code, _, errs := w.flumeIn(t, root, "", "push"); code != 1 || !strings.Contains(errs, "nothing was pushed") {
		t.Errorf("push on main: code %d, stderr %q", code, errs)
	}

	// On the unit's branch, but the unit has not started: still refused.
	git(t, root, "checkout", "--quiet", "-b", lodashBranch)
	for _, command := range []string{"prepare", "push"} {
		if code, _, errs := w.flumeIn(t, root, "", command); code != 1 || !strings.Contains(errs, "is queued") {
			t.Errorf("%s before the start: code %d, stderr %q", command, code, errs)
		}
	}
	if code, _, errs := w.flumeIn(t, root, "x", "pr", "-gh", gh, "-title", "t", "-body-file", "-"); code != 1 || !strings.Contains(errs, "is queued") {
		t.Errorf("pr before the start: code %d, stderr %q", code, errs)
	}

	// A branch that looks like a unit's but belongs to none.
	git(t, root, "checkout", "--quiet", "-b", "vessel/maintenance/dependencies/other")
	if code, _, errs := w.flumeIn(t, root, "", "prepare"); code != 1 || !strings.Contains(errs, "no unit of project tiro owns") {
		t.Errorf("prepare on a stray branch: code %d, stderr %q", code, errs)
	}

	if _, err := os.Stat(filepath.Join(root, claudecode.Rules().File)); err == nil {
		t.Error("a rules file was written")
	}
	if branches := git(t, origin, "branch", "--list"); strings.TrimSpace(branches) != "* main" && strings.TrimSpace(branches) != "main" {
		t.Errorf("origin has branches %q, want only main", branches)
	}
	if _, err := os.Stat(ghLog); err == nil {
		t.Errorf("gh was called: %s", read(t, ghLog))
	}
}

func TestAUnitWaitsInTheQueue(t *testing.T) {
	root, _ := project(t)
	w := newWorld(t)
	w.flumeIn(t, ".", lodashUnit(`"GHSA-1"`), "submit")
	queued := func(t *testing.T) string {
		t.Helper()
		_, out, _ := w.flume(t, "queue")
		if !strings.Contains(out, lodashKey) {
			t.Errorf("the unit left the queue:\n%s", out)
		}
		return out
	}

	t.Run("while its instance is paused", func(t *testing.T) {
		instance := filepath.Join(root, ".delta-flume", "vessels", "maintenance", "dependencies.md")
		os.MkdirAll(filepath.Dir(instance), 0o755)
		os.WriteFile(instance, []byte("---\nvessel: maintenance\nstatus: paused\n---\n\n# Maintenance vessel in tiro\n"), 0o644)
		defer os.WriteFile(instance, []byte("---\nvessel: maintenance\nstatus: active\n---\n"), 0o644)

		t3, t3Log := script(t, "t3", "exit 1")
		step(t, w.node(t, "mini", 1, t3, root))
		if want := "waiting: mini cannot start " + lodashKey + ": it belongs to an instance that is paused there"; !strings.Contains(w.logged(), want) {
			t.Errorf("the server's log lacks %q:\n%s", want, w.logged())
		}
		if _, err := os.Stat(t3Log); err == nil {
			t.Error("t3 was called")
		}
		queued(t)
	})

	t.Run("on a node without its project", func(t *testing.T) {
		t3, t3Log := script(t, "t3", "exit 1")
		step(t, w.node(t, "box", 1, t3, t.TempDir()))
		if want := "waiting: box cannot start " + lodashKey + ": it is for a project the node does not have"; !strings.Contains(w.logged(), want) {
			t.Errorf("the server's log lacks %q:\n%s", want, w.logged())
		}
		if _, err := os.Stat(t3Log); err == nil {
			t.Error("t3 was called")
		}
		queued(t)
	})

	t.Run("after T3 fails, and longer each time", func(t *testing.T) {
		t3, t3Log := script(t, "t3", `echo 'Branch "x" already exists in project "tiro". No thread was created.' >&2; exit 1`)
		mini := w.node(t, "mini", 1, t3, root)
		step(t, mini)
		if !strings.Contains(w.logged(), "No thread was created") {
			t.Errorf("the server's log does not say why:\n%s", w.logged())
		}
		if out := queued(t); !strings.Contains(out, "FAILED STARTS") || !strings.Contains(out, "1, next try in 2m") {
			t.Errorf("the queue does not show the failed start:\n%s", out)
		}
		if _, log, _ := w.flume(t, "log"); !strings.Contains(log, "start failed") || !strings.Contains(log, "failed start 1 on mini, next try in 2m") {
			t.Errorf("the log has no failed start:\n%s", log)
		}
		// Before the wait is over the node is not told to start it again.
		step(t, mini)
		if log := read(t, t3Log); strings.Count(log, "\n") != 1 {
			t.Errorf("t3 was tried again before the wait was over:\n%s", log)
		}
		w.at(testNow.Add(2 * time.Minute))
		step(t, mini)
		if out := queued(t); !strings.Contains(out, "2, next try in 4m") {
			t.Errorf("the queue does not show the second failed start:\n%s", out)
		}
	})

	t.Run("while its node is at its limit", func(t *testing.T) {
		w.at(testNow.Add(10 * time.Minute))
		t3, _ := script(t, "t3", `cat > /dev/null; echo '{"threadId":"thread-1"}'`)
		step(t, w.node(t, "mini", 1, t3, root))
		other := strings.Replace(lodashUnit(`"GHSA-9"`), "lodash", "minimist", 1)
		w.flumeIn(t, ".", other, "submit")
		step(t, w.node(t, "mini", 1, t3, root))
		if want := "waiting: mini is overloaded: 1 active, and its limit is 1"; !strings.Contains(w.logged(), want) {
			t.Errorf("the server's log lacks %q:\n%s", want, w.logged())
		}
		step(t, w.node(t, "mini", 2, t3, root))
		if want := "started " + minimistKey + " on mini"; !strings.Contains(w.logged(), want) {
			t.Errorf("with room for 2, the server's log lacks %q:\n%s", want, w.logged())
		}
	})
}

// A push that git refuses says why, not only git's last line of advice.
func TestARefusedPushSaysWhy(t *testing.T) {
	root, origin := project(t)
	w := newWorld(t)
	t3, _ := threadScript(t)
	w.flumeIn(t, ".", lodashUnit(`"GHSA-1"`), "submit")
	step(t, w.node(t, "mini", 1, t3, root))
	worktree := filepath.Join(filepath.Dir(root), "worktree")
	git(t, root, "worktree", "add", "--quiet", "-b", lodashBranch, worktree, "main")
	git(t, worktree, "commit", "--quiet", "--allow-empty", "-m", "bump lodash")
	if code, _, errs := w.flumeIn(t, worktree, "", "push"); code != 0 {
		t.Fatalf("push: %s", errs)
	}

	// Someone else pushes to the unit's branch, then the agent commits again.
	other := filepath.Join(filepath.Dir(root), "other")
	git(t, filepath.Dir(root), "clone", "--quiet", "--branch", lodashBranch, origin, other)
	git(t, other, "commit", "--quiet", "--allow-empty", "-m", "someone else")
	git(t, other, "push", "--quiet", "origin", lodashBranch)
	git(t, worktree, "commit", "--quiet", "--allow-empty", "-m", "bump lodash again")

	code, out, errs := w.flumeIn(t, worktree, "", "push")
	if code != 1 || out != "" {
		t.Errorf("code %d, stdout %q", code, out)
	}
	for _, want := range []string{"flume push: nothing was pushed: git push: exit status 1:\n", "[rejected]", "hint: "} {
		if !strings.Contains(errs, want) {
			t.Errorf("stderr lacks %q:\n%s", want, errs)
		}
	}
	// The log keeps one line per event, whatever git wrote.
	if _, out, _ := w.flume(t, "log", "-n", "0"); strings.Count(out, "\n") != strings.Count(out, lodashKey) {
		t.Errorf("the log has lines that are not events:\n%s", out)
	}
}

// stoppedRunner is T3 Code at the moment flume is told to stop: the launch
// fails, and the context has ended.
type stoppedRunner struct{ stop context.CancelFunc }

func (r stoppedRunner) Start(ctx context.Context, job agent.Job) (string, error) {
	r.stop()
	return "", ctx.Err()
}

func (r stoppedRunner) Send(ctx context.Context, session, message string) error {
	r.stop()
	return ctx.Err()
}

// Told to stop in the middle of a start, the node still tells the server. A
// unit left as starting with nobody working on it would never start again.
func TestAStartThatIsInterruptedPutsTheUnitBack(t *testing.T) {
	root, _ := project(t)
	w := newWorld(t)
	w.flumeIn(t, ".", lodashUnit(`"GHSA-1"`), "submit")

	ctx, stop := context.WithCancel(t.Context())
	mini := w.node(t, "mini", 1, "t3", root)
	mini.Provider, mini.Base = stoppedRunner{stop}, "main"
	if err := mini.Step(ctx, 0); err == nil {
		t.Error("a step that was interrupted reported no error")
	}

	_, out, _ := w.flume(t, "queue", "-all")
	if !strings.Contains(out, "queued") || strings.Contains(out, "starting") {
		t.Errorf("the unit is not back in the queue:\n%s", out)
	}
	if _, out, _ := w.flume(t, "log", "-n", "0"); !strings.Contains(out, "start failed") {
		t.Errorf("the log does not say the start failed:\n%s", out)
	}
}

func TestAnAgentProviderFlumeDoesNotKnow(t *testing.T) {
	for _, command := range []string{"serve", "node"} {
		code, out, errs := flume(t, command, "-agent", "nope", t.TempDir())
		if code != 1 || out != "" || !strings.Contains(errs, `unknown agent provider "nope"; flume knows: t3`) {
			t.Errorf("%s: code %d, stdout %q, stderr %q", command, code, out, errs)
		}
	}
	if code, _, errs := flume(t, "node"); code != 1 || !strings.Contains(errs, "name at least one project folder") {
		t.Errorf("node without a project: code %d, stderr %q", code, errs)
	}
	if code, _, errs := flume(t, "serve", filepath.Join(t.TempDir(), "missing")); code != 1 || !strings.Contains(errs, "missing") {
		t.Errorf("serve with a folder that is not there: code %d, stderr %q", code, errs)
	}
}

// Where a project lives is not part of what was found. The same finding from
// another folder, or another machine, is not new, and its agent starts in
// the folder the node has for the project.
func TestTheSameFindingFromAnotherFolderIsNotNew(t *testing.T) {
	root, _ := project(t)
	w := newWorld(t)
	line := func(folder string) string {
		return strings.Replace(lodashUnit(`"GHSA-1"`), `{"key"`, fmt.Sprintf(`{"root":%q,"key"`, folder), 1)
	}
	if _, out, _ := w.flumeIn(t, ".", line("/somewhere/else/tiro"), "submit"); !strings.Contains(out, `"outcome":"accepted"`) {
		t.Fatalf("first submission: %s", out)
	}
	if _, out, _ := w.flumeIn(t, ".", line(root), "submit"); !strings.Contains(out, `"outcome":"declined"`) {
		t.Errorf("the same finding from another folder: %s", out)
	}
	t3, t3Log := threadScript(t)
	step(t, w.node(t, "mini", 1, t3, root))
	if log := read(t, t3Log); !strings.Contains(log, " --json "+root+" -\n") {
		t.Errorf("the agent did not start in the folder the node has for the project:\n%s", log)
	}
}
