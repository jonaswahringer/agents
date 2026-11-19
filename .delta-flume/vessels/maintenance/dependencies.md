---
vessel: maintenance
status: paused
---

# Dependencies maintenance vessel in agents

## Here

Keeps the repository's own third-party packages and documented runtimes on recent, maintained, secure versions. Without it, comms, a live service on the Mac mini, keeps running outdated packages.

## Scope

Covers:

- `tools/comms/package.json` and `tools/comms/bun.lock`.
- The pinned actions in `.github/workflows/`.
- The minimum runtime versions the docs state, such as in `setup/README.md#checks` and `tools/furnace/README.md`. A PR that changes one updates that line.

Leaves alone:

- Packages inside copied skill folders; external-skills keeps them.
- The running comms service, its launchd job and its data.

## Overrides

Reject a change that raises the Python floor above 3.9. The tools must run on the system Python that macOS ships.

Runtime check: none beyond `./tests/all.sh`. Comms is never restarted to test an update, and each PR says so.
