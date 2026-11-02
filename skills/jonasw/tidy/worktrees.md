# Worktrees sweep

`git worktree remove` keeps the branch, so committed work outlives the checkout. The only things this sweep can destroy are uncommitted files and a checkout in use.

## Inventory

Default roots: `~/.t3/worktrees` and `~/Projects`. Run `bash scripts/scan-worktrees.sh --fetch --gh <roots>` from this skill's folder. Pass a folder the user named as the only root. `--help` explains every column. It prints one row per checkout, with these kinds:

- `main`: a repository's primary checkout. It is always `kept: main`.
- `worktree`: a linked worktree. Apply the marks below.
- `orphan`: its `.git` link points to a repository that no longer exists.
- `gone`: git still lists the worktree, but its directory is missing.
- `unknown`: a folder beside worktrees that is not a checkout, such as screenshots or notes. It is always `kept: unknown`, and the report names it so the user can judge it.

## Marks

Check each worktree in this order and record the first mark that holds.

- **In use**: `procs` is above 0, or the path is the current session's checkout.
- **Thread**: a T3 thread that is not settled is bound to it. When the T3 tools are present, list each project's threads with `t3_thread_list` and `settled: false`, then read each one with `t3_thread_read` to get its `worktreePath`.
- **Unsaved**: `dirty` is above 0. Name the `dirty_sample` paths in the report.
- **Open PR**: `pr` is `open`.

An unmarked worktree is **garbage** when `merged` is `yes` or `pr` is `merged`. It is **parked** when the branch holds unmerged commits. A parked worktree is still garbage, because the commits stay in the branch after removal, but list it separately so the user can choose. Orphans and gone entries are garbage.

## Sweep

- Worktree: `git -C <repo> worktree remove <path>`, without `--force`.
- Gone entry: `git -C <repo> worktree prune`.
- Orphan: show its top-level contents first, then `rm -rf <path>`.

Restore a worktree with `git -C <repo> worktree add <path> <branch>`. A T3 thread bound to a removed worktree needs this before it can resume.
