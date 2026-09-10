# Mac mini: local agent data inventory

Date: 2026-09-10

## Scope

This inventory records what was available to inspect on the Mac mini during the
local analysis. It does not claim access to cloud-only histories, deleted
conversations, another machine's files, or every live database used by a running
application.

The private MacBook was not inspected. Its evidence must be reported separately.

## What was available

| Source | Local material found on the Mac mini | What it supports | Coverage |
|---|---|---|---|
| Claude Code | 139 JSONL files under `~/.claude/projects`, including main conversations, subagents, and workflow journals | User prompts, assistant behavior, tool calls, authentication failures, skill use, and project-specific memories | Good local transcript coverage, but the files include subagents and tool-result records, so they are not a clean count of user conversations |
| Claude memory | 13 Markdown memory files under `~/.claude/projects/*/memory` | Durable preferences, technology comfort, teaching needs, branch naming, and known environment quirks | Small but high-signal curated memory set |
| Claude global config | `~/.claude/CLAUDE.md`, `~/.claude/settings.json`, 33 user skill files | Current global response rules, permissions, installed skills, and model/provider settings | Direct configuration evidence |
| Codex | 106 JSONL rollout files under `~/.codex/sessions` | User prompts, agent instructions, tool use, skills, runtime checks, browser checks, and approval decisions | Good local session coverage from 2026-07-29 through 2026-09-10, with some very large records |
| Codex global config | `~/.codex/AGENTS.md`, `~/.codex/config.toml`, 37 skill files including system skills | Current response rules, model defaults, permissions, plugins, and skills | Direct configuration evidence |
| Shared agent repository | `/Users/minj/Projects/agents/AGENTS.md`, `README.md`, and selected skills | Canonical installer behavior, global guidance, `nice-to-read`, `work-smart-not-hard`, commit policy, and pstack's `unslop` | Direct source-of-truth evidence for future changes |
| Cursor | 3,407 ACP session directories with `meta.json` under `~/.cursor/acp-sessions` | Session titles and working directories for many Cursor sessions | Metadata only in the files inspected. No complete message-body archive was found there |
| Cursor config | `~/.cursor/cli-config.json` and 19 Cursor skill files under `~/.cursor/skills-cursor` | Display preferences, approval mode, sandbox settings, model selection, and Cursor-specific skills | Direct configuration evidence |
| T3 Code | 12 provider event logs, 11 server trace logs, client settings, provider caches, and runtime metadata under `~/.t3` | Provider events, thread/turn IDs, tool events, rate limits, browser activity, and server database queries | Partial operational evidence, not a clean exported chat archive |
| Current conversation | The current thread transcript supplied by the harness | Current intent, corrections, and the request for a local analysis | Used for task intent, not treated as a historical sample |

## What was not available as a clean dataset

### Cursor message bodies

The scanned Cursor ACP session folders contained `meta.json` records such as
session title and working directory. The expected project transcript directory
was not present in the current local tree. Cursor was therefore not treated as a
source of full conversational evidence.

### Complete T3 threads

The T3 logs contain useful provider events and show that the server queries a
SQLite database for projects, threads, sessions, turns, and projection state.
The SQLite file itself was not exposed by the scanned `~/.t3` file inventory, and
no private runtime API was queried. T3 findings are therefore limited to
observable logs and settings.

### Private MacBook evidence

The private MacBook is a separate machine where the parallel analysis prompt was
run. Its local transcripts, configs, and resulting report were not available on
the Mac mini at the time of this inventory. Do not merge or attribute MacBook
findings to this document until that report is copied into this folder.

### External or deleted history

Nothing in these files proves access to:

- conversations that exist only in a vendor cloud,
- histories deleted or archived outside the scanned paths,
- chats on another Mac or device,
- private web-app threads that were not synced locally,
- the contents of encrypted T3 connection catalogs,
- provider account data not written into these local logs.

## Method

The analysis used:

1. File inventory searches for transcript, memory, rule, config, and skill files.
2. Direct reading of global instruction files and response-related skills.
3. Representative reads from Claude and Codex transcript files, including user
   prompts, assistant messages, tool failures, skill invocations, and verification
   activity.
4. Targeted local searches for recurring terms such as `short`, `concise`,
   `simple`, `plain`, `bullet`, `table`, `commit`, `assumption`, `permission`,
   `login`, and `failed`.
5. Inspection of T3 provider and server logs for thread and tool-state evidence.

This was a qualitative synthesis. The transcript formats contain large JSON
records, tool results, injected instructions, and duplicated provider events.
The counts in this document are file inventory counts, not counts of unique user
messages or statistically normalized preference measurements.

## Confidence rules

- **High** means the same preference appears in global instructions, a skill or
  memory, and at least one conversation pattern.
- **Medium-high** means it appears across several independent artifacts but may be
  partly workflow-specific.
- **Medium** means the evidence is useful but incomplete, noisy, or mostly
  operational.

A local occurrence is not automatically a user preference. Some text comes from
system instructions, skill content, tool output, or an agent's own wording. The
findings document labels these distinctions in prose.

## Privacy and mutation boundary

The analysis read local files only and did not modify any existing config, rule,
or skill. The analysis documents were moved into this repository. No commit, push,
Docker Compose action, or external message was performed.
