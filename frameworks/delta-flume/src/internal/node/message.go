package node

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/jonaswahringer/delta-flume/src/internal/unit"
)

// startMessage is the task of a unit's agent.
func startMessage(u unit.Unit) string {
	return fmt.Sprintf(`You are the agent loop of the %[1]s vessel, working on one unit.

Unit:   %[2]s
Weight: %[3]s
Branch: %[4]s (you are on it, in your own worktree)

What was found:
%[5]s

How to work:
- Read AGENTS.md for how to build, test and verify this project.
- Read .delta-flume/vessels/%[1]s/%[6]s.md if the project has it. It says what this instance does here and what it leaves alone.
- Read .delta-flume/vessels/README.md if the project has it, for commands and procedures only vessels need.
- Make the change, verify it, and commit on this branch.

What flume enforces:
- Stay on this branch. Do not create or switch branches.
- Publish with "flume push". A plain "git push" is denied.
- Open the pull request with: flume pr -title "<title>" -body-file <file>
  Run it again to change the title or the description.
- The description records the source, your reasoning, and the decision you ask a human for.
- A human merges. Do not merge.
`, u.Key.Vessel, u.Key, u.Weight, u.Key.Branch(), pretty(u.Content), u.Key.Instance)
}

// updateMessage tells an agent that its unit came back with new input.
func updateMessage(u unit.Unit) string {
	return fmt.Sprintf(`The unit %[1]s has new input. It keeps its branch %[2]s and its pull request.

What was found now:
%[3]s

Update the change, verify it, commit, and run "flume push". If the title or the description no longer fits, run: flume pr -title "<title>" -body-file <file>
`, u.Key, u.Key.Branch(), pretty(u.Content))
}

func pretty(content json.RawMessage) string {
	var out bytes.Buffer
	if err := json.Indent(&out, content, "", "  "); err != nil {
		return string(content)
	}
	return out.String()
}
