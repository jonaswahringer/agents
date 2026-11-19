# Tracker operations

Resolve `<agents-root>` from this skill's real installed path. Below, `furnace`
means the installed command or `python3 "<agents-root>/tools/furnace/furnace.py"`.

```sh
furnace add 'Explore a simpler reconnect flow'
furnace add 'Fix reconnect after sleep' --repo /absolute/project \
  --brief 'Reproduce the saved-session failure.' \
  --done-when 'Reconnect works and its regression check passes.' --ready
furnace list
furnace show ITEM_ID
furnace edit ITEM_ID --status ready --repo /absolute/project --done-when 'Concrete outcome'
furnace claim ITEM_ID --owner 'exact T3 thread or session reference'
furnace report
```

Use `--state-dir /absolute/private/path` before the command to override the
machine-local state directory. Claims are atomic, do not expire, and allow one
active item per repository. A suggestion is not permission to execute it.

## Checkpoints

Write a private JSON file, then run:

```sh
furnace checkpoint ITEM_ID --run RUN_ID --status review --file /private/result.json
```

Result fields are strings; omitted fields retain the previous checkpoint:

```json
{
  "summary": "Reconnect now restores the saved session after sleep.",
  "changes": "Retry after wake uses the saved session ID.",
  "checks": "Regression passed; device test skipped.",
  "missing": "Device test and human review remain.",
  "next_action": "Review the PR and run the device check.",
  "merge": "draft; device behavior is unverified",
  "pr": "https://github.com/owner/repo/pull/123",
  "branch": "furnace/ITEM_ID-reconnect",
  "worktree": "/absolute/worktree",
  "report": "/private/report.md or a reachable report URL"
}
```

Use `running` for progress, `waiting_quota` for a quota stop, `review` for a
handoff, `done` for met done-when, and `blocked` for an unresolved problem.
T3 Code handles scheduling and continuation. Record `session_id`, `session_kind`
and `resume_expires` when known; a new claim drops the previous run's session
fields. A resumed session must use the same owned run and reread current state.

## Legacy continuation recovery

Existing links to the retired continuation queue are preserved. Inspect the exact
session and queue before `clear-resume ITEM_ID --run RUN_ID --reviewed`.
The command reads the old queue without running a service, and refuses pending
or dispatching jobs. The explicit review flag also permits recovery of an
uncertain `arming` marker after inspection. Archived implementations remain
on `archive/t3-runtime-tools`; Furnace no longer arms continuations.
