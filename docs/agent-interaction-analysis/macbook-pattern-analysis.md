# Private MacBook: local agent interaction analysis

Date: 2026-09-10

## Short answer

The MacBook evidence supports the same broad response contract as the Mac mini
evidence: answer first, use plain words, scale detail to the task, verify the
real behavior, and report failed or skipped checks.

The evidence also supports a personalized `nice` skill. It should combine the
one-pass structure of `nice-to-read` with the useful anti-filler and anti-hype
rules from `unslop`. It should not be a second copy of `unslop`, and it should
not force personality, opinions, or extra detail into technical answers.

## Summary table

| Pattern or issue | Evidence seen on the private MacBook | Confidence | Useful automation | Best home |
|---|---|---:|---|---|
| Put the answer first | The global Claude and Codex instructions say to lead with the outcome. Cursor sessions contain explicit requests for a “very brief summary” and concise findings. | High | Put the result in the first sentence and remove repeated conclusions. | Global instructions plus `nice` |
| Keep responses short when the task is narrow | Historical prompts request very brief summaries, concise reviews, and word limits. Other prompts request long research or security documents, so short does not mean shallow. | High | Use a short default and expand only for risk, ambiguity, or requested depth. | `nice` |
| Use plain words and a small model for difficult ideas | `nice-to-read` requires one-pass clarity and simple sentences. The current request also states a conditional “explain it like I am five” mode. No historical frequency can be established for that exact phrase. | Medium-high | Define terms at first use and add one small example when needed. | `nice`, with teaching memories kept separate |
| Use lists and tables only when they improve scanning | Existing `nice-to-read` guidance says prose by default, lists for parallel items, and tables for short shared facts. Historical audits use tables when comparing findings. | High | Select the smallest format that makes the relationship clearer. | `nice` |
| Make the answer stand alone | `nice-to-read` explicitly avoids labels and callbacks that require scrollback. Review prompts repeatedly restate paths, scope, output limits, and safety boundaries. | High | Include the minimum context needed to interpret the result. | Global instructions plus `nice` |
| State checked, skipped, failed, and uncertain work | Global guidance requires failed and skipped checks to be named. Research prompts require primary sources and explicit unverified claims. | High | Use a final evidence checklist and never imply a check ran when it did not. | Global instructions and project verification skills |
| Do not invent missing requirements | Goal sessions ask for a binary done-when, but the user later changes status and dependency details. Research and review prompts also require unresolved decisions to stay visible. | Medium-high | Keep assumptions and open decisions explicit before writing stateful artifacts. | Global instruction plus workflow skills |
| Verify actual behavior, not only tests | In the `mdfried` conversation, the agent first changed invalid HTML to standard HTML without checking the target renderer. The user reported that it still failed, after which the agent inspected the CLI and changed the approach. | High | Run the real renderer, browser, preview, or runtime path after changes. | Project `run` or verification skills |
| Avoid repetition and visible internal deliberation | A Cursor code-review transcript gives a structured finding list and then repeats the same findings in prose. Several transcripts expose planning phrases before the final answer. | Medium-high | Deduplicate the final response and strip internal planning text. | `nice` |
| Ask before high-impact mutations | Global instructions require confirmation before commits and pushes. Historical prompts often say read-only or “do not commit.” Docker transcripts show rebuilds and container removal, but authorization context is incomplete. | High for Git; medium for Docker | Guard commits, pushes, tags, amend, destructive cleanup, and Compose cluster changes. | Global instructions plus config/hooks |
| Preserve project and machine boundaries | Claude memory stores worktree and repository-layout facts. Recent Claude sessions also show provider failures and requests to locate redesign work across branches or worktrees. | Medium-high | Start with branch, worktree, dirty-state, and machine context. | Project memory and `AGENTS.md` |
| Skill packaging causes avoidable failures | T3 logs report malformed YAML front matter in `~/.agents/skills/ts-google/SKILL.md` and `typescript/SKILL.md`, which broke Codex thread-title generation. The repository also contains an incomplete `skills/write-well/` draft. | High | Validate skill front matter, name/path consistency, and required files before installation. | Shared installer and repository `AGENTS.md` |
| Provider and MCP state interrupts work | A Claude session ended with expired OAuth. The same session reported a failed Paper MCP connection. T3 traces contain provider and thread-generation failures. | High that friction exists | Run a session-start health check and report the exact blocked capability. | Harness config and diagnostics |
| Keep the response skill set navigable | `unslop` and `nice-to-read` are installed in multiple harnesses, while each harness also has its own skill and config copies. This creates drift risk. | High | Keep one source of truth and test generated copies for equivalence. | Shared repository and installer |
| Prefer a combined `nice` skill over a new `unslop` fork | `nice-to-read` already owns answer-first structure, simplification, format choice, pruning, and verification. `unslop` owns anti-hype, anti-filler, anti-sycophancy, and AI-tell detection. | High | Merge the non-conflicting rules, then test the result against representative transcripts. | New `nice` skill, with `nice-to-read` merged or aliased |

