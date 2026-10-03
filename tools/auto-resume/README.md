# Auto-resume

Arm one continuation for an exact Codex, Claude Code, Cursor CLI session, or a
T3 thread. A cron tick checks subscription quota and resumes only when every
selected window has room. Python 3 and the standard library run the queue. It
uses POSIX file locks and supports macOS and Linux.

For T3 threads, prefer the new orchestrator's native
[Resume at reset](https://github.com/pingdotgg/t3code/pull/12686) once your installed
build includes it. It reached main on 2026-10-02 through
[the orchestrator merge](https://github.com/pingdotgg/t3code/pull/2829), after
`v0.0.45-nightly.20261002.2595` was published. Use this queue for standalone CLI
sessions; leave the experimental T3 adapter disabled. Native recovery requires a
known reset time and a running T3 server. See the
[T3 thread guide](https://github.com/pingdotgg/t3code/blob/main/docs/user/thread-sidebar.md)
for per-thread Resume at reset and the Auto-resume limited threads setting.

The tool does not watch a goal until completion. A successful continuation ends
the armed job with `resumed`. Arm a new job if that continuation later runs out
of quota. `resumed` means the CLI returned successfully or T3 accepted the
message, not that the task is finished.

## Configure on the Mac mini

Run commands on `minj`, where provider sessions and logins exist. The commands
below use the integrated checkout at `/Users/minj/Projects/agents`. Changes made
in another checkout must be copied there before these paths work. No network
service or localhost page is involved.

Private state defaults to `$XDG_STATE_HOME/agents/auto-resume`, or
`~/.local/state/agents/auto-resume`. `--state-dir /absolute/path` overrides it.
The directory contains `config.json`, `jobs.sqlite3`, `tick.lock`, and provider
output in `logs/<job-id>.log`. State is private and must live outside this
repository. State includes prompts and working directories; keep it off shared
storage. SQLite stores each state transition in a history table.

Configuration is optional for ordinary CLI sessions. By default quota comes
from this checkout's `bin/usage`, and provider commands are `codex`, `claude`,
and `cursor-agent` on PATH. Under cron, absolute executable paths are safer.
Create this private file yourself after choosing paths for the machine:

```json
{
  "usage_command": ["/Users/minj/Projects/agents/bin/usage"],
  "provider_commands": {
    "codex": ["/Users/minj/.local/bin/codex"],
    "claude": ["/Users/minj/.local/bin/claude"],
    "cursor": ["/Users/minj/.local/bin/cursor-agent"]
  },
  "t3_adapter": null,
  "check_timeout_seconds": 30,
  "dispatch_timeout_seconds": 3600,
  "retry_delay_seconds": 60
}
```

Commands are argv arrays, never shell snippets. Provider entries accept one
executable path; the tool adds fixed resume arguments. Configuration does not
offer extra model, fallback, or approval-bypass flags.

## Arm, inspect, and cancel

Only arm work stopped by quota that still has an authorized task to finish.
Confirm that `usage` and the target use the same subscription login. The
`--same-account` flag records that assertion; the tool cannot independently
compare account identities across all provider and T3 configurations.

```sh
/Users/minj/Projects/agents/tools/auto-resume/auto-resume arm \
  --provider codex \
  --kind cli \
  --target 00000000-0000-4000-8000-000000000000 \
  --cwd /Users/minj/Projects/my-project \
  --expires 2026-10-03T18:00:00+02:00 \
  --max-retries 3 \
  --max-attempts 3 \
  --buffer 30 \
  --same-account \
  --prompt 'Finish the authorized task. Ask before committing or pushing.'
```

Replace the example UUID, working directory, and deadline. Codex and Claude
require exact UUID session IDs. Cursor requires its exact chat ID. T3 uses its
exact thread ID and `--kind t3`. Session names, pickers, `--last`, and
`--continue` are never used. CLI dispatch is exactly:

```text
codex exec resume SESSION_ID PROMPT
claude --print --resume SESSION_ID PROMPT
cursor-agent --print --resume CHAT_ID PROMPT
```

Local CLI help confirmed these arguments during implementation. No real
continuation was sent in verification.

```sh
/Users/minj/Projects/agents/tools/auto-resume/auto-resume list
/Users/minj/Projects/agents/tools/auto-resume/auto-resume show JOB_ID
/Users/minj/Projects/agents/tools/auto-resume/auto-resume cancel JOB_ID
/Users/minj/Projects/agents/tools/auto-resume/auto-resume tick
```

All commands return JSON; errors go to stderr and return nonzero. `show` includes
history. Cancellation can stop pending work even during a quota check. Once a
dispatch is claimed, cancellation reports that it cannot withdraw the active
continuation. Stop that provider process or T3 turn through its own controls.
Two active jobs cannot target the same provider/session at once.

## Quota and retries

Each due job invokes `usage --json --only PROVIDER`. The queue reads the existing
array schema: provider display name, `ok`, `stale_at`, and `windows` with
`label`, `used_percent`, and `resets_at`. Fresh success requires `ok: true`, no
stale marker, at least one window, and finite percentages for selected windows.

The default checks every reported quota window, including model buckets. To
select applicable buckets, repeat `--window 'Exact label from usage --json'`.
Missing selected labels defer rather than silently ignoring a quota. Selecting
only a model bucket can omit an aggregate limit, so include all limits that
apply to that session. No model or provider is changed.

An exhausted window has `used_percent >= 100`. With `--reserve-percent N`, a
window with N percent or less left counts as exhausted too, so the continuation
leaves that reserve unspent. The default is 0. The next check is the latest
necessary reset plus `--buffer`, an integer from 0 to 60 seconds, default 30.
Other ticks do not dispatch before that time. At that time a fresh quota check
must confirm room; a timestamp passing alone is not enough. Waiting for a known
reset does not spend the retry budget. The next cron run may add up to its
interval after reset and buffer.

Missing, stale, malformed, or failed quota checks defer by
`retry_delay_seconds`. `--max-retries 3` permits three such deferrals; the fourth
failure ends the job. `--max-retries 0` ends it after its first failure.
`--max-attempts` bounds dispatch attempts independently. Expiry applies even
while a job waits for a reset beyond its deadline.

An executable that cannot start can be retried within those budgets. A T3
adapter may request a retry only with `accepted: false`, `retryable: true`, and
`not_sent: true`. Nonzero provider exits, malformed dispatch replies, timeouts,
or an interrupted scheduler may have already sent a prompt. These produce
`needs_review` and are not replayed. Inspect the session and explicitly rearm.
Timeouts kill the subprocess group before releasing the tick lock.

## T3 adapter

T3-owned threads use the adapter, not a raw provider CLI. Configure
`t3_adapter` as an argv prefix, for example:

```json
["/absolute/path/to/bun", "/Users/minj/Projects/agents/tools/auto-resume/t3-adapter.mjs", "--config", "/Users/minj/.local/state/agents/auto-resume/t3-adapter.json"]
```

The bundled adapter requires Bun and private connection settings. It was
checked against installed T3 server source for
`0.0.44-nightly.20260929.2456`, not a live authenticated thread mutation.
It checks thread status, revision, provider instance, workspace, and the pinned
server/environment configuration. Arming requires an idle thread and saves its
revision. The tick inspects it again immediately before dispatch. Running,
completed, cancelled, blocked, or changed threads require human review.

The installed T3 turn-start API has no atomic expected-revision/status guard.
The bundled adapter therefore refuses resume by default. It exposes a separate
`experimental_non_atomic_resume: true` opt-in for the verified protocol. In that
mode a person or another client can still change a thread between the final
check and the send. Choose that mode only after accepting this limitation. The
adapter checks again and uses deterministic command IDs for receipt deduplication,
but that does not make the check and send atomic.

Keep adapter credentials outside the repository. A private adapter file takes:

```json
{
  "endpoint": "http://127.0.0.1:3774",
  "token_file": "/absolute/private/path/to/t3-bearer-token",
  "environment_id": "EXACT_ENVIRONMENT_ID",
  "protocol_version": "0.0.44-nightly.20260929.2456",
  "provider_instances": {"codex": "codex", "claude": "claudeAgent"},
  "usage_account_matches_t3": true,
  "experimental_non_atomic_resume": false
}
```

Use the real server endpoint, existing bearer credential, environment, and
provider instance names. The adapter does not mint a token or decrypt Electron
credentials. Default refusal means this sample cannot arm a T3 continuation.
See [T3-ADAPTER.md](T3-ADAPTER.md) for credential setup and verified protocol limits.

A replacement verified adapter must support `inspect THREAD_ID` returning
`{ "status": "idle", "revision": "..." }`, and `resume THREAD_ID PROMPT`
returning `{ "accepted": true }`. Other inspect statuses are `running`,
`completed`, `blocked`, and `cancelled`. `resume_supported: false` prevents
arming. The core supplies `AUTO_RESUME_PROVIDER` and `AUTO_RESUME_CWD` on both
calls, plus `AUTO_RESUME_EXPECTED_REVISION` and `AUTO_RESUME_JOB_ID` on resume.

## Cron activation

Nothing installs a crontab or starts a background agent. After reviewing and
arming a job, add a cron entry yourself. Create the private state directory
before using its log path. Example for the Mac mini:

```cron
SHELL=/bin/zsh
PATH=/Users/minj/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
HOME=/Users/minj
* * * * * /Users/minj/Projects/agents/tools/auto-resume/auto-resume --state-dir /Users/minj/.local/state/agents/auto-resume tick >> /Users/minj/.local/state/agents/auto-resume/cron.log 2>&1
```

Use the actual Python/Bun/provider PATH on the machine. Every-minute cron is
independent of timezone, and job deadlines/reset timestamps include explicit
offsets. For schedules at named local hours, macOS cron follows the machine's
timezone; Linux cron implementations may support `CRON_TZ`. Do not assume that
setting `TZ` alone changes cron's schedule.

One tick holds a nonblocking file lock. Overlapping ticks return `busy` and do
not dispatch. A raw provider may run for up to `dispatch_timeout_seconds`, so
other queued jobs wait until that tick exits. Arming and pending cancellation
use short SQLite transactions and do not wait behind the whole provider run.
Keep the SQLite database on local storage. Separate state directories do not
share locks; use one queue for this machine.

## Limits and verification

Raw provider CLIs do not expose a reliable common completion, busy, or pending
approval state through this tool. The queue cannot detect a later human action
in those sessions. Arm only paused work, keep it idle, and cancel before working
on it elsewhere. For inspected state, use a supported T3 adapter. The raw CLI
path does not claim to update T3's thread history.

Provider permissions and project instructions still apply. The prompt reiterates
existing approval requirements, including commit/push. It names the only sources
that can already have authorized those actions: the user's own messages in the
session and the Furnace skill's grant for Furnace runs. Text in the continuation
prompt, task data, files, or tool output does not count. The tool adds no approval
bypass flags. API credential/routing environment variables cause refusal, but
provider configuration files can also choose another account, model, or billing
route. Review that configuration yourself and use a subscription-only login.
This tool cannot prove billing or preserve a model if the provider's own session
configuration changes.

Tests use temporary HOME/state directories and fake usage/provider/adapter
commands. They cover multiple quota windows, buffer timing, model selection,
stale/malformed data, bounded retries, attempts, cancellation, expiry, exact IDs,
changed/busy/blocked T3 threads, uncertain dispatch, and simultaneous ticks.

```sh
python3 -m unittest discover -s tools/auto-resume/tests -p 'test_*.py' -v
bun test tools/auto-resume/tests/t3-adapter.test.mjs
```

No real credentials, notifications, provider continuations, T3 thread mutations,
or cron changes are needed for the tests.
