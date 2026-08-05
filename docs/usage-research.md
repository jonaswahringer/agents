# AI coding assistant usage/quota trackers — landscape research

Compiled 2026-08-05. Star counts and "last push" dates were read directly from the GitHub REST API on that date, so they are point-in-time facts, not estimates.

---

## 1. Executive summary

- The ecosystem has split into two camps: **token/cost accounting from local log files** (ccusage and its many clones) and **real quota readout from provider endpoints** (CodexBar, caut, Claude-Code-Usage-Monitor's newer OAuth path). Only the second camp can tell you "37% of your weekly window is left, resets Thursday 09:00".
- **The authoritative sources now exist for both Claude and Codex.** Anthropic serves `GET https://api.anthropic.com/api/oauth/usage` (the data behind `/usage`); OpenAI serves `https://chatgpt.com/backend-api/wham/usage` plus `x-codex-*` response headers. Both are undocumented/private but widely used.
- **Cursor is the weak leg.** The best-known community extension, `Dwtexe/cursor-stats`, was **archived on 2026-03-08**. Official programmatic access is team-admin-only (Admin/Analytics API). There is no good, current, individual-seat quota tracker.
- **A Claude Code plugin cannot ship a main statusline.** Plugin `settings.json` supports only the `agent` and `subagentStatusLine` keys. A plugin can ship skills, hooks and background *monitors*, but the user must still wire `statusLine` into their own settings.

---

## 2. Claude Code

### 2.1 Community projects

| Project | Lang | Stars | Last push | Shows real quota + reset? | Install |
|---|---|---|---|---|---|
| [ccusage/ccusage](https://github.com/ccusage/ccusage) | Rust (was TS) | 17,725 | 2026-08-05 | Partly — 5-hour "blocks" inferred from logs, not server truth | `npx ccusage@latest`, bunx, pnpm, Nix |
| [Maciek-roboblog/Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) | Python | 8,589 | 2026-07-05 | Predictions + warnings; [issue #202](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/202) tracks moving to the OAuth usage API | pip/uv |
| [hamed-elfayome/Claude-Usage-Tracker](https://github.com/hamed-elfayome/Claude-Usage-Tracker) | Swift | 3,200 | 2026-07-12 | Yes — macOS menu bar, real-time limits | download / brew |
| [phuryn/claude-usage](https://github.com/phuryn/claude-usage) | Python | 2,123 | 2026-07-10 | Local dashboard; progress bar for Pro/Max | pip |
| [Iamshankhadeep/ccseva](https://github.com/Iamshankhadeep/ccseva) | TypeScript | 800 | 2026-08-03 | macOS menu bar over ccusage-style JSONL parsing | Electron app |
| [CodeZeno/Claude-Code-Usage-Monitor](https://github.com/CodeZeno/Claude-Code-Usage-Monitor) | Rust | 369 | 2026-07-17 | Windows taskbar variant | release binary |
| [vibe-log/vibe-log-cli](https://github.com/vibe-log/vibe-log-cli) | TypeScript | 338 | 2026-04-19 | Session analytics, not quota. **Looks stale.** | npx |
| [chiphuyen/sniffly](https://github.com/chiphuyen/sniffly) | Python | 1,254 | **2025-08-08** | No quota; error analysis + shareable dashboard. **Stale, ~1 year untouched.** | pip |
| [658jjh/claude-usage-tracker](https://github.com/658jjh/claude-usage-tracker) | JS | 55 | 2026-05-21 | Cross-tool cost aggregation (Claude Code, Cursor, Cline, Aider…) | npm |
| [codeinaire/claude-code-usage-tracker](https://github.com/codeinaire/claude-code-usage-tracker) | TS | 4 | 2026-03-29 | JSONL → SQLite → web dashboard. Toy scale. | local |
| [haasonsaas/claude-usage-tracker](https://github.com/haasonsaas/claude-usage-tracker) | TS | 3 | 2026-02-03 | Rate-limit warnings from JSONL. Toy scale, stale. | npm |

Note: `ryoppippi/ccusage` (the old canonical path, still linked from ccusage.com) 404s — the project moved to the `ccusage` org and was rewritten in Rust. Any doc pointing at `ryoppippi/ccusage` is out of date.

### 2.2 Data sources

1. **JSONL session transcripts** — `~/.claude/projects/<slug>/*.jsonl`. Every assistant turn carries `usage` with input/output/cache-read/cache-creation token counts and a model id. This is what ccusage and nearly all clones parse. Free, offline, no auth, no rate limit. It gives *tokens*, not *quota*.
2. **OAuth usage endpoint (authoritative)** — `GET https://api.anthropic.com/api/oauth/usage`, headers `Authorization: Bearer <token>`, `anthropic-beta: oauth-2025-04-20`, and critically `User-Agent: claude-code/<version>`. Returns `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet` (null when inactive) and optional `extra_usage`, each with a utilization percentage and an ISO-8601 UTC reset timestamp. This is exactly what `/usage` renders. Details in [Claude-Code-Usage-Monitor#202](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/202).
   - **Credentials:** macOS Keychain via `security find-generic-password -s "Claude Code-credentials" -w`; Linux/Windows `~/.claude/.credentials.json`; or `CLAUDE_CODE_OAUTH_TOKEN`. Access tokens expire roughly hourly and are refreshed by Claude Code itself.
   - **Rate limiting is the big trap.** Without the `claude-code/<version>` User-Agent you land in an aggressively throttled bucket and get persistent 429s with no `Retry-After` ([anthropics/claude-code#31021](https://github.com/anthropics/claude-code/issues/31021), [#31637](https://github.com/anthropics/claude-code/issues/31637)). With the right UA, ~180-second polling is reported safe. Limits are per access token, not per account.
3. **Statusline stdin JSON** — the `statusLine` command receives session JSON on stdin ([docs](https://code.claude.com/docs/en/statusline)). It carries context-window figures (`used`/`max`/`remaining`/`percentage_used`, the boolean `exceeds_200k_tokens`) and a `cost` object. It does **not** carry plan quota. Open requests to add it: [#5621](https://github.com/anthropics/claude-code/issues/5621), [#10436](https://github.com/anthropics/claude-code/issues/10436), [#11535](https://github.com/anthropics/claude-code/issues/11535).
4. **`/usage` slash command** — human-readable only; no machine-readable output. Treat it as a cross-check, not an API.

---

## 3. OpenAI Codex CLI

### 3.1 Community projects

| Project | Lang | Stars | Last push | Notes |
|---|---|---|---|---|
| [steipete/CodexBar](https://github.com/steipete/CodexBar) | Swift | 19,641 | 2026-08-05 | The de facto standard. macOS 15+ menu bar, Codex **and** Claude Code side by side, 5-hour + weekly windows, no browser login. `brew install --cask steipete/tap/codexbar`, Sparkle auto-update, local-only. |
| [tddworks/ClaudeBar](https://github.com/tddworks/ClaudeBar) | Swift | 1,391 | 2026-08-04 | Claude, Codex, Gemini, Antigravity quotas in one menu bar. |
| [aqua5230/usage](https://github.com/aqua5230/usage) | Python | 278 | 2026-08-04 | Claude Code + Codex quota/tokens/cost, explicitly local-only, zero API calls. |
| [MacSteini/Codex-Usage](https://github.com/MacSteini/Codex-Usage) | Python | 104 | 2026-07-09 | CLI: reset credits, rate-limit windows, local metadata, optional online usage/profile. |
| [Dicklesworthstone/coding_agent_usage_tracker](https://github.com/Dicklesworthstone/coding_agent_usage_tracker) ("caut") | Rust | 77 | 2026-06-24 | Closest existing thing to a unified tracker — 16+ providers (Codex, Claude, Gemini, Cursor, Copilot, z.ai, Kimi, JetBrains…). Shows "72% left … resets in 2h 15m" for session/weekly/tier windows. Human TUI or JSON/Markdown for agents. `cargo install --locked --git …`. Cross-platform port of CodexBar. |
| [lhl/pi-codex-status](https://github.com/lhl/pi-codex-status) | — | — | — | Documents the private endpoint clearly; also a pi extension. |
| [xiangz19/codex-ratelimit](https://github.com/xiangz19/codex-ratelimit) | Python | 8 | **2025-11-20** | Minimal JSONL scraper. **Stale.** |

### 3.2 Data sources

1. **Local rollout logs** — `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, containing `token_count` events per turn plus model names. Offline; ccusage and codex-ratelimit read these.
2. **Private usage endpoint (authoritative)** — `GET https://chatgpt.com/backend-api/wham/usage`, returning `used_percent`, `reset_at`, `limit_window_seconds`, `plan`, `credits` and additional named limits. Auth comes from existing Codex CLI OAuth credentials (`~/.codex/auth.json` and equivalents) — no separate login.
3. **Response headers** — `x-codex-primary-used-percent`, `x-codex-primary-window-minutes`, `x-codex-primary-reset-after-seconds`, plus `secondary` variants. Free to harvest if you proxy or observe traffic; pi's extension refreshes its cache from these opportunistically.
4. **`/status` inside Codex CLI** — human-readable cross-check.
5. There is an open request for a first-party `/codex:usage` command in the Codex Claude Code plugin ([openai/codex-plugin-cc#102](https://github.com/openai/codex-plugin-cc/issues/102)), which signals this is still an unmet need.

---

## 4. Cursor

### 4.1 Community projects — thin and decaying

| Project | Lang | Stars | Last push | Notes |
|---|---|---|---|---|
| [Dwtexe/cursor-stats](https://github.com/Dwtexe/cursor-stats) | TS | 264 | 2025-09-25 | The best-known one. **Archived 2026-03-08**; author quit Cursor over pricing churn. Status-bar fast-requests + usage-based pricing, VS Code Marketplace `ext install Dwtexe.cursor-stats`. Do not build on it. |
| [ofershap/cursor-usage-tracker](https://github.com/ofershap/cursor-usage-tracker) | TS | 32 | 2026-05-19 | Self-hosted team monitor with spend-anomaly alerts; Admin-API oriented. |
| [YossiSaadi/cursor-usage-vscode-extension](https://github.com/YossiSaadi/cursor-usage-vscode-extension) | TS | 16 | **2025-08-03** | Remaining fast-premium requests + reset-date tracking. **Stale.** |
| [lixwen/cursor-usage-monitor](https://github.com/lixwen/cursor-usage-monitor) | TS | 4 | 2026-03-26 | Status bar, billing-cycle tracking. |
| [Tendo33/cursor-usage-tracker](https://github.com/Tendo33/cursor-usage-tracker) | TS | 3 | 2026-05-24 | Remaining quota in status bar. |
| [alexerm/cursor-stats-extension](https://github.com/alexerm/cursor-stats-extension) | TS | 1 | 2026-01-24 | Browser extension over the dashboard; charts/calendars, monthly budget bar. |

### 4.2 Data sources

- **Official, team-admin only:** the [Admin API](https://cursor.com/docs/account/teams/admin-api) (`https://api.cursor.com/teams/daily-usage-data`, members, spend) and the [Analytics API](https://cursor.com/docs/account/teams/analytics-api). Requires an admin API key, so it is useless for an individual seat and it is what DX/Jellyfish integrations use. Community reports of `daily-usage-data` misbehaving exist on the [forum](https://forum.cursor.com/t/admin-api-daily-usage-data-endpoint-is-not-working-properly/138397).
- **Unofficial, individual seat:** the extensions above authenticate as the logged-in user by lifting the Cursor session token out of the editor's local state (the VS Code-style `state.vscdb` SQLite store under Application Support / globalStorage) and calling the same private dashboard endpoints the Spending tab uses. This is undocumented, breaks on Cursor releases, and is the direct cause of the churn visible in the table above.
- Cursor has changed pricing model repeatedly (fast requests → usage-based → budgets), which is why every tracker in this column rots.

**Implication for a unified tracker:** treat Cursor as best-effort. Ship Claude and Codex as first-class, put Cursor behind a clearly-labelled unofficial adapter with graceful degradation.

---

## 5. Is a Claude Code plugin / statusline a viable delivery mechanism?

**Partly. Statusline cannot be shipped by a plugin; everything else can.**

From the [plugins reference](https://code.claude.com/docs/en/plugins-reference):

- Plugin components are **skills, agents, hooks, MCP servers, LSP servers, and background monitors**.
- A plugin may include a root `settings.json`, but *"Only the `agent` and `subagentStatusLine` keys are currently supported."* The main `statusLine` key is not distributable. There is an open community ask for exactly this ([Daniel San, X](https://x.com/dani_avila7/status/2003237928915644661)).
- **Monitors** (`monitors/monitors.json`, or `experimental.monitors` in `plugin.json`) run a shell command for the session's lifetime and pipe every stdout line to Claude as a notification. This is a real fit for "you are at 85% of your weekly window" nudges. Caveats: interactive CLI sessions only, unsandboxed at hook trust level, skipped where the Monitor tool is unavailable, no `${user_config.*}` substitution in the command, and a disabled plugin's monitors keep running until the session ends. The schema is explicitly experimental and may change.
- Marketplaces are just a Git repo with `.claude-plugin/marketplace.json` listing plugin subdirectories, each with its own `plugin.json` — cheap to publish.

**Recommended shape:** ship a standalone CLI binary (the thing that actually polls and caches), plus a plugin that adds a `/usage-tracker` skill, an optional background monitor for threshold alerts, and **documented one-line instructions** for the user to paste a `statusLine` entry into their own `~/.claude/settings.json`. Precedent: [sirmalloc/ccstatusline](https://github.com/sirmalloc/ccstatusline) and `ccusage`'s statusline mode both work this way. Do not promise a zero-config statusline.

---

## 6. Accuracy caveats

### 6.1 Tokens are not quota

Parsing JSONL gives token counts and a *cost estimate* derived from public API list prices. On a Pro/Max subscription you are not billed per token, and Anthropic's limits are **not** enforced on the same accounting. A tool reporting "$47 of usage today" is telling you what those tokens would have cost on the API — an interesting number, but not your remaining headroom. Only the OAuth usage endpoint (or `/usage`) knows the real percentage.

### 6.2 Two overlapping Claude windows, plus per-model weeklies

- **5-hour rolling window**, starting at your first message, refreshing 5 hours later — not aligned to the clock, so "resets at the top of the hour" heuristics are wrong.
- **7-day window**, resetting 7 days from first message. Reported as `seven_day`, with separate `seven_day_opus` and `seven_day_sonnet` buckets that are null until that model is used. A tracker that surfaces only the aggregate will surprise Opus-heavy users, who typically exhaust the Opus weekly bucket long before the combined one.
- Anthropic **doubled the 5-hour limits on 2026-05-06** for Pro, Max, Team and seat-based Enterprise, and removed peak-hour reductions ([explainx timeline](https://explainx.ai/blog/claude-usage-limits-2026-timeline-explained), [morphllm](https://www.morphllm.com/claude-code-usage-limits)). Any tracker with hardcoded message-count tables from before that date is wrong. **Never hardcode limits — read percentages from the server.**
- Limits are expressed as plan multipliers and weekly model-hours (e.g. Max tiers up to ~480 Sonnet hours / ~40 Opus hours per week), not fixed message counts; published "225 / 900 messages" figures are approximations that vary with prompt length and task.
- The quota bucket is **shared across Claude Code, claude.ai and Cowork**. A local-JSONL-only tracker sees only Claude Code and will systematically under-report.

### 6.3 Cross-device drift

Local logs are per-machine. If you run Claude Code on a laptop and a Mac mini, neither machine's JSONL tells the whole story — this is the stated motivation behind Claude-Code-Usage-Monitor moving to the OAuth API. For a multi-machine setup the server endpoint is the only correct source.

### 6.4 Polling discipline

The Anthropic endpoint 429s hard and gives no `Retry-After`. Budget ≥180s between polls, send the `claude-code/<version>` User-Agent, cache aggressively, back off exponentially on 429, and fall back to local JSONL deltas between polls rather than hammering. The Codex `x-codex-*` headers are free by comparison — prefer them when you already have traffic to observe.

### 6.5 Undocumented endpoints

`api/oauth/usage`, `backend-api/wham/usage`, and Cursor's dashboard endpoints are all private. They can change or start rejecting non-first-party clients without notice. Version-gate parsers and degrade to log-derived estimates rather than crashing.

---

## 7. Gap analysis for a unified tracker

What already exists and is healthy: per-provider menu-bar apps (CodexBar, ClaudeBar), token accounting (ccusage), and one Rust multi-provider CLI (caut, 77 stars, last touched 2026-06-24).

What is genuinely missing:
1. A **cross-platform, headless, JSON-first** unified quota source that is not a macOS menu-bar app. caut is the nearest, but small and Rust-only-from-source.
2. **Cursor individual-seat coverage that is maintained** — the incumbent is archived.
3. **Claude Code-native surfacing** (statusline + threshold monitor) driven by the *server* percentages rather than log estimates. Today's statusline tools show context-window and cost, not plan quota.
