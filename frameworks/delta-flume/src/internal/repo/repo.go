// Package repo is a git checkout, such as a unit's worktree, and its pull
// requests on GitHub.
package repo

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/cmdx"
)

// Repo is the checkout at Dir. Git and GH are the binaries to run.
type Repo struct {
	Dir string
	Git string
	GH  string
}

const (
	// gitLimit is how long one git command may take. A push is the slow one.
	gitLimit = 2 * time.Minute
	// ghLimit is how long one call to GitHub through gh may take.
	ghLimit = time.Minute
)

func (r Repo) git(ctx context.Context, args ...string) (string, error) {
	cmd := cmdx.Command(ctx, gitLimit, r.Git, args...)
	cmd.Dir = r.Dir
	out, err := cmd.Output()
	return strings.TrimSpace(string(out)), err
}

func (r Repo) gh(ctx context.Context, args ...string) (string, error) {
	cmd := cmdx.Command(ctx, ghLimit, r.GH, args...)
	cmd.Dir = r.Dir
	out, err := cmd.Output()
	return strings.TrimSpace(string(out)), err
}

// Branch is the branch that is checked out, or "" when none is.
func (r Repo) Branch(ctx context.Context) (string, error) {
	branch, err := r.git(ctx, "rev-parse", "--abbrev-ref", "HEAD")
	if branch == "HEAD" {
		branch = ""
	}
	return branch, err
}

// Top is the checkout's top folder.
func (r Repo) Top(ctx context.Context) (string, error) {
	return r.git(ctx, "rev-parse", "--show-toplevel")
}

// GitHub is the checkout's repository on GitHub, as owner/name, read from
// the origin remote. It is "" when origin is not on GitHub.
func (r Repo) GitHub(ctx context.Context) (string, error) {
	url, err := r.git(ctx, "config", "--get", "remote.origin.url")
	if err != nil {
		return "", err
	}
	return GitHubName(url), nil
}

// GitHubName is owner/name for a GitHub remote URL, such as
// git@github.com:owner/name.git or https://github.com/owner/name, and ""
// for any other URL.
func GitHubName(url string) string {
	for _, prefix := range []string{"git@github.com:", "ssh://git@github.com/", "https://github.com/", "http://github.com/"} {
		if path, ok := strings.CutPrefix(url, prefix); ok {
			path = strings.TrimSuffix(strings.TrimSuffix(path, "/"), ".git")
			if owner, name, ok := strings.Cut(path, "/"); ok && owner != "" && name != "" && !strings.Contains(name, "/") {
				return path
			}
		}
	}
	return ""
}

// DefaultBranch is the branch the remote calls its default, such as main.
func (r Repo) DefaultBranch(ctx context.Context) (string, error) {
	head, err := r.git(ctx, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
	if err != nil {
		return "", fmt.Errorf("the default branch of origin is unknown (%w); run `git remote set-head origin --auto`", err)
	}
	return strings.TrimPrefix(head, "origin/"), nil
}

// Push publishes one branch to origin under its own name, and nothing else.
// It never forces.
func (r Repo) Push(ctx context.Context, branch string) error {
	_, err := r.git(ctx, "push", "origin", "refs/heads/"+branch+":refs/heads/"+branch)
	return err
}

// Exclude keeps a path out of git without touching the project's .gitignore.
func (r Repo) Exclude(ctx context.Context, path string) error {
	// git check-ignore exits 0 for an ignored path and 1 for one that is not.
	_, err := r.git(ctx, "check-ignore", "-q", path)
	if err == nil {
		return nil // already ignored
	}
	if code, exited := cmdx.ExitCode(err); !exited || code != 1 {
		return err
	}
	file, err := r.git(ctx, "rev-parse", "--git-path", "info/exclude")
	if err != nil {
		return err
	}
	if !filepath.IsAbs(file) {
		file = filepath.Join(r.Dir, file)
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(file, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(f, "\n# flume: the agent's rules stay out of commits\n%s\n", path); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// OpenPR is the URL of the open pull request for a branch, or "".
func (r Repo) OpenPR(ctx context.Context, branch string) (string, error) {
	return r.gh(ctx, "pr", "list", "--head", branch, "--state", "open", "--json", "url", "--jq", `.[0].url // ""`)
}

// CreatePR opens a pull request from branch into base and returns its URL.
func (r Repo) CreatePR(ctx context.Context, branch, base, title, body string) (string, error) {
	out, err := r.gh(ctx, "pr", "create", "--head", branch, "--base", base, "--title", title, "--body", body)
	if err != nil {
		return "", err
	}
	lines := strings.Split(out, "\n")
	url := strings.TrimSpace(lines[len(lines)-1])
	if !strings.HasPrefix(url, "https://") {
		return "", fmt.Errorf("gh pr create printed no URL: %q", out)
	}
	return url, nil
}

// EditPR changes a pull request's title, its description, or both. An empty
// one is left as it is.
func (r Repo) EditPR(ctx context.Context, url, title, body string) error {
	args := []string{"pr", "edit", url}
	if title != "" {
		args = append(args, "--title", title)
	}
	if body != "" {
		args = append(args, "--body", body)
	}
	_, err := r.gh(ctx, args...)
	return err
}
