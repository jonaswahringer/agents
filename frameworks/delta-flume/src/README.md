# flume, the code (v0.1)

`flume` runs the deterministic parts of a delta-flume vessel. It is one Go program with one dependency, a SQLite driver in pure Go. This page is the outline of how it is built. It is rough: the list at the end says what is decided and not built yet.

```sh
go test ./...                       # from this folder
go build -o flume ./cmd/flume
```

## One server, and nodes

flume always runs as one server with nodes, also on a single machine.

```
 trigger                     server                              node (each machine)
┌───────────────────┐      ┌────────────────────────┐          ┌──────────────────────────┐
│ flume scan        │      │ Accept ─► queue        │◄─ asks ──│ "what should I work on?" │
│   | flume submit ─┼─────►│ who starts what        │─ answer ►│ starts the agents        │
└───────────────────┘      │ one SQLite file        │◄─ tells ─│ started / not started    │
                           └────────────────────────┘          └──────────────────────────┘
                                      ▲                                     │ agent, in its worktree
                                      └──── may this branch publish? ───────┘ flume prepare / push / pr
```

- **The server** is the only program that touches the units. It holds the queue, applies the rules, and decides which node starts which unit.
- **A node** is a machine with project folders and an agent provider. It starts agents and reports back. It keeps nothing between runs.
- **`flume serve <project>...`** is both at once, so one machine needs nothing else. A second machine runs `flume node`.

## The line between a node and the server

The node dials out. The server never calls a node.

- **The answer is the whole picture:** every unit the node should start, and every unit it started that is still running. A lost answer changes nothing, because the next one says the same.
- **The question is held open.** The server answers the moment something changes, so nothing runs on a timer. With nothing new, the node asks again after 25 seconds.
- **Everything is JSON over HTTP**, with Go's standard library.

| Call | Who makes it | What it does |
|---|---|---|
| `POST /v1/submit` | `flume submit` | hands units to Accept |
| `POST /v1/sync` | a node | reports the node, returns what it should work on |
| `POST /v1/started`, `/v1/not-started` | a node | says what came of a start |
| `POST /v1/owner`, `/v1/pushed`, `/v1/pull-request` | `flume prepare`, `push`, `pr` | asks which unit owns a branch, records what was published |
| `GET /v1/units`, `/v1/events` | `flume queue`, `flume log` | lists units and the record |

## A unit's life

```
            ┌────────────── failed start: wait 2 min, then twice as long, up to 1 h ───────────┐
            ▼                                                                                   │
 accepted ► queued ──► starting ──► running ──► landing ──► landed or rejected (a human, not built)
            ▲            on a node               a pull request is open
            │                └──► dead-letter: still failing 6 h after the first failure
            └── new input brings a unit back from landing, landed, rejected or dead-letter
```

A unit is one row, found by its key: `<vessel>/<project>/<instance>/<subject>`. Its branch is derived from the key and never chosen: `vessel/<vessel>/<instance>/<subject>`.

## Packages

| Package | What it holds |
|---|---|
| [cmd/flume](cmd/flume) | One file per command. Wiring only. |
| [internal/unit](internal/unit) | A unit's key, weight, state and branch name. |
| [internal/gateway](internal/gateway) | The rules: Accept, the start order, which node gets a unit, the wait after a failed start, and which unit owns a branch. |
| [internal/store](internal/store) | The SQLite file. Only the server opens it. |
| [internal/server](internal/server) | The control plane: decides who starts what, serves the HTTP calls, holds questions open. |
| [internal/wire](internal/wire) | The JSON shapes that cross the line. |
| [internal/client](internal/client) | The HTTP client that every command and node uses. |
| [internal/node](internal/node) | One machine's loop: ask, start, report. |
| [internal/agent](internal/agent) | The contract for whatever runs an agent. |
| [internal/t3](internal/t3) | The provider there is today: T3 Code, through the `t3` command. |
| [internal/claudecode](internal/claudecode) | The rules file that keeps an agent from publishing on its own. |
| [internal/permit](internal/permit) | What an agent may publish: `prepare`, `push` and `pr`. |
| [internal/repo](internal/repo) | git and gh. |
| [internal/scan](internal/scan) | Turns an osv-scanner report into findings. |
| [internal/cmdx](internal/cmdx) | The only place that starts another program. Every program gets a time limit, and a test fails if any other package starts one. |
| [internal/launchd](internal/launchd) | launchd jobs. No command uses it right now; it is kept for installing flume as a service. |

## Contracts

Each outside thing sits behind a small contract, so it can be replaced without touching the rules.

| Contract | Defined in | Filled by today |
|---|---|---|
| `gateway.Store` | gateway | SQLite, in `store` |
| `agent.Provider` | agent | T3 Code, in `t3` |
| `agent.Rules` | agent | Claude Code's settings file, in `claudecode` |
| `permit.Checkout`, `permit.Forge` | permit | git and gh, in `repo` |
| `permit.Ledger`, `node.Server` | permit, node | the HTTP client, in `client` |
| unit lines on stdin | `flume submit` | `flume scan`, or any program that prints them |

## Decided, and not built yet

| What | The decision |
|---|---|
| Scans | The server's clock drives them. Today `flume scan <project> \| flume submit` is run by hand. |
| Alerts | A contract. A vessel instance names its alert channels; a GitHub issue is the first one. Today a dead letter only shows in the server's log and in `flume queue -all`. |
| Limits | The lowest limit wins: a node's ceiling (built), the machine's load and memory, the account's allowance, and pull requests waiting for a human. |
| Routing | A unit says what it needs and a node says what it offers, so work that needs a Mac goes to the Mac. |
| Leases | A node renews its units. When it goes away, they return to the queue. Today they stay with it. |
| By hand | `-now` puts a unit first, and it can pause a lighter one to make room. |
| Another machine | Tokens for nodes, installing flume as a service, and a container for the server. Today the server asks nobody who they are and listens on its own machine only. |
| The store | SQLite first. Postgres can go behind `gateway.Store` later. |
