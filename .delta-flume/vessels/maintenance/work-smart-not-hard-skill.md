---
vessel: maintenance
status: active
---

# Work-smart-not-hard-skill maintenance vessel in agents

## Here

Keeps `skills/jonasw/work-smart-not-hard` current as models, effort controls and prices change, and installs merged updates on the Mac mini. Without it, agents pick models from a stale routing table.

## Scope

Covers `skills/jonasw/work-smart-not-hard` and its installed copy on the Mac mini.

Leaves alone:

- Every other skill.
- The private routing preferences in `~/.config/agents/model-routing.json`, plan names and usage. Read them; never copy them into the repo or a PR.

## Overrides

Unit: one refresh of the skill. Key: `maintenance/agents/work-smart-not-hard-skill/refresh`, so a run updates the open refresh PR instead of opening another. Weight: low; a weekly refresh is not urgent.

Verify: no tests cover the skill. The runtime check is the live runtime catalog: every model ID and effort control in the skill must exist there. Catalog visibility does not prove entitlement.

Reject a change that breaks the routing policy, even with every check green. Benchmark rankings inform choices inside it and never override it:

- Claude owns code intended to merge and frontend and UI/UX work. GPT owns investigation, review and verification.
- Claude orchestration uses Opus, or explicitly chosen Fable, with Sonnet authors and lightweight children. GPT orchestration uses GPT-6 Astra with Sonnet authors and GPT investigation, review and verification children.
- Lightweight children are Haiku 5.5, GPT-6 Luna at low–medium, or GPT-6.1 Sol at low. GPT lightweight children may inventory files and extract supplied facts; Claude owns mergeable edits.
- Haiku 4.5, Terra and all Grok models are blacklisted as parents, children and fallbacks. An older Haiku never substitutes for 5.5.
- Fable stays opt-in and capped at high effort.
- Effort is chosen separately for each lead and child, and escalates on evidence.
- Parallel delegation needs authorization from the task or applicable instructions.
