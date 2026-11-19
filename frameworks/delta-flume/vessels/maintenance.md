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

The markdown guides the agent loop. Everything else is enforced outside the agent, with GitHub as the boundary for now.

| Part | Enforced by | Kind |
|---|---|---|
| Trigger | a scheduled job per instance (cron or a GitHub Action) | d |
| Weight | a script, when the finding is made | d |
| Accept | a script: `gh pr list` searches for the key, open or closed | d |
| Start | a script: is the instance paused (`status` in the project's `vessels/maintenance/<instance>.md`) or overloaded? If so, the finding waits in the queue | d |
| Estimate | a script for dependency updates, an agent for the rest | d, s |
| Agent loop | an agent CLI in a git worktree, guided by this file, the instance file, the project's `vessels/README.md` and its AGENTS.md | s |
| Verify | CI, then the project's runtime check, then a review agent | d, s |
| Watcher | compares spend with the estimate; the job's time limit and a token cap enforce the ceiling | d |
| Land | branch protection: a human approval is required | h |
| Record | the PR | d |

A database can be added later, once the vessel needs state that GitHub can't hold.
