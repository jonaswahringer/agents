# Worktrees sweep

`git worktree remove` keeps the branch, so committed work outlives the checkout. It refuses when tracked changes or untracked files remain, but it deletes git-ignored files such as `.env` without asking, and removing a checkout in use breaks whatever runs there. The marks guard those.

## Inventory

Default roots: `~/.t3/worktrees` and `~/Projects`. Run `bash scripts/scan-worktrees.sh --fetch --gh <roots>` from this skill's folder. Pass a folder the user named as the only root. The network calls make a full scan take a few minutes. `--help` explains every column. It prints one row per checkout, with these kinds:

- `main`: a repository's primary checkout. It is always `kept: main`.
- `worktree`: a linked worktree under a root. Apply the marks below.
- `outside`: a worktree of a scanned repository that lives outside the roots or below the search depth. Apply the marks below, and say where it lives.
- `orphan`: its `.git` link points to a repository that no longer exists.
- `gone`: git still lists the worktree, but its directory is missing.
- `unknown`: a folder beside worktrees that is not a checkout, such as screenshots or notes. It is always `kept: unknown`, and the report names it so the user can judge it.

State at the top of the report any repository whose `remote` is `stale` or `skipped`, because its `merged` and `pushed` values may be out of date. Old remote data can hide a merge but never invent one.

## Marks

Check each worktree in this order and record the first mark that holds.

- **In use**: `procs` is above 0, or the path is the current session's checkout.
- **Thread**: a T3 thread that is not settled is bound to it. When the T3 tools are present, list each project's threads with `t3_thread_list` and `settled: false`, then read each one with `t3_thread_read` to get its `worktreePath`.
- **Recent**: `active_days` is below 3.
- **Unsaved**: `dirty` or `ignored` is above 0. Name the `dirty_sample` and `ignored_sample` paths in the report.
- **Open PR**: `pr` is `open`.

An unmarked worktree is **garbage** when `merged` is `yes` or `content`, or `pr` is `merged`. Otherwise it is **parked**: the branch holds unmerged commits, which stay in the branch after removal. A parked worktree is still a candidate, but list it separately so the user can choose, and split it by `pushed`. *Parked, local only* means those commits exist only on this machine. Orphans and gone entries are garbage.

## Sweep

- Worktree: `git -C <repo> worktree remove <path>`, without `--force`.
- Gone entry: `git -C <repo> worktree prune`.
- Orphan: show its top-level contents first, then `rm -rf <path>`.

Restore a worktree with `git -C <repo> worktree add <path> <branch>`. A T3 thread bound to a removed worktree needs this before it can resume.
