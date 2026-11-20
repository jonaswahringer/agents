# Vessels in agents

This project runs [delta-flume](https://github.com/jonaswahringer/delta-flume) vessels. Each file in a type folder is one instance; its front matter says whether it is active or paused. This file holds what only vessels need to run. What every agent needs is in [AGENTS.md](../../AGENTS.md).

## Instances

| Instance | Trigger | Runs on |
|---|---|---|
| [maintenance/work-smart-not-hard-skill](maintenance/work-smart-not-hard-skill.md) | every Sunday at 05:00 | T3 scheduled task, Mac mini |
| [maintenance/external-skills](maintenance/external-skills.md) | every Monday at 05:00 | T3 scheduled task, Mac mini |
| [maintenance/dependencies](maintenance/dependencies.md) | every Tuesday at 05:00 | T3 scheduled task, Mac mini |
| [maintenance/docs](maintenance/docs.md) | every 4 weeks | T3 scheduled task, Mac mini |

## Run

```
Run vessel instance {type}/{instance} in jonaswahringer/agents.
Read from origin/main: .delta-flume/vessels/{type}/{instance}.md,
.delta-flume/vessels/README.md, AGENTS.md and frameworks/delta-flume/vessels/{type}.md.
If its status is paused, stop and report that. Otherwise follow them. Never merge.
```

## Secrets

| Name | Comes from | Used by |
|---|---|---|
| GitHub login | `gh auth` on the Mac mini | every instance, to push branches and open or update PRs |
| `~/.config/agents/model-routing.json` | a private file on the Mac mini, outside the repo | work-smart-not-hard-skill, for subscription preferences |

Never give an agent: `POSTPLAN_BOOTSTRAP_API_KEY` from `tools/comms/.env` or `tools/comms/com.wahringer.comms.plist` (the tests set their own key), or the provider logins that a live `tools/usage/usage` reads, from the login keychain and `~/.claude/.credentials.json`.

## Every instance

- Each instance has one T3 scheduled task, made from Instances and Run by step 8 of [setup.md](../../frameworks/delta-flume/setup.md#8-schedule). Change a task there, not in T3; the next Schedule run undoes edits made in T3.
- `status` in the instance file is the only switch. Disabling a T3 task is an emergency brake, not a pause.
- Work in a fresh worktree from `origin/main`. The Mac mini's main checkout runs comms, so never work there and never run `git clean -xd` in it.
- A run may commit, push a branch, and open or update a PR without asking, and links each PR to its T3 thread. It never merges, tags, or pushes to `main`. This replaces the ask-before-commit rule for vessel runs only.
- Checks: `./tests/test.sh` and `./tests/all.sh`. Their prerequisites, and the copied packages they skip, are in [setup/README.md](../../setup/README.md#checks). No repository-wide runtime check exists; say so in every PR.
- Copied folders change only through external-skills, or as intentional local edits. `frameworks/delta-flume` is published to its own repo on every push to `main`.
- PR description: one sentence with the result, a before/after table of at most five changes, the main review decision, and the checks run, failed or skipped. Put evidence and secondary changes in `<details>`. Link an HTML report only after it is published, and say when it needs Tailscale.

## maintenance/work-smart-not-hard-skill

Install merged updates first:

1. Find PRs merged into `main` that changed `skills/jonasw/work-smart-not-hard`.
2. Compare the installed, selected skill with `main`, every file and link. Use `agents source` and `agents skills source` to find them.
3. If they differ, run `agents update`. Keep the profile and selections. Never use `--force`, install a PR branch, or change selections. If the installer source is a Git checkout that needs updating, report that instead of switching its branch.
4. Verify again, then record the checked `main` commit and installed PRs in `~/.local/state/agents/model-skill-maintenance.json`. Record only after verification. If installation fails, report it and stop.
5. If the skill isn't selected, report it. Updating the Mac mini doesn't update the MacBook or iPhone.

Then research:

- Official [Artificial Analysis](https://artificialanalysis.ai) pages for releases, intelligence, task benchmarks, API prices and cost per task. Compare exact versions and reasoning variants. Keep broad intelligence apart from implementation, UI/UX, investigation, review, verification and orchestration. Benchmark cost per task is neither subscription capacity nor real workflow cost.
- [Slopalytics](https://slopalytics.com/) for its cost/intelligence view and Pareto line. Check its freshness, models, effort variants, benchmark version and cost axis, and verify its claims against Artificial Analysis.
- Theo's t3.gg videos may inform practical choices. Cite the video, date and timestamp, and attribute opinions apart from benchmark evidence. Never infer claims from a title or a missing transcript.

Keep the skill's urgent rate-limit fallbacks:

- Tell temporary throttling, model-specific limits, shared session limits and weekly exhaustion apart. Use the provider's reported reset. Switching apps or models doesn't reset a shared allowance.
- Prefer an available approved model in the same role. Use Luna or Sol at low for lightweight inventory when Haiku 5.5 can't run. A different orchestrator doesn't unblock a child model.
- Crossing Claude authorship or GPT review needs an explicit, narrowly scoped emergency exception.
- Never enable paid overflow, buy credits, upgrade a plan, buy a reset, or switch to API billing.
- When work can't go on, checkpoint findings, pending checks and reset times. Never report an incomplete check as passed.
- Fallbacks apply only when the user marks work time-sensitive or its deadline comes before the reset.

Then propose: continue the open refresh PR and its feedback if there is one, otherwise branch `skills/work-smart-not-hard-refresh-YYYY-MM-DD`. If nothing needs changing, say so and open no PR. The details hold the full model table, benchmark variants, sources and runtime assumptions.

## maintenance/external-skills

1. Sync one folder: `./tools/agents-cli/agents-cli skills sync <folder> --dry-run`, then without `--dry-run`, then `git diff -- skills/<folder>`. The command needs network, refuses the installed snapshot under `~/.local/share/agents`, keeps local edits, and stops on overlapping changes. Format and conflicts: [docs/skills-sync.md](../../docs/skills-sync.md).
2. Import a new upstream skill with `--add <name>`, once per skill. Installed selections stay unchanged.
3. Run the copied package checks that `./tests/all.sh` skips:
   - `skills/pstack/poteto-mode/scripts`: `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`.
   - `skills/pstack/statechart/scripts`: `npm install --include=dev --package-lock=false`, then `npm test`, on Node 22.18 through 22.x or 23.6+. TLC tests need `TLA2TOOLS` set to the pinned `tla2tools.jar` named in `run.ts`, and Java 11+ on `PATH` or in `JAVA`. Report them skipped when those are missing.

## maintenance/dependencies

1. Update `tools/comms` with Bun, and commit `package.json` and `bun.lock` together. `bun install --frozen-lockfile` must pass afterwards.
2. Pin actions by commit SHA with the version in a comment, as `publish-delta-flume.yml` does now.
3. Run `./tests/all.sh`. Never restart, reload or stop the comms service; an update takes effect when a human restarts it after the merge.

## maintenance/docs

Check every path, command, flag and link in scope against `origin/main`. Run a command only when it is read-only and needs no network or secrets, such as `--help`.
