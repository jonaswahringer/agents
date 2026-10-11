---
name: work-smart-not-hard
description: Choose a model and reasoning effort for a task or delegated child while respecting the approved routing policy and current runtime limits.
---

# Work smart, not hard

Choose the model for the task's role, then choose its effort from the task's difficulty and scope. Escalate when an attempt fails, evidence is ambiguous, or the correctness stakes demand another pass. Do not spend effort before the task calls for it.

Parallel delegation needs authorization from the task or applicable instructions. Every lead and child gets its own model and effort choice. Catalog visibility confirms that a model and control exist in this runtime. It does not confirm subscription entitlement.

## Routing policy

The task role determines the provider owner. Benchmarks inform choices within that role; they do not change it.

| Task role | Lead | Authors and children |
|---|---|---|
| Code intended to merge, including frontend and UI/UX | Claude Opus 5.5; Fable 5.1 only when explicitly chosen | Claude Sonnet 5.5 authors. Lightweight children may use Haiku 5.5 when available, GPT-6 Luna at low–medium, or GPT-6.1 Sol at low. |
| Investigation, review, verification, or GPT-led orchestration | GPT-6 Astra | Claude Sonnet 5.5 authors mergeable edits. GPT-6.1 Sol or Astra children handle investigation, review, and verification. GPT lightweight children may inventory files and extract supplied facts only. |

Claude-led orchestration uses Opus 5.5, or explicitly chosen Fable 5.1, with Sonnet 5.5 authors and lightweight children. GPT-led orchestration uses GPT-6 Astra with Sonnet 5.5 authors and GPT investigation, review, and verification children. GPT children do not author mergeable edits unless an explicit, narrowly scoped emergency exception permits crossing the provider boundary.

Choose effort separately for the lead and every child. Use low for mechanical inventory or extraction, medium for routine reasoning, and high or above only when ambiguity, scope, or failed evidence warrants it. A child does not inherit the parent's effort. Escalate on evidence, not anticipation.

## Approved models and controls

The runtime catalog was checked on 2026-10-11. IDs below are runtime IDs, not entitlement claims. Prices are Artificial Analysis public API prices in USD per million input/output tokens. They are comparison signals, not subscription capacity or the cost of our actual workflow.

| Model | Runtime ID | Allowed effort | API price in/out | Artificial Analysis signal | Role |
|---|---|---|---:|---|---|
| Claude Opus 5.5 | `claude-opus-5-5` | low–max | $4 / $20 | Index 58 at max; $5.98 per Index task | Claude lead and orchestration |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | low–max | $2 / $10 | Index 56 at max; $5.46 per Index task | Claude code author |
| Claude Fable 5.1 | `claude-fable-5-1` | low–high only | $10 / $50 | Index 51 at high; $3.91 per Index task | Explicitly chosen taste/design lead |
| GPT-6 Astra | `gpt-6-astra` | low–ultra | $10 / $50 | Index 53 at max; $3.26 per Index task | GPT lead and orchestration |
| GPT-6.1 Sol | `gpt-6.1-sol` | low–ultra | $2 / $10 | Index 52 at max; $0.72 per Index task | GPT investigation, review, verification; lightweight child at low |
| GPT-6 Luna | `gpt-6-luna` | low–max | $0.10 / $0.50 | Index 38 at max; $0.07 per Index task | Lightweight inventory and extraction at low–medium |
| Claude Haiku 5.5 | Not exposed in the current T3 catalog | low–max when available | $0.10 / $0.50 | Index 43 at max; low effort costs $0.02 per Index task | Lightweight child when available |

The current T3 runtime catalog does not expose Haiku 5.5. It exposes Haiku 4.5 without an effort control, but Haiku 4.5 is blacklisted and must not be used as a substitute. When Haiku 5.5 cannot run, use GPT-6 Luna at low–medium or GPT-6.1 Sol at low for lightweight inventory and extraction. The GPT child may not author a mergeable edit.

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

## How to read benchmark evidence

Artificial Analysis Intelligence Index v4.3.2 combines AA-Briefcase v1.1, GDPval-AA v2.1, AutomationBench-AA, Terminal-Bench 4.0, SciCode, Humanity's Last Exam, GDP.pdf, CritPt, AA-Omniscience, and AA-LCR v1.1. The score is broad intelligence, not a direct score for every work role.

- Implementation: Terminal-Bench 4.0 and the Artificial Analysis Coding Agent Index provide coding-agent evidence. Neither isolates all production implementation work.
- UI/UX: the cited AA comparisons do not provide a dedicated frontend or design-quality benchmark. Keep Claude ownership from the routing policy; do not infer UI skill from the broad Index alone.
- Investigation: AA-Briefcase v1.1 and GDPval-AA v2.1 cover multi-step knowledge work. AA-Omniscience adds accuracy and hallucination signals, not a complete investigation score.
- Review and verification: no cited aggregate isolates review quality or correctness-gate performance. Use task evidence and the required checks; a broad Index rank does not prove a review passed.
- Orchestration: AutomationBench-AA and coding-agent tool-use evaluations are relevant signals, but do not establish subscription capacity or guarantee performance in our T3 setup.

