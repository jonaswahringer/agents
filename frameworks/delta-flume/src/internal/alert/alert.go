// Package alert is the contract for telling a human about a unit. A vessel
// instance names its channels in its front matter, such as
// "alerts: github-issue", and the server sends each alert to each of them.
package alert

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/cmdx"
	"github.com/jonaswahringer/delta-flume/src/internal/unit"
)

// Alert is one thing a human must know about a unit.
type Alert struct {
	Key    unit.Key
	Weight unit.Weight
	// Kind is what happened, such as "stuck" or "asking".
	Kind string
	// Text says what happened and what the unit is.
	Text string
}

// Title is the alert's one line.
func (a Alert) Title() string { return "flume: " + a.Key.String() + " is " + a.Kind }

// Target is where a project's alerts can go.
type Target struct {
	// Repo is the project's repository on GitHub, as owner/name.
	Repo string
}

// Channel tells a human. Send returns where the alert can be found, such as
// an issue's URL.
type Channel interface {
	Send(ctx context.Context, target Target, a Alert) (where string, err error)
}

// GitHubIssue opens an issue in the project's repository, with gh. GH is the
// binary to run; it needs a login that may open issues there.
type GitHubIssue struct{ GH string }

// ghLimit is how long gh may take to open the issue.
const ghLimit = time.Minute

func (c GitHubIssue) Send(ctx context.Context, target Target, a Alert) (string, error) {
	if target.Repo == "" {
		return "", errors.New("the project's repository on GitHub is not known")
	}
	body := a.Text + "\n\nUnit: `" + a.Key.String() + "`\nWeight: " + a.Weight.String() + "\nBranch: `" + a.Key.Branch() + "`\n"
	out, err := cmdx.Command(ctx, ghLimit, c.GH, "issue", "create", "--repo", target.Repo, "--title", a.Title(), "--body", body).Output()
	return strings.TrimSpace(string(out)), err
}
