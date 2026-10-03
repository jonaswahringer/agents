---
name: furnace
description: Keep a backlog of ideas and agent work, then complete ready tasks before unused weekly allowance resets. Use for Furnace capture, queue, run, resume, and review requests.
---

# Furnace

Turn spare allowance into finished work the user can understand and review quickly.
Capture loose ideas at any time. Execute only work the user has made ready or has
asked you to do now. A suggestion in the backlog is not permission to implement it.

## Find the tracker and state

Resolve the repository containing this skill by following its installed symlink.
The tracker is `tools/furnace/furnace.py` in that repository. Run it with Python 3.9+
and quote every path. Use the state root supplied by the current workflow or user;
otherwise use `$XDG_STATE_HOME/agents/furnace`, or `~/.local/state/agents/furnace`.
Records stay outside source repositories and survive skill updates.

Read [operations.md](operations.md) for commands and service integration. Use the
existing workflows service to start scheduled work and auto-resume to continue an
exact session after a quota limit. Do not build another scheduler or quota poller.

## Capture and prepare

- `furnace add <idea>` saves an idea without interrogating the user or starting work.
  Preserve their wording and any links, repo, dependencies, and uncertainty.
- Queue requests define a concrete done-when, repository and priority. Save a task
  as `ready` only when the user authorizes that scope. Missing decisions stay in
  the brief; ask only for a decision that is needed to execute safely.
- List and review requests read the tracker and report current results. Do not
  treat them as an instruction to launch work.

## Check state before doing work

Read the item, previous runs, checkpoints, continuation job, and linked artifacts.
Inspect the repo's instructions and working tree. Check `git status`, local and
remote branches, `git worktree list`, relevant recent commits, and open and merged
PRs. Fetch current remote refs when available; record a failed fetch as uncertainty.
Look for implementation evidence in the diff or code, not just a matching title.

If work already exists, continue or review it within its recorded scope. A matching
merged PR or code that meets done-when ends the item with that evidence. A closed
unmerged PR does not establish completion. If another run owns the item, leave its
claim alone. A stale-looking claim needs inspection before explicit recovery.

Claim ready work through the tracker before changing files. Workflow-assigned
items already contain the owned run ID. Reuse that claim rather than claiming again.

## Execute in a separate worktree

Write a short plan before substantial edits. Base a new worktree and a uniquely
named `furnace/<item-id>-<slug>` branch on the repository's verified target branch.
Keep the worktree outside the user's working checkout. Record its absolute path,
branch, and base before implementation. Preserve unrelated dirty files and work.
Resume an existing worktree after inspecting it; do not create a duplicate PR.

Work toward done-when, verify the changed behavior with appropriate checks, and
inspect the final diff. Split independent changes when they can be reviewed alone.
Use the project's package manager and checks. Save a checkpoint after each completed
piece and before lengthy operations, so a limit hit does not lose the next action.

For this user's Furnace runs, automatic creation of worktrees and PRs is authorized,
including the necessary new commits and pushes of the task branch. Show the commit
headline in the progress update and proceed within that scope. This authorization
does not include force pushes, amending remote commits, tags, merging, deployment,
or unrelated external actions. For another user, establish their equivalent
authorization before those actions. Preserve the authorization in resume prompts.

Open or update a PR against the recorded base. Put a concrete before/after behavior,
validation and remaining gaps in its description. Use a draft when required checks
or done-when are incomplete. Register every PR with the thread through T3's
`link_pull_request` when available, including an existing PR you start working on.
Reconcile the thread's PR links before finishing. Never merge or enable auto-merge.

## Allowance and continuation

Scheduled work starts within 48 hours of the configured weekly reset and preserves
a 10% reserve across applicable quota windows. Check `<agents-root>/bin/usage`
for the active subscription at task boundaries and before starting another large
piece. Percentages are an allowance estimate, not a precise token budget. Do not
invent remaining tokens or reset times; save progress and stop at the reserve.

An interactive run may have a user-supplied task/time/token budget. Honor it without
adding an arbitrary stop after one useful task. For a scheduled run, finish or
checkpoint its one assigned item; the next workflow tick selects the next task.
Do not wait through a reset, switch to a paid API, or bypass provider permissions.

Before a possible limit hit, save the actual `session_id`, `session_kind` and the
user-authorized `resume_expires` timestamp in a checkpoint when those are known.
On a limit hit, checkpoint `waiting_quota` with the worktree, branch, completed
pieces, pending checks and next step. With `auto_resume` enabled, the workflow arms
that exact session after the runner exits, respecting the adapter's idle guard.
Use the tracker's `arm` command for an authorized, exact, idle session and record
its returned auto-resume job. The account assertion and expiry must be known;
never guess an ID or use `--last`. T3's default adapter may refuse dispatch. Record
that refusal, preserve the checkpoint, and explain the one setup action needed.

Auto-resume accepting a continuation does not prove completion. A continuation
first rereads tracker, repo, PR and job state, then updates the same owned run.
Another limit hit needs another explicitly armed job after inspecting the old one.
Do not replay an uncertain launch or clear claims simply because time passed.

## Hand off results

Keep the final reply short enough to decide what to inspect next. For each item,
state the outcome and link the PR or deliverable, then give:

- What changed and why it matters, with a concrete behavior example when helpful.
- Checks that passed, failed or were skipped, and what remains unverified.
- Missing work and any decision the user needs to make.
- Merge assessment: ready for review, draft, blocked, or already completed.
  Recheck current PR CI, base drift, conflicts and outstanding reviews before saying
  ready for review. Say when any of those could not be checked.
- The next action, repository, branch/worktree and machine where changes live.

Save the same facts in the tracker, with durable artifact paths and URLs. A PR
awaiting a human review has status `review`; it is not `done`. Use `done` only when
the recorded done-when is met, such as verified research output or a confirmed merge.
The user's decision remains theirs. Never imply an agent assessment grants merge
approval. For a batch, give one compact row per item and link deeper evidence.

Follow `nice` for prose. Use `html-communication` when the user requests HTML or a
long report benefits from it, and use the configured report publisher for a URL
reachable from their MacBook/iPhone. Otherwise chat plus the tracker report suffices.
Never ask them to open the Mac mini's localhost or imply local files exist on their
MacBook. Report where commits were pushed and what still needs syncing.
