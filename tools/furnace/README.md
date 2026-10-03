# Furnace

Save ideas at any time, make specific tasks ready, and spend spare weekly allowance
on reviewable work. The `furnace` skill drives the work. This small Python 3.9+
standard-library tracker stores ideas, claims, checkpoints and results in SQLite.
The existing workflows service launches tasks; auto-resume handles exact-session
continuations after a limit. Furnace never merges PRs.

## Use on the Mac mini

Run from this checkout, or use its absolute path:

```sh
python3 tools/furnace/furnace.py add 'Investigate a better reconnect flow'
python3 tools/furnace/furnace.py add 'Repair reconnect after sleep' \
  --repo /absolute/project --brief 'Reproduce the saved-session failure.' \
  --done-when 'Reconnect after sleep works and its regression check passes.' --ready
python3 tools/furnace/furnace.py list
python3 tools/furnace/furnace.py show ITEM_ID
python3 tools/furnace/furnace.py report
```

In chat use `$furnace add ...`, `$furnace run`, or `$furnace review`. Installing the
skill makes these requests discoverable; the tracker does not require installation.
Use `agents skills` to select `jonasw/furnace` through the normal installer.

State defaults to `$XDG_STATE_HOME/agents/furnace`, or
`~/.local/state/agents/furnace`. `--state-dir /private/path` before a tracker command
overrides it. Directory mode is 700 and files are private. Do not place state inside
a source repository or share the SQLite file across machines. The skill and tool
travel through Git; the private backlog stays on the machine running them.

Ideas can be rough. `--ready` requires a repository and done-when. Larger numbers
in `--priority` run first. `edit ITEM_ID --status ready ...` promotes a prepared
idea. Inspect state and existing branches/PRs before promoting or running work.

Claims are atomic and identify an owned run ID. Only one item per repository can
be active. `checkpoint ITEM_ID --run RUN_ID --status STATUS --file PRIVATE_JSON`
saves progress. Its result fields and the handoff format are documented in the
[skill operations](../../skills/jonasw/furnace/operations.md).

## Connect the workflow

Add a `furnace` object to your existing private workflows JSON, preserving its
other fields. For a separate config, put only this object in a private JSON file.
No live config, timer, provider process, PR or notification is created by setup.

```json
{
  "furnace": {
    "enabled": false,
    "provider": "codex",
    "same_account": false,
    "auto_resume": false,
    "weekly_window": "Weekly",
    "within_hours": 48,
    "reserve_percent": 10,
    "usage_command": ["/Users/minj/Projects/agents/bin/usage"],
    "agent_command": ["/absolute/path/to/your/agent-runner"],
    "command_timeout_seconds": 30,
    "agent_timeout_seconds": 3600
  }
}
```

The example is intentionally disabled. Select an authorized subscription runner
and confirm it uses the same account as `usage`, then set `same_account` and
`enabled` to true. The runner receives the skill, item, owned run ID and tracker
path on stdin, runs in the item repository, and must write a final checkpoint.
Commands are argv arrays; no shell interpolation occurs. For an existing Codex CLI
subscription setup, `["/absolute/path/to/codex", "exec", "-"]` accepts stdin.
Its existing approval and sandbox settings still apply. Test the runner's access
to worktrees, the private tracker and GitHub before unattended use. Do not add
approval-bypass flags. T3 runners must use T3's own session controls.

To arm continuations automatically after the runner exits, set `auto_resume` true.
The runner must save its actual `session_id`, `session_kind` (`cli` or `t3`) and
an authorized `resume_expires` timestamp in its checkpoint before it hits quota.
When that checkpoint says `waiting_quota`, the workflow delegates arming to the
existing auto-resume service and saves the receipt. That continuation keeps the
configured reserve and expires at the weekly reset, even if the checkpoint asked
for later. Missing session metadata or an adapter refusal leaves the checkpoint
visible with a setup/recovery message; Furnace never guesses a session. A new
claim drops the previous run's session fields, so a requeued item cannot resume
an old session. `resume_state_dir` can name your existing queue.
The adapter's idle-thread and dispatch guards still apply after the runner exits.

