# Furnace

A private backlog for ideas and agent work. The Python 3.9+ standard-library
tracker records claims, checkpoints, results and review handoffs. T3 Code handles
scheduling, usage and continuation.

## Commands

The installer links `furnace` into `~/.local/bin/`. `agents update` repairs the
link without selecting the optional Furnace skill or starting work.

```sh
furnace add 'Explore a simpler reconnect flow'
furnace add 'Repair reconnect after sleep' --repo /absolute/project \
  --done-when 'Reconnect works and its regression check passes.' --ready
furnace list
furnace show ITEM_ID
furnace claim ITEM_ID --owner 'exact T3 thread reference'
furnace report
```

Run `python3 tools/furnace/furnace.py` from a checkout if the command is not
installed. See [skill operations](../../skills/jonasw/furnace/operations.md) for
checkpoint fields and recovery.

## State and ownership

State lives in `$XDG_STATE_HOME/agents/furnace` or
`~/.local/state/agents/furnace`, outside Git. Use `--state-dir /private/path`
before a command to select another location. Do not share a live SQLite file
between machines. The Mac mini's records stay on the Mac mini.

Claims are atomic and allow one active item per repository. Each checkpoint
requires its owned run ID. Work waiting for review stays `review`; a successful
agent exit alone is not completion. Existing records and session metadata are
preserved.

## Execution

Use the `furnace` skill to work ready items through T3 Code. The tracker itself
starts no agent, timer or service. The retired workflow and auto-resume
implementations are on `archive/t3-runtime-tools`.

Old continuation links remain visible in reports. Before releasing one, inspect
its exact session and queue. `clear-resume ITEM_ID --run RUN_ID --reviewed`
reads the legacy queue without launching it and refuses pending or dispatching
jobs. Cancel such jobs explicitly through the archived tooling before clearing.
No new continuation can be armed through Furnace.

## Checks

```sh
python3 -m unittest discover -s tools/furnace -p 'test_*.py' -v
/bin/bash tests/test_furnace_install.sh
```

Tests use temporary homes and make no provider or GitHub calls.
