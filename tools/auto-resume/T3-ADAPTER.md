# Experimental T3 continuation

Prefer the new orchestrator's native
[Resume at reset](https://github.com/pingdotgg/t3code/pull/12686) for T3 threads
once it is available in your installed build. This adapter targets the earlier
orchestrator and remains disabled by default. The newer installed
`v0.0.45-nightly.20261002.2595` is outside its version pin. No migration to the
new orchestrator is planned while native recovery covers this use case.

The bundled adapter can inspect T3 threads and, after explicit opt-in, send a
continuation through T3's own server. It is pinned to
`0.0.44-nightly.20260929.2456`. Bun supplies HTTP and WebSocket support; no packages
are installed. It runs on the machine hosting the configured T3 environment.

Automatic continuation is disabled by default. The pinned T3 API has no
atomic revision or idle-state condition on a turn-start command. Another client
can change the thread after the adapter's final inspection and before dispatch.
The adapter cannot prevent that race. Enable the experimental option only if
that limit is acceptable for the armed work.

## Configure credentials on minj

Keep the adapter config, bearer token, and queue state outside this repository.
The running server inspected during development used `http://127.0.0.1:3774` and
the data directory `~/.t3`. Confirm those values for the environment you target.
The files `~/.t3/userdata/server-runtime.json` and
`~/.t3/userdata/environment-id` identify the local endpoint and environment.
The environment ID is not a credential.

Use a bearer token already issued for that environment if you have its original
secret. `t3 auth session list --json` lists sessions without revealing tokens.
The installed desktop connection catalog uses Electron safeStorage encryption;
the adapter does not decrypt it, read browser cookies, or use the server signing
key. A signing key is not a client bearer credential.

If you need a new credential, the installed supported command is
`t3 auth session issue`. These setup commands create private files and issue a
new credential. They were checked against CLI help but were not run during
implementation:

```sh
umask 077
mkdir -p "$HOME/.local/state/agents/auto-resume"
t3 auth session issue --base-dir "$HOME/.t3" --ttl 7d \
  --label auto-resume --token-only \
  > "$HOME/.local/state/agents/auto-resume/t3-token"
chmod 600 "$HOME/.local/state/agents/auto-resume/t3-token"
```

This CLI issues administrative scopes and has no scope-selection flag in the
verified build. A read-only credential is sufficient for inspection but cannot
arm a continuation. Dispatch needs `orchestration:operate` as well as
`orchestration:read`. Choose a short lifetime and retain the session ID from
`t3 auth session list --json` if you need to revoke it:

```sh
t3 auth session revoke --base-dir "$HOME/.t3" SESSION_ID
```

Do not put the token in argv, config JSON, logs, or source control. The adapter
requires a regular token file owned by its user with no group or other access,
and rejects symbolic links. An expired or revoked token prevents dispatch.

Create a private `t3-adapter.json` with absolute paths and exact instance IDs:

```json
{
  "endpoint": "http://127.0.0.1:3774",
  "token_file": "/Users/minj/.local/state/agents/auto-resume/t3-token",
  "environment_id": "COPY_THE_EXACT_ENVIRONMENT_ID",
  "protocol_version": "0.0.44-nightly.20260929.2456",
  "provider_instances": { "codex": "codex", "claude": "claudeAgent" },
  "usage_account_matches_t3": false,
  "experimental_non_atomic_resume": false
}
```

Instance names may differ in a customized T3 setup. Confirm that the mapped
instance uses the same subscription login and provider home as `bin/usage`.
T3 and `usage` do not expose a common account identity that this adapter can
compare. Set `usage_account_matches_t3` to `true` only after that check. Set
`experimental_non_atomic_resume` to `true` only to accept the dispatch race.
Both declarations are required for arming. Neither declaration changes the
provider's model, credentials, or authorization settings.

The queue's private config uses this adapter argv prefix:

```json
{
  "t3_adapter": [
    "/opt/homebrew/bin/bun",
    "/Users/minj/Projects/agents/tools/auto-resume/t3-adapter.mjs",
    "--config",
    "/Users/minj/.local/state/agents/auto-resume/t3-adapter.json"
  ]
}
```

Use paths from the checkout containing the integrated files. To verify the
connection without sending a message:

```sh
/opt/homebrew/bin/bun \
  /Users/minj/Projects/agents/tools/auto-resume/t3-adapter.mjs \
  --config /Users/minj/.local/state/agents/auto-resume/t3-adapter.json \
  inspect EXACT_THREAD_ID
```

Inspection returns JSON with a thread status, revision, environment, workspace,
provider instance, model selection, and permission modes. It omits conversation
content and credentials. `resume_supported: false` prevents the queue from
arming. The queue activation and cancellation commands are in [README.md](README.md).
No server, credential, cron entry, or continuation was created during implementation.

## Verified protocol and checks

The installed `t3 --help` exposes no thread subcommand. The installed native
server binary and matching client assets contain these protocol definitions:

- `GET /api/auth/session` authenticates the configured bearer and lists scopes.
- `/ws` accepts the bearer in its HTTP `Authorization` header. An Effect JSON
  RPC request for `server.getConfig` returns the running environment ID, server
  version, and configured provider registry. The adapter uses the `_tag:
  "Request"` and `_tag: "Exit"` framing found in that build, not JSON-RPC framing.
- `GET /api/orchestration/threads/:threadId` returns the exact thread snapshot.
- `GET /api/orchestration/shell` returns project workspace roots and authoritative
  pending approval, question, proposed-plan, and background-work flags.
- `POST /api/orchestration/dispatch` accepts the client orchestration command.
  A `thread.turn.start` command contains exact `threadId`, `commandId`, user
  message ID and text, model selection, runtime mode, interaction mode, and
  creation time. Its acknowledgement contains a nonnegative `sequence`.

The local source checkout was older than the installed nightly. Verification
used the installed binary's embedded contract, auth, HTTP handler, decider, and
command-receipt source, plus the installed client assets. Its version constant
is `0.0.44-nightly.20260929.2456`. The running server must report that exact version
and the configured environment ID. Updating T3 requires another protocol review
and an adapter update; editing the config version alone does not enable it.

Before dispatch, the adapter checks an idle thread, exact provider driver and
instance, session ownership, working directory, armed revision, and operation
scope. It rejects completed, settled, archived, deleted, interrupted, stopped,
snoozed, running, queued, or human-blocked work. Unknown required safety fields
fail closed. It reads the thread and shell again immediately before sending and
requires the same revision. The revision covers thread content, model options,
permissions, workspace, blocking flags, and provider home. Activity elsewhere in
the environment does not change that revision.

The queue supplies `AUTO_RESUME_PROVIDER` and `AUTO_RESUME_CWD` for inspection,
plus `AUTO_RESUME_EXPECTED_REVISION` and `AUTO_RESUME_JOB_ID` for continuation.
The adapter refuses continuation without all four values. Command and message
IDs derive from the exact environment, thread, job, armed revision, and prompt.
The installed engine stores command receipts by command ID and returns a prior
accepted receipt instead of replaying the same command. An existing matching
message also permits a duplicate acknowledgement without another POST.

A lost, malformed, or failed dispatch acknowledgement is uncertain. The adapter
returns `accepted: false`, `not_sent: false`, and `retryable: false` so the queue
requires review. It does not replay a POST on a transport error. `accepted: true`
means T3 acknowledged the command, not that the provider completed the task.

The installed turn-start decider has no busy or expected-revision invariant and
clears settlement state when it accepts a turn. The preflight checks therefore
cannot guarantee safety against concurrent human or client changes. Tests cover
changes visible before the POST; they do not turn this protocol into an atomic
operation.

## Verification performed

```sh
bun test tools/auto-resume/tests/t3-adapter.test.mjs
```

The fixture uses a real local Bun HTTP and WebSocket server, temporary private
credentials, and exact protocol request shapes. Tests check bearer headers,
version and environment pinning, scope limits, provider and workspace ownership,
permission and model preservation, final inspection changes, blocked states,
duplicate messages, sanitized errors, and uncertain dispatch acknowledgements.

Read-only requests to the live Mac mini server confirmed the public auth-session
endpoint and a `401 missing_credential` response for an unauthenticated thread
snapshot. Existing credentials were encrypted, so authenticated live inspection
was not attempted. Authenticated live dispatch was deliberately not tested, and
no real T3 thread was changed. Fixture success verifies transport and guard
behavior against the extracted protocol, not an end-to-end live provider run.
