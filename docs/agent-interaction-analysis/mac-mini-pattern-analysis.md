# Mac mini: local agent interaction analysis

Date: 2026-09-10

## Short answer

The clearest recurring preference found on the Mac mini is one-pass clarity. The
user wants the answer up front, in plain words, with only the structure and detail
that help them decide or act.

The user also wants agents to be careful. They should plan larger work, preserve
the user's decisions, verify real behavior, report failed checks, respect the
Mac mini/private MacBook boundary, and ask before important mutations such as
commits.

This is evidence from the Mac mini only. It is not a merged analysis of the
private MacBook.

## Summary table

| Pattern | Evidence seen on the Mac mini | Confidence | Useful automation | Best home |
|---|---|---:|---|---|
| Answer in one pass | `~/.agents/AGENTS.md`, `~/.claude/CLAUDE.md`, the `nice-to-read` skill, Codex base instructions, and the shared `agents` repository all say to lead with the outcome and make the message understandable without rereading or scrolling back. | High | Put the result in the first sentence. Remove detail that does not change what the user does next. | Global instructions plus a `nice` skill |
| Keep responses short, but scale depth to the task | The global rules call for plain, compact communication. The user's tasks still ask for deep research, architecture documents, plans, and full verification when those change the outcome. | High | Use a short default. Expand for risk, ambiguity, requested detail, or evidence that the task needs it. | `nice` skill |
| Explain simply when needed | A Claude memory says Unix and OS terms must be explained plainly. The current request corrected the goal to “explain it to me like I am five.” The research skill asks for simple terms before fine detail. | High | Define a technical term at first use. Use a small example for unfamiliar ideas. | `nice` skill plus teaching memories |
| Use lists and tables when they earn their space | The `nice-to-read` skill says prose by default, lists for parallel items, and tables for short facts with shared fields. The user explicitly asked for a summary table here. | High | Choose the smallest useful format. Do not turn every answer into sections or a table. | `nice` skill |
| Make every message stand alone | The shared `nice-to-read` design says not to require labels, codenames, or scrollback. The user's handoff prompts restate context, requirements, invariants, and open decisions. | High | Repeat the minimum context needed to make the answer unambiguous. | Global instructions plus `nice` |
| State what was checked and what was not | The global rules require failed and skipped checks to be stated. The user's requests often ask for tests, runtime checks, browser checks, or regression checks rather than a claim based on inspection alone. | High | End with actual checks, skipped checks, and open risks. Never imply verification that did not happen. | Global instructions plus project verification skills |
| Plan before large changes and keep the user informed | Global instructions say to plan non-trivial work and provide progress updates. Historical sessions show plans before repository-wide changes, installer changes, and research documents. | High | Use a short plan for multi-file work. Send only meaningful progress updates. | Global instructions |
| Verify the real behavior | Codex and T3 logs show browser and app verification attempts. One T3 run found a stale UI assumption, failed, then repaired its navigation helper before continuing. | High | Test the affected path end to end when the change has a runtime surface. Separate tests from observed behavior. | Project `verify` or `run` skills |
| Do not invent business rules | P2P handoffs repeatedly say stakeholder requirements are authoritative, unresolved decisions must stay visible, and agents must not add an unconfirmed price rule. | High | Keep an explicit assumptions and open-decisions section. Ask only about decisions that cannot be discovered locally. | Project rules or domain docs |
| Respect the Mac mini/private MacBook boundary | `~/.agents/AGENTS.md`, `~/.claude/CLAUDE.md`, Codex history, and the shared `agents` README describe work happening on the always-on Mac mini while the answer is read elsewhere. The private MacBook is a separate evidence source and was not inspected here. | High | Report where a change happened, whether it is reachable, and whether it must be pulled or pushed. Do not point the user at an inaccessible localhost service. | Global `AGENTS.md` |
| Gate important mutations | The commit skill requires a visible headline and confirmation before committing, and the current user rules prohibit automatic commits and unrequested Docker Compose changes. | High | Default to read-only inspection. Ask immediately before commit, push, destructive cleanup, or cluster changes. | Global rules plus `commit` skill |
| Right-size agents and subagents | The user has a dedicated `work-smart-not-hard` skill and has explicitly asked agents to use it. The user also asks for dedicated review and verification agents for larger checks. | High | Route routine work to cheaper agents, reserve stronger models for synthesis or correctness gates, and escalate on evidence. | `work-smart-not-hard` skill |
| Reduce AI tells without becoming stiff | The pstack `unslop` skill is installed in Claude and Codex. It targets filler, hype, cliches, vague attributions, jargon, sycophancy, and dense sentences. The newer `nice-to-read` skill adds a more personal one-pass reading contract. | High | Fork the useful anti-slop rules into `nice`. Drop rules that conflict with the user's preference for short, direct answers. | New `nice` skill |
| Keep harness configuration coherent | The shared `agents` repository installs one global instruction file and links skills into multiple harnesses. Claude and Codex currently have matching `unslop` and `nice-to-read` copies, while Cursor has separate CLI configuration and skill settings. | High | Use one source of truth with small harness adapters. Avoid editing generated or linked files by hand. | Shared `agents` repository |
| Keep tool friction visible | Local sessions include expired logins, provider fallbacks, rate-limit records, failed browser selectors, and unavailable or hidden previews. | Medium-high | Report the exact blocker, retry once when safe, and say what remains unverified. Do not silently change the task. | Harness config and global response rules |
| Keep the skill set navigable | Claude exposes about 33 user skills and Codex about 31 user skills, with additional system skills. The user already has routers such as `ask-matt` and `find-skills`, plus setup and doctor skills. | Medium-high | Keep always-loaded guidance small. Move specialist guidance into lazy skills and use a router for ambiguous requests. | Shared skill repository |

