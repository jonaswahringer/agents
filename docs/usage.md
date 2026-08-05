# aiusage

One command that answers "how much quota do I have left, and when does it reset?"
across Claude Code, Codex and Cursor.

```
usage                     # human-readable
usage --json              # machine-readable, for a statusline or monitor
usage --only claude codex
```

Installed by `agents` as `~/.local/bin/usage`. If another command on the machine
already provides that name, it installs as `aiusage` instead and says so. Pass
`--force` to take the name anyway, or set `AGENTS_USAGE_NAME` to pick your own.

Python 3 standard library only. No install step, no dependencies.

## How it gets the numbers

It asks each vendor, rather than estimating from local session logs. That matters:
log-based tools like `ccusage` only see the machine they run on and can only guess
at cost, while your subscription quota is shared across machines and surfaces.

| Provider | Source | Credentials |
| --- | --- | --- |
| Claude Code | `api.anthropic.com/api/oauth/usage` | login keychain, falling back to `~/.claude/.credentials.json` |
| Codex | `chatgpt.com/backend-api/wham/usage` | `~/.codex/auth.json` |
| Cursor | `cursor.com/api/dashboard/*` | login keychain (`cursor-access-token`, written by `cursor-agent`), falling back to the editor's `state.vscdb` |

## Things that will bite you

- **All three endpoints are undocumented.** They can change without notice. Treat a
  provider going `unavailable` as expected maintenance, not a crash.
- **The Anthropic endpoint checks the User-Agent.** Without a `claude-code/<version>`
  UA it returns 429 forever, with no `Retry-After` to back off against.
- **Keychain over file.** On macOS, `~/.claude/.credentials.json` is often a stale
  copy; the tool reads both and uses whichever token expires later.
- **Tokens are not refreshed here.** If Claude's token has expired, run `claude` once
  and it will refresh in place.
- **The 5-hour window rolls from your first message**, not from a clock boundary.
- **Per-model weekly buckets exhaust before the aggregate.** You can sit at 27% of your
  overall weekly quota and still be locked out of one model.
- **Cursor is measured in dollars, not percent.** It reports usage-based spend against a
  hard limit, so it is shown in dollars and is not comparable to Claude's or Codex's
  message quotas. The percentage in `--json` is derived, not authoritative.
- **`get-aggregated-usage-events` does not answer "how much have I spent".** It reports
  plan-*included* cost, which is never billed against the hard limit. The spend figure
  has to be summed from `get-filtered-usage-events`, counting only
  `USAGE_EVENT_KIND_USAGE_BASED` and only since the cycle start. Mixing the two
  overstates spend badly — included cost runs into the hundreds of dollars.
- **Cursor's dashboard endpoints reject POSTs without an `Origin: https://cursor.com`
  header**, answering 403 "Invalid origin for state-changing request".
- **Cursor's monthly-invoice endpoint reports the *next* billing period**, not the
  current one. The cycle anchor comes from `startOfMonth` on the legacy usage endpoint.
- **The `cursor-agent` CLI is enough for Cursor.** The desktop editor does not need to be
  installed; the CLI writes a usable token to the keychain.

## Verified on 2026-08-05

All three providers confirmed live against real accounts on the Mac mini.
