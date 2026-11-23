// Package claudecode holds what is particular to Claude Code as the program
// a unit's agent runs in: the form of its rules.
package claudecode

import (
	"encoding/json"

	"github.com/jonaswahringer/delta-flume/src/internal/agent"
)

// denied is what a unit's agent may not run itself. flume push and flume pr
// publish, flume names the branch, and a human merges. These are prefixes of
// shell commands. They stop a mistake, not an agent that works around them:
// the agent runs as the same user and could reach git by other spellings.
var denied = []string{
	"git push",
	"git checkout -b", "git checkout -B", "git switch", "git branch", "git worktree", "git remote",
	"gh pr create", "gh pr edit", "gh pr merge", "gh pr close", "gh pr reopen", "gh pr ready",
	"gh api", "gh repo", "gh release", "gh workflow", "gh secret", "gh auth",
}

// file is where the rules go, relative to the worktree's top folder. Claude
// Code reads it as the project's local settings.
const file = ".claude/settings.local.json"

// Rules are the deny rules for a unit's agent, as Claude Code reads them.
// Deny rules hold in every permission mode, full access included.
func Rules() agent.Rules {
	return agent.Rules{File: file, Content: content()}
}

func content() []byte {
	deny := []string{
		// The bare command publishes too.
		"Bash(git push)",
		// A push behind git's own options, such as "git -C . push". This also
		// denies any other git command with the word push among its
		// arguments, such as a commit message that contains it.
		"Bash(git * push)", "Bash(git * push *)",
	}
	for _, command := range denied {
		deny = append(deny, "Bash("+command+" *)")
	}
	out, err := json.MarshalIndent(map[string]any{"permissions": map[string]any{"deny": deny}}, "", "  ")
	if err != nil {
		panic(err) // a map of strings always marshals
	}
	return append(out, '\n')
}
