# New vessel instance

How to set up a vessel in a project. An agent works through it with a human, and a human can follow it alone.

Result: `<project>/vessels/<name>.md`, and an AGENTS.md that holds everything the vessel needs to run.

## Before you start

You need the project's path and the vessel type: `vessels/<name>.md` in this framework, not in the project.

Stop if:

- the type file doesn't exist. Create the type first from [templates/vessel.md](templates/vessel.md).
- `<project>/vessels/<name>.md` already exists. Ask whether to update it instead.

## 1. Read

1. The type file. Its Policy and Mechanism say what the vessel needs from a project.
2. [templates/instance.md](templates/instance.md).
3. The project's AGENTS.md, and every file that copies or links it, such as CLAUDE.md.
4. Whatever confirms AGENTS.md: the package manifest, Makefile, CI config.

Done when you can name every command, check and secret the type's Mechanism needs.

## 2. Check AGENTS.md

Compare AGENTS.md with what the type needs. Write one finding per issue, with its location and a proposed fix.

**Gaps**: what the vessel needs and AGENTS.md lacks.

| Need | Check |
|---|---|
| Build and test commands | They run without prompts, from a clean clone. |
| Runtime check | One named check proves the app works, beyond the tests. |
| Env vars and secrets | Each is named, with where it comes from. |
| Off-limits | Generated, vendored, or externally owned files are named. |

**Complexity**: what costs reading time without changing what an agent does.

| Kind | Example |
|---|---|
| Generic | "Write clean code": rules any agent follows anyway. |
| Duplicate | The same rule twice, or AGENTS.md and CLAUDE.md drifting apart. |
| Stale | A command, script or path that no longer exists. |

AGENTS.md is shared. Don't cut what humans or other vessels need.

Back each finding with the repo, for example the script exists in the manifest. Ask before running anything that needs network or secrets, or that changes state.

If AGENTS.md contains a secret value, stop and tell the user at once.

Done when every finding points to a line in AGENTS.md or the repo.

## 3. Ask

Ask in one round, with the user-input tool if there is one. Ask:

1. Each AGENTS.md finding: accept, change, or drop.
2. The questions below, except those the files you read already answer, and those about a part the type file doesn't have.

| Decides | Question |
|---|---|
| Here | What would go wrong in this project if the vessel never ran? |
| Scope | Where would a correct change still hurt, because the code is fragile, owned elsewhere, or about to be rewritten? |
| Overrides | What would you reject even with every check green? |
| Weight | Which part, if it broke, is critical rather than high? |
| Runtime check | What do you do by hand to convince yourself a change works? |
| Secrets | Which credential must never reach an agent, even if the work needs it? |
| Status | Start active, or paused until you've seen a first unit? |

Every question names the line it decides and offers a recommended answer drawn from what you read. Ask for judgment, never for a fact you could look up.

Done when every instance section and every finding has an answer.

## 4. Write

1. Copy [templates/instance.md](templates/instance.md) to `<project>/vessels/<name>.md`, fill it from the answers, and remove the comments.
2. Apply the approved AGENTS.md changes and nothing else. Keep the file's existing structure and voice.

## 5. Check

- `vessel` names an existing type, and `status` is `active` or `paused`.
- Every command, script and path in AGENTS.md exists.
- Neither file holds a secret value.
- Each override changes policy that exists in the type file.

Report what passed, what failed, and what you couldn't check.

## 6. Hand off

Show the diff. Ask before committing, and follow the project's commit conventions.
