---
name: tidy
description: Find disk space you can safely free, starting with stale git worktrees across projects or under one folder, then free what you approve.
disable-model-invocation: true
---

Run a **mark-and-sweep** over one or more **sweeps**. Mark everything that something still holds; whatever is left is a candidate. Until the user approves a list, the whole run is a **dry run**.

Each candidate has a **restore cost**, meaning what the user pays to get it back:

| Class | Restore cost | Example |
| --- | --- | --- |
| **garbage** | Nothing. Git or the tool recreates it exactly. | A clean worktree whose branch is merged |
| **regenerable** | A reinstall, rebuild, or download. Name the command and a rough time. | `node_modules` (`bun install`) |
| **kept** | Data would be lost, or the item is in use. It is never a candidate. | Uncommitted edits, a running dev server |

## Sweeps

Each sweep file defines its inventory, marks, and sweep commands.

- [worktrees.md](worktrees.md): git worktrees across projects or under one folder

## Steps

1. **Scope.** Use the sweeps and folders the user named. If they named none, run every sweep with its default roots. Done when the sweeps and roots are stated in one line.
2. **Inventory.** Follow each sweep's inventory step. Done when every item under every root has a row with its size.
3. **Mark.** Apply each sweep's marks and label every row `kept: <mark>`, `garbage`, or `regenerable: <restore command>`. Done when no row is unlabeled.
4. **Report.** Group candidates by sweep and list them largest first, with totals for garbage and for regenerable. Show the kept rows grouped by mark so the user can see what was protected. Use an HTML page past about 15 rows.
5. **Approve.** Ask with the user-input tool, separately for garbage and for regenerable: all, pick, or none. Done when you hold an explicit list.
6. **Sweep.** Use each sweep's command for each approved item. When a command refuses, skip the item and record why. Use `rm -rf` only on exact paths the user approved, and only where the sweep file allows it.
7. **Measure.** Report the space freed (`df -k /` before and after), every skipped item with its reason, and the restore command for each item removed.
