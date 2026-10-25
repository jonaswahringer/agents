---
name: work-smart-not-hard
description: Choose a model and reasoning effort for a task or delegated child while respecting the approved routing policy and current runtime limits.
---

# Work smart, not hard

Choose the model for the task's role, then choose its effort from the task's difficulty and scope. Escalate when an attempt fails, evidence is ambiguous, or the correctness stakes demand another pass. Do not spend effort before the task calls for it.

Parallel delegation needs authorization from the task or applicable instructions. Every lead and child gets its own model and effort choice. Catalog visibility confirms that a model and control exist in this runtime. It does not confirm subscription entitlement.

## Routing policy

The task role determines the provider owner.

| Task role | Lead | Authors and children |
|---|---|---|
| Code intended to merge, including frontend and UI/UX | Claude Opus 5.5; Fable 5.1 only when explicitly chosen | Claude Sonnet 5.5 authors. Lightweight children may use Haiku 5.5 when available, GPT-6 Luna at low–medium, or GPT-6.1 Sol at low. |
| Investigation, review, verification, or GPT-led orchestration | GPT-6 Astra | Claude Sonnet 5.5 authors mergeable edits. GPT-6.1 Sol or Astra children handle investigation, review, and verification. GPT lightweight children may inventory files and extract supplied facts only. |

Claude-led orchestration uses Opus 5.5, or explicitly chosen Fable 5.1, with Sonnet 5.5 authors and lightweight children. GPT-led orchestration uses GPT-6 Astra with Sonnet 5.5 authors and GPT investigation, review, and verification children. GPT children do not author mergeable edits unless an explicit, narrowly scoped emergency exception permits crossing the provider boundary.

Choose effort separately for the lead and every child. Use low for mechanical inventory or extraction, medium for routine reasoning, and high or above only when ambiguity, scope, or failed evidence warrants it. A child does not inherit the parent's effort. Escalate on evidence, not anticipation.

## Approved models and controls

The T3 runtime catalog was checked on 2026-10-25. IDs below are runtime IDs, not entitlement claims.

| Model | Runtime ID | Allowed effort | Role |
|---|---|---|---|
| Claude Opus 5.5 | `claude-opus-5-5` | low–max | Claude lead and orchestration |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | low–max | Claude code author |
| Claude Fable 5.1 | `claude-fable-5-1` | low–high only | Explicitly chosen taste/design lead |
| GPT-6 Astra | `gpt-6-astra` | low–ultra | GPT lead and orchestration |
| GPT-6.1 Sol | `gpt-6.1-sol` | low–ultra | GPT investigation, review, verification; lightweight child at low |
| GPT-6 Luna | `gpt-6-luna` | low–max | Lightweight inventory and extraction at low–medium |
| Claude Haiku 5.5 | `claude-haiku-5-5` | low–max | Lightweight child when available |

The current T3 runtime catalog exposes Haiku 5.5 and its low–max effort control. It also exposes Haiku 4.5 without an effort control, but Haiku 4.5 is blacklisted and must not be used as a substitute. When Haiku 5.5 cannot run, use GPT-6 Luna at low–medium or GPT-6.1 Sol at low for lightweight inventory and extraction. The GPT child may not author a mergeable edit.

## Current cost signals

Artificial Analysis Intelligence Index v4.3.2 provides comparable task-cost and intelligence signals for the exact effort variants shown below. Prices are public API prices in USD per million input/output tokens. Cost per task is the weighted cost of one Artificial Analysis Intelligence Index task. Neither measure represents subscription capacity or the cost of our actual workflow.

| Model | Index range across evaluated efforts | Cost per Index task across evaluated efforts | API input/output per 1M tokens |
|---|---:|---:|---:|
| Claude Opus 5.5 | 42–58 | $0.55–$5.98 | $4 / $20 |
| Claude Sonnet 5.5 | 36–56 | $0.35–$5.46 | $2 / $10 |
| Claude Fable 5.1 | 47–51 | $2.37–$3.91 (low–high only) | $10 / $50 |
| GPT-6 Astra | 46–53 | $0.82–$3.26 | $10 / $50 |
| GPT-6.1 Sol | 42–52 | $0.13–$0.72 | $2 / $10 |
| GPT-6 Luna | 18–38 | $0.0045–$0.07 | $0.10 / $0.50 |
| Claude Haiku 5.5 | 29–43 | $0.02–$0.21 | $0.10 / $0.50 |

These ranges combine distinct effort variants, not one recommended setting. Select effort for the task and role; use the index as a broad capability signal. Terminal-Bench 4.0 and AutomationBench-AA can inform coding and agentic-work choices, while AA-Briefcase and GDPval-AA cover knowledge-work tasks. The index does not directly measure UI/UX quality, investigation quality, code review, verification, or T3 orchestration. Do not generalize one benchmark to those tasks.

Artificial Analysis lists GPT-6.1 Sol's cost-efficient frontier position within its evaluated pool. Slopalytics' current comparison shows the same selected model families and effort variants on an Intelligence Index versus cost-per-task chart, with a logarithmic cost axis and a Pareto line control. Its visible page has no data-refresh timestamp; its benchmark data is attributed to Artificial Analysis. Check the underlying Artificial Analysis release and benchmark pages before relying on a plotted value.

Sources checked 2026-10-25: [Artificial Analysis model releases](https://artificialanalysis.ai/models/releases), [Intelligence Index v4.3.2](https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index), [Slopalytics](https://slopalytics.com/).

## Blacklist

Never select these as a parent, child, or fallback:

- Claude Haiku 4.5, including any older Haiku substituted for Haiku 5.5
- GPT-5.6 Terra
- Every Grok model, including Grok 4.7 and Grok Code 4.5

## Reasoning effort

Choose effort per model call, not once for the whole task.

| Effort | Use when |
|---|---|
| low | Inventory, extraction from supplied material, or a clear mechanical step |
| medium | Routine investigation, review, or implementation within a settled design |
| high | Several moving parts, meaningful ambiguity, or a first failure that needs diagnosis |
| xhigh / max | A correctness-critical or novel lead task that remains uncertain after a strong attempt |
| ultra | Only when the runtime supports it and evidence shows max is insufficient |

Do not raise child effort just because the parent is using a stronger model. Keep Fable 5.1 opt-in and at high or below even if the catalog exposes higher settings.

## Rate limits and urgent fallbacks

Use this fallback procedure only when the user marks the work time-sensitive or its deadline comes before the provider's reported reset. A weekly refresh is not urgent by itself.

First identify the limit from the provider's message and preserve its reset time:

- A temporary throttle may clear after the reported short wait. Retry after that time when the deadline allows.
- A model-specific limit blocks that model. Prefer an available approved model in the same role.
- A shared session limit can cover several models in that provider session. Switching apps or models does not reset shared allowance.
- Weekly exhaustion lasts until the provider-reported weekly reset. Do not guess a reset time.

If Haiku 5.5 is blocked or unavailable, use Luna low–medium or Sol low for lightweight inventory and extraction. Selecting a different orchestrator does not make blocked child models available. A Claude authoring task remains Claude-owned, and GPT investigation, review, and verification remain GPT-owned. Crossing either boundary requires an explicit, narrowly scoped emergency exception that names the work and permitted model.

Never automatically enable paid overflow, buy credits, upgrade a plan, purchase a reset, or switch to API billing. If no approved route is available before the deadline, checkpoint findings, pending checks, and provider reset times. Do not report an incomplete verification gate as passed.
