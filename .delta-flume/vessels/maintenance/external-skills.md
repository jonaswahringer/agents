---
vessel: maintenance
status: paused
---

# External-skills maintenance vessel in agents

## Here

Keeps the copied skill sets in step with upstream, including the packages in their scripts. Without it, every machine installs stale copies on `agents update`.

## Scope

Covers every folder in `skills/` with an `upstream.tsv`, today `skills/mattp`, `skills/pstack` and `skills/tstack`, including the packages inside them. Imports new upstream skills in the maintenance PR without changing installed selections. Keeps intentional local edits.

Leaves alone:

- `skills/jonasw` and any folder without an `upstream.tsv`.
- Installed selections and private profile answers.

## Overrides

Unit: one copied folder behind upstream. Key: `maintenance/agents/external-skills/<folder>`, one PR per folder.

Weight: low, unless the upstream change fixes a security advisory; then the type's advisory row applies. When upstream lags on an advisory or a compatibility break, a local fix in the copied folder is allowed in the same PR.

Reject a sync that drops an intentional local edit.
