package main

import (
	"strings"
	"testing"
	"time"
)

const (
	lodashLine   = `{"key":"maintenance/tiro/dependencies/lodash","weight":"high","advisories":[{"id":"GHSA-1"}]}`
	minimistLine = `{"key":"maintenance/tiro/dependencies/minimist","weight":"critical","advisories":[{"id":"GHSA-2"}]}`
)

func TestSubmitThenQueue(t *testing.T) {
	w := newWorld(t)

	code, out, errs := w.flumeIn(t, ".", lodashLine+"\n\n"+minimistLine+"\n", "submit")
	if code != 0 || errs != "2 units: 2 accepted\n" {
		t.Fatalf("first submit: code %d, stderr %q", code, errs)
	}
	want := `{"key":"maintenance/tiro/dependencies/lodash","outcome":"accepted"}` + "\n" +
		`{"key":"maintenance/tiro/dependencies/minimist","outcome":"accepted"}` + "\n"
	if out != want {
		t.Errorf("first submit printed:\n%s", out)
	}

	// The next scan finds the same lodash and a minimist with one more advisory.
	w.at(testNow.Add(90 * time.Minute))
	heavier := strings.Replace(minimistLine, `]}`, `,{"id":"GHSA-3"}]}`, 1)
	code, out, errs = w.flumeIn(t, ".", lodashLine+"\n"+heavier+"\n", "submit")
	if code != 0 || errs != "2 units: 1 updated, 1 declined\n" {
		t.Fatalf("second submit: code %d, stderr %q", code, errs)
	}
	if !strings.Contains(out, `"outcome":"declined","reason":"nothing new, and the unit is already queued"`) {
		t.Errorf("second submit printed:\n%s", out)
	}

	code, out, errs = w.flume(t, "queue")
	want = "WEIGHT    KEY                                     WAITING\n" +
		"critical  maintenance/tiro/dependencies/minimist  1h\n" +
		"high      maintenance/tiro/dependencies/lodash    1h\n"
	if code != 0 || out != want || errs != "" {
		t.Errorf("queue: code %d, stderr %q, stdout:\n%s", code, errs, out)
	}

	code, out, _ = w.flume(t, "log", "-n", "3")
	want = "2026-11-20 09:00:00  accepted  maintenance/tiro/dependencies/minimist\n" +
		"2026-11-20 10:30:00  declined  maintenance/tiro/dependencies/lodash    nothing new, and the unit is already queued\n" +
		"2026-11-20 10:30:00  updated   maintenance/tiro/dependencies/minimist  new input while queued\n"
	if code != 0 || out != want {
		t.Errorf("log: code %d, stdout:\n%s", code, out)
	}
}

func TestSubmitStopsTheWholeBatchOnABadLine(t *testing.T) {
	w := newWorld(t)
	for _, tc := range []struct{ name, bad, want string }{
		{"not JSON", `nope`, "line 2 is not a JSON object"},
		{"no key", `{"weight":"low"}`, "line 2: key"},
		{"bad weight", `{"key":"maintenance/tiro/dependencies/x","weight":"urgent"}`, `line 2: unknown weight "urgent"`},
		{"same key twice", lodashLine, "line 2: key maintenance/tiro/dependencies/lodash is already on line 1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			code, out, errs := w.flumeIn(t, ".", lodashLine+"\n"+tc.bad+"\n", "submit")
			if code != 1 || out != "" || !strings.Contains(errs, tc.want) {
				t.Errorf("code %d, stdout %q, stderr %q", code, out, errs)
			}
		})
	}
	// The good first line of each batch never reached the gateway.
	if code, out, errs := w.flume(t, "queue"); code != 0 || out != "" || errs != "the queue is empty\n" {
		t.Errorf("queue: code %d, stdout %q, stderr %q", code, out, errs)
	}
}

func TestSubmitWithNothingOnStdin(t *testing.T) {
	w := newWorld(t)
	if code, out, errs := w.flume(t, "submit"); code != 0 || out != "" || !strings.Contains(errs, "nothing was submitted") {
		t.Errorf("code %d, stdout %q, stderr %q", code, out, errs)
	}
	if code, _, errs := w.flume(t, "log"); code != 0 || errs != "the log is empty\n" {
		t.Errorf("log: code %d, stderr %q", code, errs)
	}
	if code, _, _ := w.flume(t, "queue", "extra"); code != 2 {
		t.Errorf("queue with an extra argument: code %d, want 2", code)
	}
}

func TestWaiting(t *testing.T) {
	for d, want := range map[time.Duration]string{
		-time.Second: "0s", 45 * time.Second: "45s", 12 * time.Minute: "12m",
		3*time.Hour + 59*time.Minute: "3h", 49 * time.Hour: "2d",
	} {
		if got := waiting(d); got != want {
			t.Errorf("waiting(%s) = %s, want %s", d, got, want)
		}
	}
}

// Without a server there is no queue, and the command says where it looked.
func TestACommandSaysWhenTheServerDoesNotAnswer(t *testing.T) {
	for _, command := range []string{"queue", "log"} {
		code, out, errs := flume(t, command, "-server", "http://127.0.0.1:1")
		if code != 1 || out != "" || !strings.HasPrefix(errs, "flume "+command+": no answer from the flume server at http://127.0.0.1:1: ") {
			t.Errorf("%s: code %d, stdout %q, stderr %q", command, code, out, errs)
		}
	}
	if code, _, errs := flume(t, "queue", "-server", "localhost"); code != 1 || !strings.Contains(errs, `server address "localhost": want one like http://127.0.0.1:7117`) {
		t.Errorf("an address that is none: code %d, stderr %q", code, errs)
	}
	// The address also comes from the environment.
	env := map[string]string{"FLUME_SERVER": "http://127.0.0.1:1"}
	if code, _, errs := flumeEnv(t, env, ".", testNow, "", "queue"); code != 1 || !strings.Contains(errs, "http://127.0.0.1:1") {
		t.Errorf("FLUME_SERVER: code %d, stderr %q", code, errs)
	}
}