Check the exact weekly label with `python3 bin/usage --json --only PROVIDER` from
the agents checkout; Claude's label
may differ. `collect` confirms eligibility without launching an agent:

```sh
python3 tools/workflows/workflows.py collect furnace --config /private/workflows.json
python3 tools/workflows/workflows.py run furnace --config /private/workflows.json
python3 tools/workflows/workflows.py status furnace
python3 tools/workflows/workflows.py history furnace
```

`--furnace-state-dir` points at the tracker state. The digest's `--state-dir` stays
independent. Each `run` or `tick` handles at most one item. A claim left by an
interrupted process or a waiting continuation stops later ticks for inspection.
No successful process exit is labeled task completion without a checkpoint.

Scheduled work starts only within 48 hours of the configured weekly reset and
while every reported window has more than 10% allowance remaining. Missing,
stale or malformed quota defers work. The agent checks allowance during work.
One large operation can overshoot the reserve between checks; the percentage is
not a hard spending cap. No automatic provider or paid API fallback is configured.

An optional timer can invoke `tick furnace` every few minutes using absolute paths
and the same private config. Keep the existing auto-resume timer separate. Nothing
here installs or edits cron, launchd, or a background service.

## Continue after a quota limit

Checkpoint `waiting_quota`, then arm the existing service through the tracker:

```sh
python3 tools/furnace/furnace.py arm ITEM_ID --run RUN_ID \
  --provider codex --kind cli --target EXACT_SESSION_UUID \
  --expires ISO_TIMESTAMP_WITH_TIMEZONE --same-account
```

Use the actual account, idle session ID and expiry, not these placeholders. Use
`--kind t3` for a T3 thread and `--resume-state-dir` for a custom queue. Add
`--reserve-percent 10` to keep the reserve as scheduled runs do. This stores
the auto-resume job ID and includes the original scope and checkpoint in its prompt.
The existing service checks all quota windows and allows one accepted continuation.
The agent still needs to finish the task and write its result. Another quota stop
needs a new armed job. Inspect the old job/session, then use
`clear-resume ITEM_ID --run RUN_ID --reviewed` to clear a terminal job's link before
rearming. It refuses pending or dispatching jobs. An uncertain `arming` marker
requires manual queue inspection before the same explicit recovery.

Cancel a pending job before releasing or requeueing its item. Never requeue a
running or uncertain session. The tracker cannot independently detect every human
action in a provider session. [Auto-resume's limits](../auto-resume/README.md) apply.
The default T3 adapter refuses its non-atomic resume path; Furnace does not enable
the experimental mode or extract credentials. Neither service is a persistent
goal-completion loop. Work continues through scheduled ticks and explicitly armed
continuations, with each result saved in Furnace.

## Review the work

`report` gives each task's outcome, PR/deliverable, checks, missing work, merge
assessment and next action. History retains checkpoints and previous runs. PR
readiness is an agent assessment, not approval to merge. Recheck current CI,
conflicts, base changes and reviews. PRs awaiting a human stay `review`, not `done`.

Records are local Mac mini files. PR URLs are available on your other devices;
larger reports can use the existing HTML report publisher for a reachable tailnet
URL. No localhost service is needed.

## Verification

```sh
python3 -m unittest discover -s tools/furnace -p 'test_*.py' -v
python3 -m unittest discover -s tools/workflows -p 'test_*.py' -v
python3 -m unittest discover -s tools/auto-resume/tests -p 'test_*.py' -v
```

Tests use temporary homes and paths with spaces, stub agents and quota responses,
and real local tracker/auto-resume commands. They do not call providers, create PRs,
send notifications, or activate scheduling.
