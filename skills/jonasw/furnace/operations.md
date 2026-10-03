# Tracker and services

Resolve `<agents-root>` from this skill's real installed path. In commands below,
`furnace` means `python3 "<agents-root>/tools/furnace/furnace.py"`. The shell wrapper
in the same folder is equivalent. No new dependency or server is needed.

```sh
furnace add 'Explore a simpler reconnect flow'
furnace add 'Fix reconnect after sleep' --repo /absolute/project \
  --brief 'Reproduce and repair the saved-session reconnect failure.' \
  --done-when 'Reconnect works after sleep and the regression check passes.' --ready
furnace list
furnace show ITEM_ID
furnace edit ITEM_ID --status ready --repo /absolute/project --done-when 'Concrete outcome'
furnace claim ITEM_ID --owner 'exact thread or session reference'
furnace report
```

`--state-dir /absolute/private/path` goes before the command. Claims are atomic.
Only one active item per repository can be claimed. A scheduled workflow also
limits itself to one active item across the backlog. Claims do not expire.

Write a private JSON file, then call:

```sh
furnace checkpoint ITEM_ID --run RUN_ID --status review --file /private/result.json
```

All result fields are strings. Omitted fields retain the previous checkpoint.
For automatic quota continuation, also save the actual `session_id`, `session_kind`
(`cli` or `t3`) and authorized `resume_expires` timestamp with a timezone. The
workflow can arm the existing service after the runner exits when `auto_resume`
is enabled in private configuration. It refuses to infer these values. A new claim
drops the previous run's session fields, so each run saves its own.

```json
{
  "summary": "Reconnect now restores the saved session after sleep.",
  "changes": "Retry after wake uses the saved session ID.",
  "checks": "Reconnect regression and project checks passed; device test skipped.",
  "missing": "Device test and human review remain.",
  "next_action": "Review the PR and run the device check before merging.",
  "merge": "draft; device behavior is unverified",
  "pr": "https://github.com/owner/repo/pull/123",
  "branch": "furnace/ITEM_ID-reconnect",
  "worktree": "/absolute/worktree",
  "report": "/private/report.md or a reachable published URL"
}
```

Use `running` for progress, `waiting_quota` for a quota pause, `review` for a
handoff, `done` for met done-when, and `blocked` for an unresolved problem. Failed
or interrupted launches remain claimed or blocked for inspection, never silently
requeued. Inspect files, branches, PRs, and continuations before manually releasing
an interrupted claim with an owned checkpoint. Cancel a pending auto-resume job
before releasing its item. `edit` refuses active items.

## Workflow

The existing service accepts `run furnace`, `tick furnace`, `collect furnace`,
`status furnace`, and `history furnace`. See
[tools/furnace/README.md](../../../tools/furnace/README.md) for private configuration.
`collect` checks eligibility without claiming work or invoking an agent. `run` and
`tick` each launch at most one ready item, using the configured agent command.
The agent receives this skill, item, owned run ID and exact tracker state path on
stdin. It must checkpoint the item. A successful process exit alone is not success.

The default schedule policy is the user's 48-hour window and 10% reserve. Quota
must be fresh and from the same subscription account as the configured agent.
All reported windows count; configure the exact weekly label from
`<agents-root>/bin/usage --json`. This avoids an unrelated system command named `usage`.
If allowance falls below the reserve during a task, checkpoint and stop. One task
can overshoot between checks; this is not a hard token limiter.

## Auto-resume

After a `waiting_quota` checkpoint:

```sh
furnace arm ITEM_ID --run RUN_ID --provider codex --kind cli \
  --target EXACT_SESSION_UUID --expires ISO_TIMESTAMP_WITH_TIMEZONE --same-account
```

For T3 use `--kind t3` and the exact thread ID. This delegates to the existing
auto-resume CLI and saves its job ID. The prompt contains the same item, skill,
scope and tracker path. Use `--resume-state-dir` for an existing nondefault queue.
Arming does not activate its timer or change adapter configuration.

Inspect that service's `show JOB_ID` and `list`. It allows one accepted continuation
per job. The resumed agent must still write a final Furnace checkpoint. The
default T3 adapter refuses the non-atomic dispatch path; preserve that refusal.
If arming is interrupted, the tracker retains an `arming` marker. Inspect the
auto-resume queue before any recovery to avoid duplicate continuations.
After inspecting a terminal job, `clear-resume ITEM_ID --run RUN_ID --reviewed`
clears its link so another limit stop can be armed. Pending and dispatching jobs
cannot be cleared. The same explicit recovery clears an uncertain arming marker
only after manually checking the queue and session.
