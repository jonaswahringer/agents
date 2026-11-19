# delta-flume (v0)

**Standalone repo:** https://github.com/jonaswahringer/delta-flume

A framework for agent work that stays the same while tools change. A **delta** fans one stream of triggers out to many vessels; a **flume** carries each unit to where the work happens. Each responsibility gets a **vessel**: a fixed shape that today's agents and tools fill.



## Big picture

Drawn in [diagrams/overview.html](diagrams/overview.html).

```
Typed trigger ─────────────────────────────────┐
                                               ├─► Vessel ─► Output
Loose trigger ─► Triage ─► Route (human) ─────┘
                   ├─ parked ─► backlog
                   └─ spam ───► quarantine
```

| Part | Job |
|---|---|
| Trigger | Starts work. Comes from outside the vessels. A **typed** trigger comes from a trusted source, and its channel names the vessel (a schedule, an opened PR, a human's go). Everything else is **loose**. |
| Triage | Shared by all vessels, owned by none. Takes loose triggers only, sorts and labels them, and proposes a route. An agent or a person can do it; tiro is one option. It acts alone only if the action is internal and reversible, such as quarantining spam. |
| Route | A human approves the route, which turns a loose trigger into a typed one. |
| Vessel | One responsibility. Every vessel follows the same blueprint; only the purpose differs. |
| Output | What a vessel produces, such as a PR, a report or an issue. |

## Inside a vessel

Every vessel follows this blueprint, drawn in [diagrams/blueprint.html](diagrams/blueprint.html).

```
Trigger ─► Gateway ─────► Agent loop ────────────────────────► Land ─► Output
           Accept         Write ─► Verify ─► Findings ─ none ─┘    │
           Start            ▲  ▲                │                  ├─ rejected ─► closed
           Estimate         │  └─── findings ───┘                  │
             │              └──────────── changes requested ───────┘
             └─ not accepted ─► logged    (not started yet: queue)

Watcher: tracks tokens and time against the estimate, and silence.
         Over the estimate ─► a human is notified. Stuck or over the ceiling ─► dead letters.
```

| Part | Job |
|---|---|
| Unit | One piece of work. The framework says "unit"; each vessel names its own kind, such as a finding or a message. |
| Gateway | The vessel's input policy. **Accept** judges the unit: it declines a duplicate without new input, a superseded unit, or incomplete input (and asks for what's missing). Duplicates are found by an **idempotency key** taken from the unit, not from the run. **Start** judges the vessel: when it's overloaded or paused, the unit waits in a queue; each vessel picks its order. **Estimate** sets the unit's size (see [Measures](#measures)): deterministic when a number exists, otherwise an agent estimates. Accept and Start are deterministic. Whether a unit belongs to this vessel is settled before it arrives, by the trigger's channel or a human route. |
| Agent loop | The mechanism. **Write** (agents and tools) makes a change, **Verify** checks it, and each finding goes back to Write. The loop ends when no findings are left. It works alone until Land, and a human can step in at any time. |
| Verify | Cheapest checks first, after poteto's pyramid: static analysis and tests, runtime verification, then a review agent checking prose rules and skills. Humans don't verify inside the loop; they decide at Land. A well-designed codebase makes every check cheaper. |
| Land | Decides whether output lands. A human decides by default. A reversible class of work can be allow-listed to land on deterministic checks alone. The allow-list is empty for now. Changes requested go back into the loop as findings; a rejected unit is closed and recorded. |
| Retry budget | What a unit may spend in the loop, in tokens and time. The estimate is the expected spend, and a hard ceiling sits at a multiple of it. |
| Watcher | Tracks what the loop spends against the estimate. Over the estimate, a human is notified and can step in. Stuck (no progress, long silence) or over the ceiling, the unit moves to the dead-letter queue. |
| Dead-letter queue | Stuck units. A human is notified. |
| Record | Every vessel leaves a trace of source, reasoning and decision for each unit. Where it lives is mechanism: a PR, the code and its git history, an issue, or a log. |

## Layers

Every vessel has three layers.

| Layer | Lasts | Holds | Shows up as |
|---|---|---|---|
| Purpose | decades | why the vessel exists | the vessel |
| Policy | years | the rules a unit has to pass | gateway, findings, land |
| Mechanism | months | what does the work today, replaceable | the agent loop: agents and tools, such as agent CLIs and the runtime |

## Kinds of part

Every part of a vessel is one of three kinds.

| Kind | Example | Its verdict |
|---|---|---|
| **d** deterministic | compiler, tests, CI | a fact |
| **s** stochastic | an agent | a suggestion |
| **h** human | a reviewer | a decision, with discretion and responsibility |

An agent's verdict never moves a unit past a decision on its own.

## Measures

Three measures, kept apart: how much a unit matters, how much work it is, and what it has used.

| Measure | Made of | Set by | Used for |
|---|---|---|---|
| **Weight** | criticality × urgency, on four levels: low, normal, high, critical | the trigger when typed (for example a CVE's severity score), or triage and a human route when loose | attention: the heavier the unit, the sooner a human is notified |
| **Size** | expected spend, in tokens and time | the gateway's Estimate: deterministic when a number exists (for example lines changed between two dependency versions), otherwise an agent | the retry budget: a bigger unit gets more |
| **Spend** | tokens and time used | the watcher | comparing against the estimate and the ceiling |

## Vessels

| Vessel | Purpose | Status |
|---|---|---|
| Prototype (UI/UX) | prototype designs to try out UI and UX ideas | planned |
| Implement (SWE) | turn an agreed change into working, verified code | planned |
| Testing (SWE) | keep a project's tests up to date and compact, for example snapshot tests, and sharpen the suite over time | planned |
| [Maintenance (SWE)](vessels/maintenance.md) | keep software secure, up to date and working | defined |
| Meta | improve the overall process, the architecture, or specific vessels | planned |

Discovery of new work stays human: a backlog plus a digest that alerts on strong demand or high-reward opportunities.

To add a vessel type, copy [templates/vessel.md](templates/vessel.md) to `vessels/<name>.md`.

## In a project

A project that runs vessels keeps the what apart from the how.

```
<project>/
  AGENTS.md            how, shared by every vessel
  vessels/
    maintenance.md     what, for one vessel in this project
    testing.md
```

| File | Holds | Layer |
|---|---|---|
| `vessels/<name>.md` | the vessel type, active or paused, what it does here, its scope, and any policy overrides | purpose, policy |
| `AGENTS.md` | the commands to build and test, the runtime check, and the env vars and secrets a vessel needs: their names and where each comes from, never the values | mechanism |

The instance's `vessel` field names a type in [vessels/](vessels/). The agent loop gets the type file, the instance file and the project's AGENTS.md. Agents load AGENTS.md on their own, so the how has one home.

To set up a vessel in a project, follow [new-instance.md](new-instance.md).

## Files

| Path | What it is |
|---|---|
| [diagrams/overview.html](diagrams/overview.html) | The big picture, with many triggers and several vessels. |
| [diagrams/blueprint.html](diagrams/blueprint.html) | The inside of one vessel. |
| [diagrams/why-vessels.html](diagrams/why-vessels.html) | One slide on why vessels beat role-based agents. |
| [diagrams/vs-factory.html](diagrams/vs-factory.html) | One slide comparing delta-flume with a typical software factory. |
| [vessels/](vessels/) | Vessel types, one file each. |
| [templates/vessel.md](templates/vessel.md) | Template for a new vessel type. |
| [new-instance.md](new-instance.md) | Steps to set up a vessel in a project. |
| [templates/instance.md](templates/instance.md) | Template for a vessel in a project. new-instance.md fills it. |
| [LICENSE](LICENSE) | MIT. |

## Open

- Queue order: first come first served, by weight, or something else. Each vessel decides for now.
- The ceiling multiple, and how size is estimated per vessel.
- When a unit is done.
- How a project reaches the type files: a link, a copy, or the installer.
