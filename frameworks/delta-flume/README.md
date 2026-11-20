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

To add a vessel type, copy [templates/vessel.md](templates/vessel.md) to `vessels/<type>.md`.

## In a project

A project runs one or more **instances** of a vessel type. Each instance covers one part of the project, with its own scope, schedule and pause switch. Split a type into instances when one of those differs, or when a part needs its own how. A new subject alone, such as another dependency, stays in the same instance.

The project keeps the what apart from the how.

```
<project>/
  AGENTS.md                how, for every agent in the project
  .delta-flume/
    vessels/
      README.md            how, only for vessels
      maintenance/
        dependencies.md    what, for one instance
        docs.md
      testing/
        snapshot-tests.md
```

Everything delta-flume keeps in a project lives in `.delta-flume/`.

| File | Holds | Layer |
|---|---|---|
| `.delta-flume/vessels/<type>/<instance>.md` | the vessel type, active or paused, what the instance does here, its scope, and any policy overrides | purpose, policy |
| `.delta-flume/vessels/README.md` | the project's instances with each one's trigger and where it runs, and the how that only vessels need: an instance's commands and procedures, and the env vars and secrets: their names and where each comes from, never the values | mechanism |
| `AGENTS.md` | the how that every agent in the project needs: the commands to build and test, the runtime check, and off-limits files | mechanism |

If any agent working in the project needs it, it goes in AGENTS.md. If only a vessel needs it, it goes in `.delta-flume/vessels/README.md`. Neither repeats the other, so AGENTS.md stays small.

Name an instance after what it keeps, such as `dependencies` or `docs`, not after an action; the type already says what is done. The name goes into each unit's key. Instances of one type never claim the same subject, so every unit has one owner. They may share a file when each keeps a different part of it, such as the version lines in a README and the rest of its text.

The instance's `vessel` field names a type in [vessels/](vessels/) and matches its folder. The agent loop gets the type file, the instance file, the project's `.delta-flume/vessels/README.md` and its AGENTS.md. Agents load AGENTS.md on their own; the mechanism hands over the rest.

To set up a vessel in a project, follow [new-instance.md](new-instance.md).

## flume

`flume` is the command that runs a vessel's deterministic parts. It is a Go program, and all of its code is in [src/](src/).

```sh
go install github.com/jonaswahringer/delta-flume/src/cmd/flume@latest
go install github.com/google/osv-scanner/v2/cmd/osv-scanner@v2.7.1   # needed by flume scan
```

Both land in Go's bin folder, `~/go/bin` by default, which has to be on `PATH`.

| Command | What it does |
|---|---|
| `flume serve [project]...` | The server. It holds the queue, decides which node starts which unit, and answers the other commands. With project folders it is also a node, so one machine needs nothing else. |
| `flume node <project>...` | Makes this machine a node of a server that runs on another machine. It starts the agents of the units the server gives it. |
| `flume scan [dir]` | Lists the dependencies that have a security advisory, heaviest first. Each finding is one line of JSON with its key and weight. The key names the instance that keeps the project's dependencies: `dependencies`, or what `-instance` says. It runs [osv-scanner](https://google.github.io/osv-scanner/) 2.x, which must be installed and which reads advisories from OSV.dev. |
| `flume submit` | The gateway's Accept. Reads units on stdin, one JSON object per line with a `key` and a `weight`, and prints a decision for each. |
| `flume queue` | Lists the units waiting to start, in start order: heaviest first, then longest waiting. `-all` lists every unit with its state, its node, its agent session and its pull request. |
| `flume log` | Shows what was decided and done, and why, newest last. |
| `flume branch <key>` | Prints the one branch a unit's agent may write to, for example `vessel/maintenance/dependencies/lodash`. |

The agent runs these inside its worktree:

| Command | What it does |
|---|---|
| `flume prepare` | Writes the agent's rules file. T3 Code runs it in each new worktree, before the agent starts. |
| `flume push` | Pushes the unit's branch, and nothing else. |
| `flume pr` | Opens the unit's pull request, or updates the one that is open. The unit then waits at Land. |

On one machine:

```sh
flume serve ~/Projects/tiro ~/Projects/loki   # the server, and a node for these projects
flume scan ~/Projects/tiro | flume submit     # in another terminal: hand it findings
flume queue
```

Accept decides by the unit's key and its content:

| The unit | Decision |
|---|---|
| is new | accepted, and queued |
| is known, with the same content | declined |
| is queued, with new content | updated, and keeps its place in the queue |
| is starting or running, with new content | declined, and not stored, so the next submission after the run still counts as new |
| ended its run, with new content | accepted, and queued again |

### The server and its nodes

flume always runs as one server with nodes, also on a single machine. It is drawn in [diagrams/flume.html](diagrams/flume.html), and [src/README.md](src/README.md) outlines the code. The server is the only program that touches the units. A node is a machine that has project folders and an agent provider; it starts agents and nothing else.

A node asks the server what it should be working on. The answer is the whole picture: every unit the node should start, and every unit it started that is still running. An answer that gets lost therefore changes nothing, because the next one says the same. The server holds the question open and answers the moment something changes, so a unit starts within a second of being accepted and nothing runs on a timer.

