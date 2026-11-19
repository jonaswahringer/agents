---
vessel: maintenance
status: paused
---

# Maintenance vessel in agents

## Here

Keeps the copied skill sets in step with upstream, the packages in `tools/` and in skill scripts on recent, maintained, secure versions, and the docs true to the code. Without it, every machine installs stale skills on `agents update`.

## Scope

Covers the whole repository, including the software packages inside copied skills. Keep intentional local edits when syncing. Import new skills from tracked upstream sets in the maintenance PR; keep installed selections unchanged.

Leaves alone:

- `skills/jonasw/work-smart-not-hard`, which has its own scheduled maintainer.
- Private profile answers, and machine-local state such as the Furnace backlog, workflow history, and comms data.
- Running services, timers and schedules.
- New feature development and redesigns.

## Overrides

Weight: a copied skill set behind upstream is low. Its key is `maintenance/agents/skills/<folder>`, one PR per folder.
