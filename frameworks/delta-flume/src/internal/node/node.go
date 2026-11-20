// Package node is one machine that works on units. It asks the server what
// it should be working on, makes that so, and reports what came of it. It
// keeps nothing between runs: the server's answer is always the whole
// picture.
package node

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/agent"
	"github.com/jonaswahringer/delta-flume/src/internal/gateway"
	"github.com/jonaswahringer/delta-flume/src/internal/repo"
	"github.com/jonaswahringer/delta-flume/src/internal/unit"
	"github.com/jonaswahringer/delta-flume/src/internal/wire"
)

// Server is what a node needs from the control plane.
type Server interface {
	Sync(ctx context.Context, report wire.Report) (wire.Desired, error)
	Started(ctx context.Context, started wire.Started) error
	NotStarted(ctx context.Context, failed wire.NotStarted) (unit.Unit, error)
}

// Hold is how long a node lets the server hold its question open. A change
// reaches the node at once; with nothing new it asks again this often.
const Hold = 25 * time.Second

// Node works on the units the server gives it.
type Node struct {
	// Name tells this node apart from the others.
	Name string
	// MaxRunning is how many units the node works on at once.
	MaxRunning int
	// Projects maps a project's name to its folder on this machine.
	Projects map[string]string
	Server   Server
	Provider agent.Provider
	// Base is what a unit's branch starts from. Empty means the default
	// branch of the project's origin.
	Base string
	// Logf gets one line for everything the node does.
	Logf func(format string, args ...any)
	// Quiet leaves out the starts and failed starts, which the server logs
	// too. It is for a node that shares its log with the server.
	Quiet bool

	// seen is the version of the server's last answer.
	seen int64
	// unreported holds sessions the node started and could not report, so
	// it does not start them twice.
	unreported map[unit.Key]string
}

// Run works until ctx ends. When the server does not answer, it tries
// again, a little later each time.
func (n *Node) Run(ctx context.Context) {
	const first, longest = time.Second, 30 * time.Second
	wait := first
	for ctx.Err() == nil {
		err := n.Step(ctx, Hold)
		if err == nil {
			wait = first
			continue
		}
		if ctx.Err() != nil {
			return
		}
		n.Logf("%v; trying again in %s", err, wait)
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		wait = min(wait*2, longest)
	}
}

// Step asks the server once, letting it hold the question for wait, and
// starts every unit the answer says to start.
func (n *Node) Step(ctx context.Context, wait time.Duration) error {
	report, err := n.report(wait)
	if err != nil {
		return err
	}
	desired, err := n.Server.Sync(ctx, report)
	if err != nil {
		return err
	}
	for _, u := range desired.Units {
		if u.State != unit.Starting {
			continue
		}
		if err := n.start(ctx, u); err != nil {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	n.seen = desired.Version
	return nil
}

// report is what the node tells the server about itself.
func (n *Node) report(wait time.Duration) (wire.Report, error) {
	report := wire.Report{Node: n.Name, MaxRunning: n.MaxRunning, Seen: n.seen, WaitSeconds: int(wait / time.Second)}
	for name, root := range n.Projects {
		paused, err := pausedInstances(root)
		if err != nil {
			return wire.Report{}, fmt.Errorf("project %s: %w", name, err)
		}
		report.Projects = append(report.Projects, wire.Project{Name: name, Paused: paused})
	}
	sort.Slice(report.Projects, func(i, j int) bool { return report.Projects[i].Name < report.Projects[j].Name })
	return report, nil
}

// pausedInstances names the vessel instances a project has paused, each as
// <vessel>/<instance>: the instance files that say so.
func pausedInstances(root string) ([]string, error) {
	files, err := filepath.Glob(filepath.Join(root, filepath.FromSlash(gateway.InstanceDir), "*", "*.md"))
	if err != nil {
		return nil, err
	}
	var paused []string
	for _, file := range files {
		vessel, instance := filepath.Base(filepath.Dir(file)), strings.TrimSuffix(filepath.Base(file), ".md")
		isPaused, err := gateway.Paused(root, vessel, instance)
		if err != nil {
			return nil, err
		}
		if isPaused {
			paused = append(paused, vessel+"/"+instance)
		}
	}
	return paused, nil
}

// start starts a unit's agent and tells the server what came of it. The
// server is told even when the node was asked to stop meanwhile: a unit
// left as starting with nobody working on it would never start again.
func (n *Node) start(ctx context.Context, u unit.Unit) error {
	record, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()

	session, started := n.unreported[u.Key]
	if !started {
		var err error
		if session, err = n.launch(ctx, u); err != nil {
			after, told := n.Server.NotStarted(record, wire.NotStarted{Key: u.Key, Node: n.Name, Reason: err.Error()})
			if told != nil {
				return fmt.Errorf("%s did not start (%v), and the server could not be told: %w", u.Key, err, told)
			}
			switch {
			case n.Quiet:
			case after.State == unit.DeadLetter:
				n.Logf("not started: %s (failed start %d; now a dead letter): %v", u.Key, after.FailedStarts, err)
			default:
				n.Logf("not started: %s (failed start %d; it will be tried again): %v", u.Key, after.FailedStarts, err)
			}
			return nil
		}
	}
	if err := n.Server.Started(record, wire.Started{Key: u.Key, Node: n.Name, Session: session}); err != nil {
		if n.unreported == nil {
			n.unreported = map[unit.Key]string{}
		}
		n.unreported[u.Key] = session
		return fmt.Errorf("%s started in session %s, but the server could not be told: %w", u.Key, session, err)
	}
	delete(n.unreported, u.Key)
	if !n.Quiet {
		n.Logf("started %s on %s in session %s", u.Key, u.Key.Branch(), session)
	}
	return nil
}

// launch starts the unit's agent. A unit that ran before goes back to its
// session, which still has its branch and its checkout.
func (n *Node) launch(ctx context.Context, u unit.Unit) (session string, err error) {
	root, ok := n.Projects[u.Key.Project]
	if !ok {
		return "", fmt.Errorf("node %s has no folder for project %s", n.Name, u.Key.Project)
	}
	if _, err := os.Stat(root); err != nil {
		return "", fmt.Errorf("project %s: %w", u.Key.Project, err)
	}
	if u.Session != "" {
		return u.Session, n.Provider.Send(ctx, u.Session, updateMessage(u))
	}
	base := n.Base
	if base == "" {
		if base, err = (repo.Repo{Dir: root, Git: "git"}).DefaultBranch(ctx); err != nil {
			return "", err
		}
	}
	return n.Provider.Start(ctx, agent.Job{
		Root: root, Base: base, Branch: u.Key.Branch(), Title: u.Key.String(), Message: startMessage(u),
	})
}
