---
vessel: maintenance
status: paused
---

# Docs maintenance vessel in agents

## Here

Keeps the docs true to the code: every path, command, flag and link they name exists and works as described. Without it, docs keep pointing to moved paths after refactors.

## Scope

Covers `README.md`, `AGENTS.md`, `setup/README.md`, `tools/*/README.md` and `docs/`.

Leaves alone:

- `frameworks/delta-flume`, which is designed by hand and published to its own repo on every push to `main`.
- `IDEAS.md`, which is a backlog.
- Skill files and `.delta-flume/`.
- Minimum runtime versions; dependencies keeps them.

## Overrides

None.
