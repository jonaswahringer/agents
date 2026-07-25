---
name: work-smart-not-hard
description: Pick the model and reasoning effort for a delegated task. Use when spawning a subagent, running a workflow, delegating to another model, or deciding how hard a task should be reasoned. Routes by task type and binds every choice to a human-approved whitelist.
---

# Work smart, not hard

Spend intelligence where it changes the outcome, and nowhere else. Every delegated task gets a **model** and a **reasoning effort**; picking both too high burns cost and latency, too low ships sloppy work. The job is to **right-size**, then **escalate on evidence** — a failed attempt, a red test, a rejected verification — never on anticipation.

The decision has three inputs:

1. **Task type** — the *lane* (below). This picks the model first, because different models are good at different things.
2. **Difficulty** — how hard the *thinking* is (novelty, ambiguity, correctness stakes, ease of getting it wrong). Drives the **effort** up the ladder.
3. **Complexity** — how *much* is involved (scope, moving parts, files, coordination, context to hold). Also pushes effort up, and justifies the lane's stronger model when there's a lot to hold at once.

Hard rules that bound every choice:

- **Never exceed the [whitelist](#the-whitelist).** If a task seems to need a model or effort that isn't approved, stop and ask the human.
- **Fable 5 is opt-in only, and never runs at `max`.** The priciest model — chosen for cleverness, creativity, and taste, not routed to by default. Never auto-select it; reach for it only when the driver explicitly names it, capped at `xhigh`.
- **Match the choice to the delegated job, not the parent's.** A cheap fan-out subagent stays cheap even when the orchestrator is doing hard work; a final correctness gate runs hot even when the surrounding task was routine.

## The whitelist

The single source of truth for what is allowed. **Humans curate this table** — the routing below only chooses *within* these rows.

| Model | Provider | Allowed effort | Cost (in / out per 1M) | Good for |
|---|---|---|---|---|
| **Composer 2.5** | Cursor | _fixed (no dial)_ | cheap — flat on Cursor plan | "Boring" routine coding + adjacent grunt work |
| **GPT 5.6 Luna** | OpenAI | `none`–`max` | $1 / $6 | Cheap fan-out; high-volume subagents |
| **GPT 5.6 Terra** | OpenAI | `none`–`max` | $2.50 / $15 | Cost-lean backend / refactors |
| **GPT 5.6 Sol** | OpenAI | `none`–`max` | $5 / $30 | Backend, large refactors, hard reasoning |
| **Opus 4.8** | Anthropic | `low`–`max` | $5 / $25 | Frontend / UI, research synthesis, general reasoning |
| **Fable 5** | Anthropic | `low`–`xhigh` (**no `max`**) | $10 / $50 | Cleverness, creativity, taste on hard UI/design — **opt-in only** (driver must ask) |

Effort ladders differ by model: GPT 5.6 runs `none · low · medium · high · xhigh · max`; Opus runs `low · medium · high · xhigh · max`; Fable stops at `xhigh`; Composer has no dial.

## Route by task type

Find the lane, take the **default**, then use difficulty + complexity to move within it. Escalate only on evidence.

| Task type | Default | Effort | Escalate to |
|---|---|---|---|
| **Boring / routine coding** (boilerplate, glue, config, scaffolding, mechanical edits) | Composer 2.5, or GPT 5.6 Terra | Composer: —; Terra: `low`–`medium` | If it turns out *not* boring (real reasoning surfaces), kick up to the Backend lane |
| **Backend / large refactors** | GPT 5.6 Terra | `high`–`xhigh` | GPT 5.6 Sol (`high`–`max`) when genuinely hard. Drop boring sub-parts to Composer / Terra `low` |
| **Frontend / UI** (Claude models are stronger here) | Opus 4.8 | by difficulty | Fable 5 (`≤ xhigh`) for the hardest UI — **only if the driver asks** |
| **Planning** (implementation plans, breaking work into steps, design docs) | Opus 4.8 | `medium`–`high` by difficulty/complexity | — |
| **Research** | Luna sub-agents (fan-out, cheap) at `low`–`medium` → **Opus 4.8** synthesizes | synth: `medium`–`high` | Raise synth effort before changing model |
| **General reasoning / debugging / design trade-offs** | Opus 4.8 | `medium`→`xhigh` by difficulty | GPT 5.6 Sol at `xhigh`–`max`; Fable 5 (`≤ xhigh`) only if the driver asks |
| **Verification / correctness gate / judging** | GPT 5.6 Sol or Opus 4.8 | `high`–`max` | run the gate hotter than the work it checks |

## The two dials, within a lane

Once the lane fixes the model, difficulty and complexity decide how far up the ladder — and when to reach for the lane's escalation option.

- **Difficulty** raises **effort**. Mechanical/specified → low. Real reasoning, some ambiguity → medium/high. Novel, correctness-critical, easy to get wrong → xhigh, and at the very top the lane's escalation model.
- **Complexity** also raises **effort** (more parts to hold and coordinate) and, on its own, can justify the lane's stronger model even when each step is easy — a large mechanical refactor is complex but not difficult.
- When two settings feel equally right, **take the lower** and let evidence pull you up.

## Applying it

1. **Name the lane.** What *kind* of task is this — routine coding, backend/refactor, frontend, research, general reasoning, or verification?
2. **Take the lane's default** model + starting effort.
3. **Dial with difficulty and complexity.** Push effort up for hard thinking or heavy scope; reach for the escalation model only at the top.
4. **Escalate on evidence, not anticipation.** A red test, a rejected verification, a missed attempt — that is the signal to climb.
5. **Stay inside the whitelist.** If the task appears to need something the table doesn't approve, surface it to the human instead of reaching past it.
