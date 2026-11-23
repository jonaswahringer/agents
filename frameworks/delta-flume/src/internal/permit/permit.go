// Package permit is what a unit's agent may do outside its worktree: push
// its one branch and open its one pull request. It also puts the rules in
// place that keep the agent from doing either on its own.
package permit

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/jonaswahringer/delta-flume/src/internal/agent"
	"github.com/jonaswahringer/delta-flume/src/internal/unit"
)

// Ledger is what permit asks the server, which knows the units.
type Ledger interface {
	// Owner returns the unit that owns a branch of a project, if its agent
	// may publish now. Otherwise the error says why not.
	Owner(ctx context.Context, project, branch string) (unit.Unit, error)
	// Pushed records that the unit's agent pushed its branch.
	Pushed(ctx context.Context, key unit.Key) error
	// PullRequest records that the unit's pull request is open at url:
	// opened now, or changed.
	PullRequest(ctx context.Context, key unit.Key, url string, opened bool) error
}

// Permit asks the ledger which unit, if any, owns a branch.
type Permit struct {
	ledger Ledger
}

func New(ledger Ledger) *Permit {
	return &Permit{ledger: ledger}
}

// Checkout is the unit's worktree, as permit needs it.
type Checkout interface {
	// Branch is the branch that is checked out, or "" when none is.
	Branch(ctx context.Context) (string, error)
	// Top is the checkout's top folder.
	Top(ctx context.Context) (string, error)
	// DefaultBranch is the branch the remote calls its default.
	DefaultBranch(ctx context.Context) (string, error)
	// Push publishes one branch under its own name, and nothing else.
	Push(ctx context.Context, branch string) error
	// Exclude keeps a path out of commits.
	Exclude(ctx context.Context, path string) error
}

// Forge is where the project's pull requests live.
type Forge interface {
	// OpenPR is the URL of the open pull request for a branch, or "".
	OpenPR(ctx context.Context, branch string) (string, error)
	// CreatePR opens a pull request and returns its URL.
	CreatePR(ctx context.Context, branch, base, title, body string) (string, error)
	// EditPR changes a pull request's title, its description, or both.
	EditPR(ctx context.Context, url, title, body string) error
}

// Prepare writes the rules file into a new worktree if its branch belongs to
// a unit. It returns "" for any other branch. A branch that looks like a
// unit's but has no unit fails, so no agent starts on it without rules.
func (p *Permit) Prepare(ctx context.Context, c Checkout, project string, rules agent.Rules) (string, error) {
	branch, err := c.Branch(ctx)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(branch, unit.BranchPrefix) {
		return "", nil
	}
	if _, err := p.ledger.Owner(ctx, project, branch); err != nil {
		return "", err
	}
	top, err := c.Top(ctx)
	if err != nil {
		return "", err
	}
	file := filepath.Join(top, rules.File)
	switch existing, err := os.ReadFile(file); {
	case errors.Is(err, os.ErrNotExist):
	case err != nil:
		return "", err
	case string(existing) == string(rules.Content):
		return file, nil
	default:
		return "", fmt.Errorf("%s exists with other content; flume will not overwrite it", file)
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(file, rules.Content, 0o644); err != nil {
		return "", err
	}
	return file, c.Exclude(ctx, rules.File)
}

// Push publishes the checked-out branch if it belongs to a unit.
func (p *Permit) Push(ctx context.Context, c Checkout, project string) (unit.Unit, error) {
	u, err := p.owner(ctx, c, project)
	if err != nil {
		return unit.Unit{}, err
	}
	if err := c.Push(ctx, u.Key.Branch()); err != nil {
		return unit.Unit{}, err
	}
	return u, p.ledger.Pushed(ctx, u.Key)
}

// PR opens the pull request for the checked-out branch if it belongs to a
// unit, or updates the one that is open. The unit then waits at Land. It
// returns the URL and whether the pull request is new.
func (p *Permit) PR(ctx context.Context, c Checkout, forge Forge, project, base, title, body string) (url string, opened bool, err error) {
	u, err := p.owner(ctx, c, project)
	if err != nil {
		return "", false, err
	}
	branch := u.Key.Branch()
	if body != "" {
		body = strings.TrimRight(body, "\n") + "\n\n---\nUnit: `" + u.Key.String() + "`\n"
	}
	url, err = forge.OpenPR(ctx, branch)
	if err != nil {
		return "", false, err
	}
	switch {
	case url == "":
		if title == "" || body == "" {
			return "", false, errors.New("a new pull request needs a title and a description")
		}
		if base == "" {
			if base, err = c.DefaultBranch(ctx); err != nil {
				return "", false, err
			}
		}
		if url, err = forge.CreatePR(ctx, branch, base, title, body); err != nil {
			return "", false, err
		}
		opened = true
	case title != "" || body != "":
		if err := forge.EditPR(ctx, url, title, body); err != nil {
			return "", false, err
		}
	}
	return url, opened, p.ledger.PullRequest(ctx, u.Key, url, opened)
}

func (p *Permit) owner(ctx context.Context, c Checkout, project string) (unit.Unit, error) {
	branch, err := c.Branch(ctx)
	if err != nil {
		return unit.Unit{}, err
	}
	if !strings.HasPrefix(branch, unit.BranchPrefix) {
		return unit.Unit{}, fmt.Errorf("branch %q is not a unit's branch", branch)
	}
	return p.ledger.Owner(ctx, project, branch)
}