Artificial Analysis cost per task estimates the public API spend for its named benchmark. It is not a subscription quota, plan allowance, delegated-task invoice, or estimate of our workflow cost. Compare it only within the approved role and model pool. Prefer the Pareto-efficient option only when its role, effort, and runtime availability also fit. Its Anthropic release comparisons mark default-fallback variants; those benchmark variants do not establish which fallback or effort controls this T3 runtime will actually use.

Slopalytics is a secondary view. Checked on 2026-10-11, its data includes GPT-6.1 Sol and Haiku 5.5 and displays low through max variants for the approved models. The default selection includes eight model families, including Gemini 4 Argon and Grok 4.7, while omitting Sonnet 5.5. Filter to the approved pool before comparing routes. In the cost-versus-intelligence view, the horizontal axis is cost per task in USD on a log scale, not token price; the Pareto-line control is off by default. The page says data comes from Artificial Analysis but shows no refresh timestamp or benchmark version. Check its exact model selection and effort variants, and confirm versioned benchmark claims and prices against Artificial Analysis. Do not mistake benchmark task cost for our plan allowance or workflow cost.

Theo's videos may add practical observations, but cite the exact video, publication date, and timestamp. Attribute recommendations as opinion. Do not infer detailed claims from a title or an unavailable transcript.

## Current evidence

Checked 2026-10-11 against Artificial Analysis Intelligence Index v4.3.2. Exact variants matter. Opus 5.5 ranges from Index 42 at low to 58 at max; Astra ranges from 46 at low to 53 at max; Sonnet 5.5 ranges from 36 at low to 56 at max. GPT-6.1 Sol scores 52 at max for $0.72 per Index task, while Astra scores 53 for $3.26. These costs are benchmark estimates, not workflow or subscription costs.

Role-specific evidence at max effort helps explain the routes, but it does not change them:

| Work signal | Exact benchmark result | Limit |
|---|---|---|
| Implementation | Terminal-Bench 4.0: Sonnet 5.5 63.6%, Opus 5.5 59.6%, GPT-6 Astra 59.1% | Terminal tasks do not measure all mergeable code or UI quality. |
| UI/UX | No dedicated frontend or design-quality score in these comparisons. | Keep Claude ownership from policy, not a broad-index inference. |
| Investigation | AA-Briefcase v1.1 / GDPval-AA v2.1: Sonnet 5.5 1823 / 1838; Opus 5.5 1807 / 1866; Astra 1570 / 1574. | Knowledge-work benchmark scores do not measure every investigation. |
| Review and verification | No evaluation isolates review quality or a correctness gate. | Require evidence and completed checks; broad intelligence cannot pass a gate. |
| Orchestration | AutomationBench-AA: Sonnet 5.5 71.8%, Opus 5.5 69.5%, Astra 68.5%. | Tool-use benchmark results are not a guarantee for T3 orchestration. |
| Lightweight children | At low effort, Haiku 5.5 scores 29 at $0.02 per Index task; Luna scores 22 at $0.0045. Haiku's Terminal-Bench score is 12.6%, Luna's is 0%. | Haiku 5.5 is absent from this runtime. Luna remains the runnable low-cost inventory/extraction choice. |

The numbers above compare exact releases and effort variants, not provider entitlement. For Haiku 5.5, release comparisons cover low through max; for Opus, Sonnet, Astra, Sol, and Luna, use the effort-specific values on the linked release pages rather than substituting a different variant's result.

Sources:

- [Artificial Analysis release comparison: Opus 5.5 and GPT-6 Astra](https://artificialanalysis.ai/models/releases/comparisons/claude-opus-5-5-vs-gpt-6-astra)
- [Artificial Analysis release comparison: Sonnet 5.5 and GPT-6 Astra](https://artificialanalysis.ai/models/releases/comparisons/claude-sonnet-5-5-vs-gpt-6-astra)
- [Artificial Analysis release comparison: Haiku 5.5 and GPT-6 Luna](https://artificialanalysis.ai/models/releases/comparisons/claude-haiku-5-5-vs-gpt-6-luna)
- [Artificial Analysis Opus 5.5 comparison](https://artificialanalysis.ai/models/comparisons/claude-opus-5-5-vs-gpt-6-astra-medium)
- [Artificial Analysis Sonnet 5.5 release and evaluation notes](https://artificialanalysis.ai/articles/claude-sonnet-5-5)
- [Artificial Analysis GPT-6.1 Sol release analysis](https://artificialanalysis.ai/articles/gpt-6-1-sol-replaces-gpt-6-sol-after-just-7-days-with-near-astra-intelligence)
- [Artificial Analysis GPT-6 Sol and Luna cost analysis](https://artificialanalysis.ai/articles/gpt-6-sol-and-luna-push-the-cost-efficiency-frontier)
- [Artificial Analysis Haiku 5.5 release comparison](https://artificialanalysis.ai/models/releases/claude-haiku-5-5)
- [Artificial Analysis Fable 5.1 effort comparison](https://artificialanalysis.ai/models/claude-fable-5-1-high)
- [Slopalytics](https://slopalytics.com/)
