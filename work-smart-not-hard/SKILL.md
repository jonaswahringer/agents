---
name: work-smart-not-hard
description: Pick the model and reasoning effort for a delegated task. Use when spawning a subagent, running a workflow, deciding how hard to reason a task, or keeping a delegation inside an approved model/effort whitelist.
---

# Work smart, not hard

Spend intelligence where it changes the outcome, and nowhere else. Every delegated task gets a **model** and a **reasoning effort**; picking both too high burns cost and latency, too low ships sloppy work. The job is to **right-size**, then **escalate on evidence** — a failed attempt, a red test, a rejected verification — never on anticipation.

The decision has three inputs:

1. **Task type** — the *lane* (below). Picks the model first, because different models are good at different things.
2. **Difficulty** — how hard the *thinking* is (novelty, ambiguity, correctness stakes, ease of getting it wrong). Drives **effort** up the ladder: mechanical/specified → low; real reasoning or some ambiguity → medium/high; novel, correctness-critical, easy to get wrong → xhigh, and at the very top the lane's escalation model.
3. **Complexity** — how *much* is involved (scope, moving parts, files, coordination, context to hold). Also raises effort, and on its own can justify the lane's stronger model even when each step is easy — a large mechanical refactor is complex but not difficult.

When two settings feel equally right, **take the lower** and let evidence pull you up.

Hard rules that bound every choice:

- **Never exceed the [whitelist](#the-whitelist).** If a task seems to need a model or effort that isn't approved, stop and ask the human.
- **Fable 5 is opt-in only, and never runs above `high`.** The priciest model — chosen for cleverness, creativity, and taste, not routed to by default. Never auto-select it; reach for it only when the driver explicitly names it, capped at `high`.
- **Match the choice to the delegated job, not the parent's.** A cheap fan-out subagent stays cheap even when the orchestrator is doing hard work; a final correctness gate runs hot even when the surrounding task was routine.

## The whitelist

The single source of truth for what is allowed. **Humans curate this table** — the routing below only chooses *within* these rows.

| Model | Provider | Allowed effort | Cost (in / out per 1M) | Good for |
|---|---|---|---|---|
| **Composer 2.5** | Cursor | _fixed (no dial)_ | cheap — flat on Cursor plan | "Boring" routine coding + adjacent grunt work |
| **GPT 5.6 Luna** | OpenAI | `none`–`max` | $1 / $6 | Cheap fan-out; high-volume subagents |
| **Grok Code 4.5** | xAI (via Cursor) | `low`·`medium`·`high` (+ fast on/off) | $2 / $6 (fast: $4 / $18; >200K ctx: $4 / $12) | Well-spec'd hard coding; executing a settled plan |
| **GPT 5.6 Terra** | OpenAI | `none`–`max` | $2.50 / $15 | Cost-lean backend / refactors |
| **GPT 5.6 Sol** | OpenAI | `none`–`max` | $5 / $30 | Backend, large refactors, hard reasoning |
| **Opus 5** | Anthropic | ⟨— NEEDS EFFORT DIAL —⟩ | ⟨— NEEDS PRICING —⟩ | Frontend / UI, research synthesis, general reasoning, verification |
| **Fable 5** | Anthropic | `low`–`high` (**no `max`**) | $10 / $50 | Cleverness, creativity, taste on hard UI/design — **opt-in only** (driver must ask) |

## Route by task type

Find the lane, take the **default**, then use difficulty + complexity to move within it. Escalate only on evidence.

A hard task you've already planned is **spec'd** — the judgment is spent, so it belongs on a strong-but-cheap coding model, not an expensive reasoner. That's its own lane, and it's the one place you *don't* escalate upward by default: buying more reasoning would just re-buy work you've done.

| Task type | Default | Effort | Escalate to |
|---|---|---|---|
| **Boring / routine coding** (boilerplate, glue, config, scaffolding, mechanical edits) | Composer 2.5, GPT 5.6 Terra, or Grok Code 4.5 | Composer: —; Terra/Grok: `low`–`medium` | If it turns out *not* boring (real reasoning surfaces), kick up to the Backend lane |
| **Spec'd implementation** (hard code whose design is already settled — you planned it) | Grok Code 4.5, or GPT 5.6 Terra | Grok/Terra: `medium`–`high` | Only sideways, on evidence: if execution reveals *unsettled* design, the plan wasn't done → Backend lane |
| **Backend / large refactors** | GPT 5.6 Terra | `high`–`xhigh` | GPT 5.6 Sol (`high`) when genuinely hard. Drop boring sub-parts to Composer / Terra `low` |
| **Frontend / UI** (Claude models are stronger here) | Opus 5 | by difficulty | Fable 5 (`≤ high`) for the hardest UI — **only if the driver asks** |
| **Planning** (implementation plans, breaking work into steps, design docs) | Opus 5 | `medium`–`high` by difficulty/complexity | — |
| **Research** | Luna sub-agents (fan-out, cheap) at `low`–`medium` → **Opus 5** synthesizes | synth: `medium`–`high` | Raise synth effort before changing model |
| **General reasoning / debugging / design trade-offs** | GPT 5.6 Terra or Sol, or Opus 5 | `low`–`high` by difficulty | Fable 5 (`≤ high`) only if the driver asks |
| **Verification / correctness gate / judging** | GPT 5.6 Terra or Sol, or Opus 5 | `low`–`high` | keep the gate at least as hot as the work it checks |

## Applying it

1. **Name the lane** — which task type is this? The model comes from the lane.
2. **Take the lane's default** model and starting effort.
3. **Dial with difficulty and complexity**, reaching for the escalation model only at the top.
4. **Escalate on evidence** — a red test, a rejected verification, a missed attempt — never anticipation.
5. **Stay inside the [whitelist](#the-whitelist)**; if the task seems to need more, ask the human.