The server gives a unit to a node when all of this holds:

| | |
|---|---|
| The node has the unit's project | its folder was named to `flume serve` or `flume node` |
| The node has room | fewer than `-max-running` units are starting or running there; the default is 1 |
| The instance is not paused there | `status: paused` in the project's `.delta-flume/vessels/<type>/<instance>.md` on that node |
| The unit has no session elsewhere | a unit that comes back with new input goes to the node that has its session, its branch and its checkout |

A second machine joins with:

```sh
flume node -server http://<the server's address>:7117 ~/Projects/tiro
```

| | |
|---|---|
| Where the units are | one SQLite file on the server: `-db`, else `$FLUME_DB`, else `~/.flume/flume.db` |
| Where a command finds the server | `-server`, else `$FLUME_SERVER`, else `http://127.0.0.1:7117` |
| Where the server listens | `-listen`, by default on this machine only |

What is not there yet:

- **Scans on a schedule.** Run `flume scan <project> | flume submit` yourself, or from a timer of your own.
- **A login.** The server asks nobody who they are. Keep it on this machine, or on a network only your machines are on. It warns when `-listen` opens it further.
- **A service.** Nothing keeps `flume serve` and `flume node` running across a restart. Run them under launchd or systemd.
- **A lease.** When a node goes away, the units it was working on stay with it.
- **An alert.** A dead letter shows in the server's log and in `flume queue -all`.

### Starting a unit

What runs the agent is a provider behind one contract, [src/internal/agent](src/internal/agent/agent.go). T3 Code is the provider there is today, and `-agent` names it. The node starts the agent as a T3 Code thread, in a new worktree on the unit's branch.

When the agent does not start, the unit goes back to its place in the queue and waits before the next try. The units behind it start meanwhile.

| | |
|---|---|
| The wait after a failed start | 2 minutes, then twice as long each time, up to 1 hour |
| When flume gives up | at the first failure that comes 6 hours after the first one. The unit becomes a dead letter. |
| What brings a dead letter back | new input for its key |
| What forgets the failures | a start that works, or new input |

The agent never names its branch and never publishes on its own:

| The agent wants to | What happens |
|---|---|
| work on a branch | flume derives the name from the unit's key, and T3 Code creates it with the worktree |
| push | `flume push` pushes that branch if the server says a unit that is running owns it. `git push` is denied. |
| open a pull request | `flume pr` opens one for that branch. `gh pr create` and `gh pr merge` are denied. |
| create or switch branches | denied |

The denials are a rules file for Claude Code, `.claude/settings.local.json` in the worktree. Its rules hold in every permission mode. The list is in [src/internal/claudecode/rules.go](src/internal/claudecode/rules.go).

One-time setup: in T3 Code, add a project script with the command `flume prepare` that runs when a worktree is created, and make the agent wait for it instead of running it in the background. On a branch that is not a unit's, the script does nothing.

This stops mistakes, not an agent that works around it. The agent runs as you, so it can reach git and your GitHub login by other spellings. A separate GitHub identity that may only push to `vessel/` branches would close that.

### Other programs

flume runs `git`, `gh`, `t3` and `osv-scanner`. Each gets a time limit, so a program that hangs cannot make flume hang:

| Program | Limit |
|---|---|
| `osv-scanner` | 5 minutes for one project's scan |
| `git` | 2 minutes for one command |
| `gh`, `t3` | 1 minute for one command |

At the limit flume asks the program to stop, kills it 3 seconds later if it has not stopped, and reports the step as failed with what the program wrote. A `flume` that is itself stopped, by Ctrl-C or by a service manager, does the same to the program it is running. A node still tells the server where its unit stands, and the server waits for that before it stops.

## Files

| Path | What it is |
|---|---|
| [src/](src/) | The code of the `flume` command: a Go module with the command in [src/cmd/flume](src/cmd/flume) and its packages in [src/internal/](src/internal/). |
| [diagrams/overview.html](diagrams/overview.html) | The big picture, with many triggers and several vessels. |
| [diagrams/blueprint.html](diagrams/blueprint.html) | The inside of one vessel. |
| [diagrams/flume.html](diagrams/flume.html) | How `flume` runs: the server and its nodes, a unit's life, and what is decided and not built yet. |
| [diagrams/why-vessels.html](diagrams/why-vessels.html) | One slide on why vessels beat role-based agents. |
| [diagrams/vs-factory.html](diagrams/vs-factory.html) | One slide comparing delta-flume with a typical software factory. |
| [vessels/](vessels/) | Vessel types, one file each. |
| [templates/vessel.md](templates/vessel.md) | Template for a new vessel type. |
| [new-instance.md](new-instance.md) | Steps to set up a vessel instance in a project. |
| [templates/instance.md](templates/instance.md) | Template for one vessel instance in a project. new-instance.md fills it. |
| [templates/vessels-readme.md](templates/vessels-readme.md) | Template for a project's `.delta-flume/vessels/README.md`. |
| [LICENSE](LICENSE) | MIT. |

## Open

- Queue order: first come first served, by weight, or something else. Each vessel decides for now.
- The ceiling multiple, and how size is estimated per vessel.
- When a unit is done.
- How a project reaches the type files: a link, a copy, or the installer.
