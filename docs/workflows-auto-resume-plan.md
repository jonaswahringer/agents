# Workflows and auto-resume

Build two small tools on the Mac mini. Keep job state and private settings outside
the repository. Use the existing `bin/usage` JSON output and preserve the
dependency-free installer.

## Updated direction: native T3 recovery

Checked on 2026-10-02: T3's new orchestrator includes native
[Resume at reset](https://github.com/pingdotgg/t3code/pull/12686), with persisted
server scheduling and checks against stale continuations. It reached main through
[the new orchestrator merge](https://github.com/pingdotgg/t3code/pull/2829) after
the installed `v0.0.45-nightly.20261002.2595` was published. That nightly does not
include the feature. Prefer native recovery for T3 threads once a build containing
it is installed and verified. Use per-thread Resume at reset for selective opt-in;
the environment default is Auto-resume limited threads in Settings → General.
The server must be running and the failed turn must have a known reset time.

Keep the recurring digest workflow. Keep the custom auto-resume queue as a fallback
for standalone provider CLI sessions. Leave the experimental T3 adapter disabled;
do not port it to the new orchestrator merely to duplicate native recovery.

## Workflows

`tools/workflows` runs a named workflow from system cron. The first workflow checks
T3 Code merges and published nightlies, compares them with the installed version
and previously reported changes, and writes a short personalized update digest.
Check GitHub with ordinary code; invoke the configured agent only for new material.
Distinguish merged changes from changes actually available in a release. Include
PR links and a recommendation to update now, later, or skip.

Save reports and run history, prevent overlapping runs, and permit a configured
delivery command. Provide a cron example with absolute paths, explicit PATH and
timezone guidance. Failed collection, summarization, or delivery must remain
visible and retryable. Do not modify the user's crontab during implementation.

## Auto-resume

`tools/auto-resume` stores explicitly armed continuation jobs. Each job identifies
the provider, exact session or T3 thread, working directory, expiry, retry budget,
and continuation prompt. A frequent system timer runs one tick; no agent process
stays alive just to wait.

Check `usage --json --only <provider>`, including all applicable quota windows.
Use reset time plus a configurable 0–60 second buffer, default 30 seconds. Fresh
available quota permits an attempt. Missing, stale, malformed, or failed quota
checks defer with bounded retries. No implicit model/provider switching or paid
API fallback. Expired, cancelled, completed, busy, or human-blocked work must not
receive an automatic continuation. Persist outcomes and prevent overlapping runs.

The original implementation supports T3-owned threads through a verified T3
adapter. The inspected `0.0.44-nightly.20260929.2456` build has
HTTP thread-read and dispatch routes but no atomic revision/busy guard. Make this
adapter explicitly experimental and disabled for dispatch by default. When enabled,
recheck thread state and revision immediately before sending and document the
remaining race. Require a configured credential; do not extract app-vault secrets.
Provider CLI sessions use explicit IDs, never `--last`. Preserve authorization
limits, including existing commit/push approval.

Each armed job permits one successful continuation. Success means the continuation
was accepted or the CLI returned successfully, not that the goal was completed.
Later quota interruptions need another armed job. Ambiguous dispatch failures go
to review instead of automatically sending a duplicate prompt.

## Implementation and verification

Use separate Git worktrees and GPT-6.1 Sol agents at medium/high/xhigh effort.
Keep implementation changes in each tool's directory; integrate only those new
files and this plan into the original checkout. No commits or pushes.

Exercise meaningful scenarios with temporary HOME/state directories, stub
provider/GitHub/agent commands, and no real notifications or thread mutations:
new versus unchanged releases, collection/delivery failures, concurrent ticks,
quota reset buffering, multiple exhausted windows, stale usage, retry exhaustion,
cancellation, expiry, and correct exact-session dispatch. Report limitations and
the commands needed to configure and activate both tools.
