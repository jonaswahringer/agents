# Private MacBook: local agent data inventory

Date: 2026-09-10

## Scope

This inventory records the local Cursor, Claude Code, Codex, and T3 Code data
available in the `/Users/jonasw` environment. It is a separate evidence set from
the Mac mini report.

It does not claim access to cloud-only histories, deleted conversations, another
machine's files, or every live database used by a running application.

## What was available

| Source | Local material found | What it supports | Coverage |
|---|---|---|---|
| Cursor | 490 JSONL files under `~/.cursor`; 417 matched the standard project agent-transcript layout | User prompts, assistant messages, tool calls, completed turns, aborted turns, and project-specific work | Better than metadata-only coverage, but the corpus includes partial and nested records |
| Cursor metadata and logs | ACP session metadata, worker logs, agent-tool records, and project metadata | Session titles, working directories, tool results, and runtime friction | Metadata or partial evidence, not a clean conversation count |
| Claude Code | 308 JSONL files under `~/.claude/projects`; 14 direct project session files and nested subagent/workflow records | User prompts, assistant behavior, tool calls, skill use, authentication failures, and partial sessions | Good local transcript coverage, but nested subagents and injected instructions are mixed with user conversations |
| Claude memory | Six project `MEMORY.md` files | Durable project facts and workflow context | Small, curated, project-specific evidence |
| Claude global guidance | `~/.claude/CLAUDE.md` and installed response skills | Current response rules, commit policy, and writing preferences | Direct configuration and skill evidence |
| Codex | 134 rollout JSONL files under `~/.codex/sessions`, plus `history.jsonl` | User prompts, agent instructions, tool calls, guardian reviews, and runtime events | Good session coverage, but rollout files are event streams rather than uniform conversations |
| Codex global guidance | `~/.codex/AGENTS.md` and the Codex skill tree | Current response rules, skill loading, and runtime behavior | Direct configuration evidence |
| Shared repository | `/Users/jonasw/localdocs/agents/AGENTS.md`, existing skills, and the pulled analysis documents | Installer constraints, skill layout, safety rules, and artifact conventions | Direct repository evidence |
| T3 Code | Two NDJSON trace files and 89 provider event-log files under `~/.t3/userdata/logs` | Provider events, thread generation, tool state, runtime failures, and server traces | Partial operational evidence, not a clean exported chat archive |
| Current conversation | Harness-supplied transcript for this task | Current intent and corrections | Current-task evidence, not a historical sample |

## Complete and partial data

### Cursor transcripts

The project agent-transcript files are the strongest Cursor evidence in this
environment. Some sampled files end with an explicit successful turn. Others are
aborted, oversized, or contain nested tool records. Counts therefore describe
files, not unique user conversations.

### Claude sessions

The direct project files contain complete-looking conversations and partial
sessions. One sampled session ended with an authentication failure before the
requested work started. Nested subagent and workflow files were retained as
supporting evidence, not counted as independent user conversations.

### Codex rollouts

Codex records contain system and developer instructions, user messages, tool
calls, guardian reviews, and runtime metadata. Guardian sessions and retry
records are useful for safety and workflow analysis, but they are not user
conversations.

### T3 logs

T3 has useful operational traces, but no dedicated JSONL conversation archive,
session history, or chat database was found in the inspected paths. T3 findings
are therefore limited to logs and settings.

## Not available as a clean dataset

The following could not be concluded from this machine:

- the complete history of every Cursor or T3 conversation,
- cloud-only or deleted vendor history,
- private web-app threads that were not written to local files,
- a statistically reliable failure rate for any agent,
- the authorization context for every historical commit, push, or Docker command,
- whether every event record represents a distinct human request.

## Method

The review used:

1. File inventory searches for transcripts, memories, logs, configs, and skills.
2. Direct reads of response-related skills and global instruction files.
3. Representative reads from Cursor, Claude, and Codex records.
4. Targeted searches for response preferences, mutation requests, verification
   language, repeated corrections, authentication failures, and skill errors.
5. Targeted inspection of T3 server and provider logs.

This was a qualitative synthesis. The records contain injected instructions,
tool results, duplicated provider events, and agent-generated prose.

## Privacy and mutation boundary

The intended scan excluded authentication files, token files, secret attachments,
MCP credential files, and caches. One credential-bearing Cursor `mcp-auth.json`
was opened accidentally during inventory. Its values were not used, copied, or
included in this report. If the credentials are live, they should be rotated.

No configs, rules, or skills were modified. The repository's pre-existing
untracked `skills/teaj/` and `skills/write-well/` directories remain untouched.
