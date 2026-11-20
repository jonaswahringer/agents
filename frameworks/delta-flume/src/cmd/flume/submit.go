package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/jonaswahringer/delta-flume/src/internal/gateway"
	"github.com/jonaswahringer/delta-flume/src/internal/unit"
)

var submitCommand = command{
	name:    "submit",
	args:    "[flags]",
	summary: "Hand units to the gateway, one JSON object per line on stdin.",
	run:     app.runSubmit,
}

// runSubmit hands every unit on stdin to the gateway. It prints one decision
// per line on stdout and a one-line summary on stderr. A declined unit is a
// decision, not a failure, so it exits 0.
func (a app) runSubmit(ctx context.Context, c command, args []string) int {
	flags, address := a.serverFlags(c)
	if exit, ok := parse(flags, args, 0); !ok {
		return exit
	}
	// Read everything first: one bad line stops the batch before any unit of
	// it reaches the gateway.
	submissions, err := readSubmissions(a.stdin)
	if err != nil {
		return a.fail(c.name, err)
	}
	server, err := a.connect(*address)
	if err != nil {
		return a.fail(c.name, err)
	}
	counts := map[gateway.Outcome]int{}
	if len(submissions) > 0 {
		decisions, err := server.Submit(ctx, submissions)
		if err != nil {
			return a.fail(c.name, err)
		}
		out := json.NewEncoder(a.stdout)
		out.SetEscapeHTML(false)
		for _, d := range decisions {
			counts[d.Outcome]++
			if err := out.Encode(d); err != nil {
				return a.fail(c.name, err)
			}
		}
	}
	switch len(submissions) {
	case 0:
		fmt.Fprintln(a.stderr, "no units on stdin, so nothing was submitted")
	case 1:
		fmt.Fprintf(a.stderr, "1 unit: %s\n", outcomes(counts))
	default:
		fmt.Fprintf(a.stderr, "%d units: %s\n", len(submissions), outcomes(counts))
	}
	return 0
}

// outcomes spells the counts, such as "1 accepted, 2 declined".
func outcomes(counts map[gateway.Outcome]int) string {
	var parts []string
	for _, o := range []gateway.Outcome{gateway.Accepted, gateway.Updated, gateway.Declined} {
		if counts[o] > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", counts[o], o))
		}
	}
	return strings.Join(parts, ", ")
}

// readSubmissions reads one unit per line. Each is a JSON object with a key
// and a weight, such as a line of "flume scan". The object without its root
// is the unit's content.
func readSubmissions(stdin io.Reader) ([]gateway.Submission, error) {
	var submissions []gateway.Submission
	seen := map[string]int{}
	lines := bufio.NewScanner(stdin)
	lines.Buffer(nil, 16<<20)
	for n := 1; lines.Scan(); n++ {
		line := bytes.TrimSpace(lines.Bytes())
		if len(line) == 0 {
			continue
		}
		var head struct {
			Key    string
			Weight string
		}
		if err := json.Unmarshal(line, &head); err != nil {
			return nil, fmt.Errorf("line %d is not a JSON object: %w", n, err)
		}
		key, err := unit.ParseKey(head.Key)
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", n, err)
		}
		weight, err := unit.ParseWeight(head.Weight)
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", n, err)
		}
		if first, ok := seen[head.Key]; ok {
			return nil, fmt.Errorf("line %d: key %s is already on line %d", n, head.Key, first)
		}
		seen[head.Key] = n
		content, err := withoutRoot(line)
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", n, err)
		}
		submissions = append(submissions, gateway.Submission{Key: key, Weight: weight, Content: content})
	}
	return submissions, lines.Err()
}

// withoutRoot is a unit's line without its root. Where a project lives on
// one machine is not part of what was found: the same finding from another
// folder, or another machine, is the same unit and brings nothing new.
func withoutRoot(line []byte) (json.RawMessage, error) {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(line, &object); err != nil {
		return nil, err
	}
	delete(object, "root")
	return json.Marshal(object)
}