## What seems to frustrate the workflow

### Responses can be too large or too indirect

The repeated creation and refinement of `nice-to-read`, plus the global “read it
once” rule, is strong evidence that response shape matters. The target is not
“always tiny.” It is “as short as the job allows, and as detailed as the decision
requires.”

The practical rule should be:

- Give the result first.
- Use plain words.
- Use a list or table only when it makes comparison easier.
- Add detail when the task is risky, ambiguous, or explicitly asks for depth.
- Stop when the user can act.

### Agents can make up missing product decisions

The P2P documentation sessions contain an unusually clear correction pattern. The
agent was told to preserve stakeholder requirements, avoid inventing price
compatibility, and flag unresolved settlement rules instead of silently choosing
one.

This is a general configuration opportunity. Agents should label assumptions,
distinguish facts from recommendations, and leave a business decision open when
the user has not made it.

### “Tests passed” is not the same as “the feature works”

The user's requests often ask for a live browser pass or an end-to-end check. The
T3 provider log shows why. A browser helper used an outdated accessibility
assumption, failed to find the expected button, and had to inspect the current UI
before repairing navigation.

The response contract should separate:

- static inspection,
- automated tests,
- runtime or browser observation,
- checks that could not run.

### Authentication and provider state interrupt work

The local Claude transcripts include expired-login sessions and a provider fallback
after a model refusal. Codex and T3 logs also record rate-limit and preview state
changes. These are environment issues, not evidence that the user changed the
task.

Agents should say which provider or tool is blocked, what was retried, and which
result is still missing. They should not hide a fallback or present partial work
as complete.

### Configuration is split across several harnesses

There is a shared source under `/Users/minj/Projects/agents`, linked global
guidance under `~/.agents`, `~/.claude`, and `~/.codex`, Cursor-specific
configuration under `~/.cursor`, and T3-specific state under `~/.t3`. The same
writing rules appear in more than one place.

That is manageable today, but it creates drift risk. A future cleanup should
define:

1. one canonical user-facing response contract,
2. small harness-specific adapters,
3. skills that provide detail only when triggered,
4. a test that checks the generated copies remain equivalent.

## Proposed direction after the MacBook analysis is combined

Do not change configs from this document alone. Combine this Mac mini report with
the private MacBook report first.

The likely shape is:

1. Keep `AGENTS.md` short. Put stable behavior there: outcome first, plain words,
   machine boundary, mutation gates, honest verification, and progress updates.
2. Create a personalized `nice` skill as a fork of the useful parts of pstack's
   `unslop`.
3. Make `nice` the response-format skill. Keep anti-hype, anti-sycophancy,
   anti-filler, and plain-language checks. Remove or soften rules that encourage
   artificial personality, excessive rhythm variation, or extra detail.
4. Decide whether `nice-to-read` should become an alias, be merged into `nice`, or
   remain a separate document-writing skill. Two overlapping always-available
   skills will drift.
5. Keep `unslop` available for editing prose where its full vocabulary blacklist is
   useful, but do not require both skills to run independently on every response.
6. Add a compact response template for completed work: result, changed files or
   observed behavior, checks, and remaining risks.
7. Add a compact response template for explanations: direct answer, simple model,
   example, then optional detail.
8. Keep project-specific verification, domain rules, and machine details out of
   the generic `nice` skill.

## Evidence files inspected on the Mac mini

- `/Users/minj/.agents/AGENTS.md`
- `/Users/minj/.claude/CLAUDE.md`
- `/Users/minj/.claude/settings.json`
- `/Users/minj/.claude/skills/unslop/SKILL.md`
- `/Users/minj/.claude/skills/nice-to-read/SKILL.md`
- `/Users/minj/.codex/AGENTS.md`
- `/Users/minj/.codex/config.toml`
- `/Users/minj/.codex/skills/unslop/SKILL.md`
- `/Users/minj/.codex/skills/nice-to-read/SKILL.md`
- `/Users/minj/Projects/agents/AGENTS.md`
- `/Users/minj/Projects/agents/README.md`
- `/Users/minj/Projects/agents/skills/jonasw/nice-to-read/SKILL.md`
- `/Users/minj/Projects/agents/skills/jonasw/work-smart-not-hard/SKILL.md`
- `/Users/minj/Projects/agents/skills/jonasw/commit/SKILL.md`
- `/Users/minj/Projects/agents/skills/pstack/unslop/SKILL.md`
- selected Claude and Codex transcript files under `~/.claude/projects` and
  `~/.codex/sessions`
- Claude memory files under `~/.claude/projects/*/memory`
- T3 provider and server logs under `~/.t3/userdata/logs`
