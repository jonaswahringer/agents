# usage

One command that answers "how much quota do I have left, and when does it reset?"
across Claude Code, Codex and Cursor.

```
usage                     # human-readable
usage live                # same view, refreshes every 90s; press r to reload now
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
| Cursor | `cursor.com/api/usage-summary` and `api/auth/stripe` | login keychain (`cursor-access-token`, written by `cursor-agent`), falling back to the editor's `state.vscdb` |

All three are queried at once, in threads. On a terminal the layout is drawn
immediately with a spinner per provider, and each block is replaced the moment that
vendor answers, so the slowest one no longer holds up the other two. Piped output and
`--json` skip the animation and print once everything has landed.

`usage live` keeps that same view on screen. It polls again every 90 seconds, or
sooner if you press `r`. Under the providers a rule, `Last refresh at HH:MM (D.M.YYYY)`,
and `Reload [r]` sit as a footer. Needs an interactive terminal; `--json` is refused.

Claude's plan tag (e.g. `max5`) comes from the login blob's `rateLimitTier`, so it
still shows when the usage endpoint is rate-limited.

## Things that will bite you

- **All three endpoints are undocumented.** They can change without notice. Treat a
  provider going `unavailable` as expected maintenance, not a crash.
- **The Anthropic endpoint checks the User-Agent.** Without a `claude-code/<version>`
  UA it returns 429 forever. A countdown is shown only when the response carries a
  positive `Retry-After` (seconds). `retry-after: 0` or a missing header becomes
  plain `rate limited` (no number) and we skip Claude for one live interval so
  mashing `r` does not dig further — we do not invent or double a wait.
- **Keychain over file.** On macOS, `~/.claude/.credentials.json` is often a stale
  copy; the tool reads both and uses whichever token expires later.
- **Tokens are not refreshed here.** If Claude's token has expired, run `claude` once
  and it will refresh in place.
- **The 5-hour window rolls from your first message**, not from a clock boundary.
- **Per-model weekly buckets exhaust before the aggregate.** You can sit at 27% of your
  overall weekly quota and still be locked out of one model.
- **A Cursor plan is two pools, not one.** `individualUsage.plan` on
  `api/usage-summary` carries `autoPercentUsed` (Cursor's own models — Grok, Composer)
  and `apiPercentUsed` (everything else, the "at least $20 of API usage" the plan page
  advertises). These two percentages are what the dashboard's bars show, so they are
  what this tool reports. A user can be at 1% of one pool and 100% of the other.
- **Do not subtract `used` from `limit` on `usage-summary`.** They belong to different
  pools: `limit: 2000` is the $20 API allowance in cents, while `used: 432` is spend
  charged mostly against the far larger Cursor-models pool (~$300 on Pro, if you back
  it out of `autoPercentUsed`). `remaining` is that same bad subtraction, served
  pre-computed. Reading the pair as one quota reported a barely-touched plan as
  three-quarters spent.
- **`get-hard-limit` is not the Cursor plan limit either.** It returns the on-demand
  spending cap — what you allow *after* both pools run out, often a token amount like
  $1. It is `individualUsage.onDemand` on the same response, in cents, and is the one
  Cursor figure genuinely denominated in dollars. Shown only once something has been
  charged to it.
- **The `cursor-agent` CLI is enough for Cursor.** The desktop editor does not need to be
  installed; the CLI writes a usable token to the keychain.

## Verified on 2026-08-06

All three providers confirmed live against real accounts on the Mac mini.
