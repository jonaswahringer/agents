# Maintenance vessel

## Purpose

Keep software secure, up to date and working as expected.

## Policy

### Unit

A finding, such as an outdated dependency or a stale doc page. One PR per finding.

Key: `maintenance/<project>/<instance>/<subject>`, for example `maintenance/tiro/dependencies/lodash`. The key leaves out the version, so a newer release updates the open PR instead of opening a second one.

### Triggers

Scheduled trigger, typed. A reliable security advisory feed can become a second typed trigger.

### Weight

Set by a script when the finding is made (d). v0:

| Finding | Weight |
|---|---|
| A malicious package | critical, whatever its rating |
| Security advisory | its CVSS rating: Critical → critical, High → high, Medium → normal, Low → low |
| A dependency or runtime past its end of life, with no more security fixes | high |
| A major version behind | normal |
| A minor or patch version behind | low |
| A stale doc page | low |

### Gateway

Accept: declines a finding whose key already has a PR, open or closed, unless there is new input. A newer release updates an open PR. A rejected PR stays declined until new input arrives, such as a newer release or a security advisory. Start: the schedule starts work without a human, unless the vessel is paused or overloaded. Then the finding waits in the queue. Queue order: by weight, heaviest first.

Estimate: see Retry budget.

### Verify

Cheapest first:

1. Compiler, linter, static analysis, tests and CI (d).
2. Runtime verification (d): the check the project names, for example a smoke test in its AGENTS.md. If the project names none, the PR says so.
3. A review agent (s).

### Retry budget

Size, the expected spend in tokens and time:

- A dependency update: from the lines changed between the old and the new version (d).
- Any other finding, such as a stale doc page: an agent estimates (s).

Over the estimate, a human is notified. Ceiling: 3× the estimate (v0, to be tuned once there is real spend to look at). Over it, or stuck, the finding goes to dead letters.

### Land

A human merges every PR. Nothing is allow-listed yet.

### Output

A PR, with a report in the PR description or separately.

### Record

In the PR: source, reasoning, decision.

### Done

Landed: a human merged the PR. Closed: a human rejected it, with a reason in the PR. Either way the key is remembered.

## Mechanism

The markdown guides the agent loop. Everything else is enforced outside the agent, by the `flume` command and by GitHub.

| Part | Enforced by | Kind |
|---|---|---|
| Trigger | `flume scan <project> \| flume submit` scans a project and hands the findings to Accept. Nothing runs it on a schedule yet; the project's `.delta-flume/vessels/README.md` lists each instance's trigger | d |
| Weight | `flume scan`, when the finding is made | d |
| Accept | `flume submit`: remembers every finding by its key and declines one that brings nothing new | d |
| Start | the flume server: it gives the finding to a node that has the project and has room, unless the instance is paused there (`status` in the project's `.delta-flume/vessels/maintenance/<instance>.md`). Otherwise the finding waits in the queue. A start that fails is tried again after a wait that grows, and after six hours the finding goes to dead letters | d |
| Estimate | a script for dependency updates, an agent for the rest | d, s |
| Agent loop | a T3 Code thread in a git worktree on the finding's branch, guided by this file, the instance file, the project's `.delta-flume/vessels/README.md` and its AGENTS.md. It publishes only through `flume push` and `flume pr` | s |
| Verify | CI, then the project's runtime check, then a review agent | d, s |
| Watcher | compares spend with the estimate; the job's time limit and a token cap enforce the ceiling | d |
| Land | branch protection: a human approval is required | h |
| Record | the PR | d |

The flume server keeps the queue and each finding's state in a SQLite file. The PR stays the record.