## Repeated agent mistakes

### Fixing the conventional case without checking the actual tool

The `mdfried` exchange is the clearest example. The agent assumed that standard
HTML emphasis would work, changed the README, and only investigated the actual
renderer after the user reported failure.

The fix is procedural: inspect the target tool or runtime before claiming that a
format change works, then run the affected path after editing.

### Repeating findings after the answer is already complete

Some Cursor reviews provide a good structured answer and then restate the same
findings in a second explanatory block. This makes a correct answer feel less
reliable and violates the user's one-pass reading goal.

The response pass should remove repeated conclusions and keep only details that
change the user's next action.

### Writing state before all decisions are stable

The goals conversation created files, then changed the prior-goal link and both
statuses after the user clarified the intended sequence. The agent repaired the
files, but the first write was premature.

Stateful workflows should collect required decisions before writing, or make the
first write explicitly provisional.

### Escalating from implementation to risky environment changes

One Docker transcript shows an agent moving from a code fix to image rebuild,
container recreation, and `docker rm -f` while reasoning about how to avoid
touching unrelated services. The full user authorization is not available in
the sampled excerpt, so this is a safety signal rather than a proven violation.

The command layer should enforce the mutation boundary instead of relying only
on the agent remembering it.

## Workflow friction

The strongest friction is environmental rather than conceptual:

- expired Claude OAuth prevented a requested task from starting;
- a configured Paper MCP server failed to connect;
- malformed skill front matter broke Codex-generated thread titles;
- large JSON event records make complete conversation reconstruction difficult;
- branch, worktree, and project-layout context must be rediscovered across tools;
- T3 logs expose operational events but not a clean conversation export.

Agents should report these blockers directly, retry only when safe, and preserve
the distinction between completed work and partial work.

## Recommendation for `nice`

Create one personalized `nice` skill after the Mac mini and MacBook reports are
combined. It should:

1. put the result first;
2. use plain words and one-pass structure;
3. scale detail to risk and the user's requested depth;
4. choose prose, lists, or tables based on scanning value;
5. remove filler, hype, sycophancy, repetition, and vague claims;
6. preserve checks, failures, skipped work, uncertainty, and open decisions;
7. use simple models and examples only when the reader needs them;
8. avoid forcing opinions, artificial personality, or a fixed sentence rhythm.

Keep project-specific verification, domain rules, machine paths, and memories out
of the generic skill. Keep hard mutation gates in global instructions and
configuration, where they can be enforced.

## Evidence files inspected

- `~/.claude/CLAUDE.md`
- `~/.claude/skills/unslop/SKILL.md`
- `~/.claude/skills/nice-to-read/SKILL.md`
- `~/.codex/AGENTS.md`
- `~/.codex/skills/unslop/SKILL.md`
- `~/.codex/skills/nice-to-read/SKILL.md`
- `~/.agents/AGENTS.md`
- `~/.agents/skills/ts-google/SKILL.md`
- `~/.agents/skills/typescript/SKILL.md`
- selected Cursor transcripts under `~/.cursor/projects`
- selected Claude sessions under `~/.claude/projects`
- selected Codex rollouts under `~/.codex/sessions`
- T3 traces under `~/.t3/userdata/logs`
- the repository's existing Mac mini analysis documents
