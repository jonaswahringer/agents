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

| Model | Provider | Allowed effort | Cost (in / out per 1M) | Artificial Analysis signal | Good for |
|---|---|---|---|---|---|
| **Composer 2.5** | Cursor | _fixed (no dial)_ | Included in Cursor plan; not comparable to API token prices | Not measured as a standalone model | Routine coding + adjacent grunt work |
| **GPT 5.6 Luna** | OpenAI | `none`–`max` | $1 / $6 (legacy; recheck before use) | Superseded by GPT-6 Luna; keep only where the runtime still exposes it | Cheap fan-out; high-volume subagents |
| **GPT 6 Luna** | OpenAI | `none`–`max` | $0.10 / $0.50 | AA reports Intelligence Index 38 (Max); Coding Agent Index score 41 (Max), at about 60% lower cost than GPT-5.6 Luna, with a 2-point coding regression | Very cheap fan-out and high-volume subagents; choose another model for coding-intensive work |
| **Grok Code 4.5** | xAI (via Cursor) | `low`·`medium`·`high` (+ fast on/off) | $2 / $6 (fast: $4 / $18; >200K ctx: $4 / $12) | Older coding-specialized option; newer Grok 4.7 scores 42 at Low, $2 / $6, $1.25 per AA task | Well-spec'd hard coding; executing a settled plan |
| **GPT 5.6 Terra** | OpenAI | `none`–`max` | $2.50 / $15 (legacy; recheck before use) | AA's September 2026 release notes say GPT-6 Sol and Luna cut token prices about half versus GPT-5.6; Luna has a coding-score regression while Sol improves | Cost-lean backend / refactors while available in the runtime |
| **GPT 6.1 Sol** | OpenAI | `none`–`max` | $2 / $10; cache read discount 95% | Replaced GPT-6 Sol after seven days; Index 52 at Max and $0.72 per index task. Coding Agent Index Xhigh scores above Astra at under 15% of its task cost | Backend, coding, large refactors, hard reasoning |
| **Claude Opus 5.5** | Anthropic | `low`–`max` | $4 / $20; cache hit $0.20 | Index 58 (Max, top score); $5.98 per AA task. High quality, but much costlier per benchmark task than Gemini 4 Argon ($1.99) | Frontend/UI, planning, research synthesis, general reasoning, verification |
| **Claude Haiku 5.5** | Anthropic | `low`–`max` | $0.10 / $0.50 up to 100K input; $0.50 / $2.50 above 100K | Index 38 (High), 43 (Max); fast at 179.5 tokens/s. AA task-cost estimate excludes the 5× tiered price above 100K, so don’t use its current $0.08 figure for budgeting | Low-cost research fan-out and routine analysis on prompts under 100K; watch cost on long-context tasks |
| **Gemini 4 Argon** | Google | `low`–`max` (confirm runtime support) | $2 / $10; cache hit $0.10 | Index 53 (High); $1.99 per AA task; strongest AutomationBench score (78%) in AA's current comparison | SaaS workflow automation, broad reasoning, cost-sensitive strong-model work |
| **Grok 4.7** | xAI | `low`–`xhigh` (confirm runtime support) | $2 / $6; cache discount 75% | Index 42 (Low), $1.25 per AA task; 61 tokens/s | Cost-efficient coding and general reasoning when its runtime is available |
| **Fable 5** | Anthropic | `low`–`high` (**no `max`**) | $10 / $50 | No current comparable score captured in this refresh; expensive, so preserve opt-in-only policy | Cleverness, creativity, taste on hard UI/design — **opt-in only** (driver must ask) |

Artificial Analysis' Intelligence Index is a broad composite, not a task-specific winner. Its comparison page includes coding, agentic knowledge work, business workflow, and reasoning evaluations; the route table below remains a practical hypothesis and should be revisited against task-specific results and the models actually exposed by each runtime. API prices and benchmark task costs are not the cost of a Cursor subscription or T3 delegation. Snapshot checked 9 October 2026: [Artificial Analysis model comparison](https://artificialanalysis.ai/models/comparisons), [Claude Haiku 5.5 release and tiered pricing](https://artificialanalysis.ai/articles/claude-haiku-5-5), [Grok 4.7 Low](https://artificialanalysis.ai/models/grok-4-7-low), [GPT-6.1 Sol release analysis](https://artificialanalysis.ai/articles/gpt-6-1-sol-replaces-gpt-6-sol-after-just-7-days-with-near-astra-intelligence), [GPT-6 Sol/Luna cost analysis](https://artificialanalysis.ai/articles/gpt-6-sol-and-luna-push-the-cost-efficiency-frontier), [Claude Opus 5.5 analysis](https://artificialanalysis.ai/articles/claude-opus-5-5-takes-the-top-spot-on-the-artificial-analysis-intelligence-index), [Claude Haiku 5.5 release](https://artificialanalysis.ai/articles/claude-haiku-5-5).
## Route by task type

Find the lane, take the **default**, then use difficulty + complexity to move within it. Escalate only on evidence.

A hard task you've already planned is **spec'd** — the judgment is spent, so it belongs on a strong-but-cheap coding model, not an expensive reasoner. That's its own lane, and it's the one place you *don't* escalate upward by default: buying more reasoning would just re-buy work you've done.

| Task type | Default | Effort | Escalate to |
|---|---|---|---|
| **Boring / routine coding** (boilerplate, glue, config, scaffolding, mechanical edits) | Composer 2.5, GPT 6 Luna/Haiku 5.5, GPT 6.1 Sol, or Grok 4.7 | Composer: —; Luna/Haiku/Sol/Grok: `low`–`medium` | If it turns out *not* boring (real reasoning surfaces), kick up to the Backend lane |
| **Spec'd implementation** (hard code whose design is already settled — you planned it) | Grok 4.7, GPT 6 Luna, or GPT 6.1 Sol | Grok/Luna/Sol: `medium`–`high` | Only sideways, on evidence: if execution reveals *unsettled* design, the plan wasn't done → Backend lane |
| **Backend / large refactors** | GPT 6 Luna | `high`–`xhigh` | GPT 6.1 Sol (`high`) when genuinely hard. Drop boring sub-parts to Composer / Haiku `low` |
| **Frontend / UI** (Claude models are stronger here) | Claude Opus 5.5 | by difficulty | Fable 5 (`≤ high`) for the hardest UI — **only if the driver asks** |
| **Planning** (implementation plans, breaking work into steps, design docs) | Claude Opus 5.5 | `medium`–`high` by difficulty/complexity | — |
| **Research** | Luna sub-agents (fan-out, cheap) at `low`–`medium` → **Claude Opus 5.5** synthesizes | synth: `medium`–`high` | Raise synth effort before changing model |
| **General reasoning / debugging / design trade-offs** | GPT 6 Luna or GPT 6.1 Sol, or Claude Opus 5.5 | `low`–`high` by difficulty | Fable 5 (`≤ high`) only if the driver asks |
| **Verification / correctness gate / judging** | GPT 6 Luna or GPT 6.1 Sol, or Claude Opus 5.5 | `low`–`high` | keep the gate at least as hot as the work it checks |

## Applying it

1. **Name the lane** — which task type is this? The model comes from the lane.
2. **Take the lane's default** model and starting effort.
3. **Dial with difficulty and complexity**, reaching for the escalation model only at the top.
4. **Escalate on evidence** — a red test, a rejected verification, a missed attempt — never anticipation.
5. **Stay inside the [whitelist](#the-whitelist)**; if the task seems to need more, ask the human.
