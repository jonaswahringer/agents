# Set up vessels

How to add vessels to a project, whether it runs none yet or already has some. An agent does the work and asks a human at two points; a human can follow it alone.

Result: one `<project>/.delta-flume/vessels/<type>/<instance>.md` per instance the human picks, a `.delta-flume/vessels/README.md` that lists them, and the AGENTS.md changes the human approved. After the merge, each instance gets a trigger in the runtime that runs it.

```
Survey ─► Page ─► Round 1: pick ─► Check the how ─► Round 2: decide ─► Write ─► Check ─► Hand off ─► merge ─► Schedule
```

## Before you start

You need the project's path. Read in this framework:

1. The [Vessels](README.md#vessels) table and every type file in [vessels/](vessels/). Only a type with a file can get instances.
2. The split and naming rules in [In a project](README.md#in-a-project).
3. [templates/instance.md](templates/instance.md) and [templates/vessels-readme.md](templates/vessels-readme.md).

## 1. Survey

Read the project without asking or changing anything:

1. AGENTS.md, and every file that copies or links it, such as CLAUDE.md.
2. `.delta-flume/vessels/README.md` and every instance in `.delta-flume/vessels/`, if any.
3. Whatever confirms AGENTS.md: package manifests, Makefile, CI config, scripts.
4. The parts of the project: source folders, packages, docs, copied or vendored code, generated files, and anything another person or tool maintains.

Ask before running anything that needs network or secrets, or that changes state.

Then list the candidate instances. For each type with a file, split the project by the rules in In a project, and leave out what an existing instance already covers. Each candidate has a type, a name, a scope, a trigger, where it runs, and one line on what would go wrong in this project without it. Recommend the candidates the files back. Note work that fits a planned type, such as Testing, apart from the candidates: it gets an instance only once its type file exists.

Done when every part of the project sits in a candidate's scope, an existing instance's scope, or a list of parts no vessel covers, with the reason.

## 2. Page

Write the survey as one HTML page, and give the human a link they can open on the device they read on.

The page shows, in this order:

1. The recommendation: which candidates to start, and whether active or paused.
2. The candidates: type, name, scope, trigger, runs on, why, and whether you recommend it.
3. The parts of the project, and which candidate or existing instance covers each, or why none does.
4. The existing instances, which setup leaves unchanged.
5. Work for planned types.

Then ask Round 1, with the user-input tool if there is one: which candidates become instances, several at once, and for each, active or paused. Put the recommended answer first.

Done when the human has picked at least one instance, or decided to stop.

## 3. Check the how

Compare AGENTS.md and `.delta-flume/vessels/README.md` with what the picked instances' types need. Write one finding per issue, with its location and a proposed fix.

**Gaps**: what an instance needs and neither file has.

| Need | Check | Goes in |
|---|---|---|
| Build and test commands | They run without prompts, from a clean clone. | AGENTS.md |
| Runtime check | One named check proves the app works, beyond the tests. | AGENTS.md |
| Off-limits | Generated, vendored, or externally owned files are named. | AGENTS.md |
| Env vars and secrets | Each is named, with where it comes from. | AGENTS.md if every agent needs it, otherwise `.delta-flume/vessels/README.md` |
| Instance procedures | Commands and steps only this instance uses, such as a sync script and its rules. | `.delta-flume/vessels/README.md` |

**Complexity**: what costs reading time without changing what an agent does.

| Kind | Example |
|---|---|
| Generic | "Write clean code": rules any agent follows anyway. |
| Duplicate | The same rule twice, or AGENTS.md and CLAUDE.md drifting apart. |
| Stale | A command, script or path that no longer exists. |
| Misplaced | Vessel-only steps in AGENTS.md, or what every agent needs in `.delta-flume/vessels/README.md`. |

AGENTS.md is shared. Don't cut what humans or other vessels need.

Back each finding with the repo, for example the script exists in the manifest.

If AGENTS.md or `.delta-flume/vessels/README.md` contains a secret value, stop and tell the user at once.

Done when every finding points to a line in AGENTS.md, `.delta-flume/vessels/README.md` or the repo.

## 4. Decide

Add the findings and each picked instance's open questions to the page, each with a recommended answer. Then ask Round 2, with the user-input tool if there is one:

1. Each finding: accept, change, or drop.
2. For each picked instance, the questions below, except those the files you read already answer, and those about a part its type file doesn't have.

| Decides | Question |
|---|---|
| Here | What would go wrong in this project if the instance never ran? |
| Scope | Where would a correct change still hurt, because the code is fragile, owned elsewhere, or about to be rewritten? |
| Overrides | What would you reject even with every check green? |
| Weight | Which part, if it broke, is critical rather than high? |
| Runtime check | What do you do by hand to convince yourself a change works? |
| Secrets | Which credential must never reach an agent, even if the work needs it? |

Ask one instance's questions together. Every question names the line it decides and puts the recommended answer first. Ask for judgment, never for a fact you could look up.

Done when every instance section and every finding has an answer.

## 5. Write

1. For each picked instance, copy [templates/instance.md](templates/instance.md) to `<project>/.delta-flume/vessels/<type>/<instance>.md`, fill it from the answers, and remove the comments.
2. If `<project>/.delta-flume/vessels/README.md` doesn't exist, copy [templates/vessels-readme.md](templates/vessels-readme.md) there, replace its placeholders and remove the comments. Add each new instance to Instances, with its trigger and where it runs.
3. Apply the approved changes to AGENTS.md and `.delta-flume/vessels/README.md` and nothing else. Keep each file's existing structure and voice.

## 6. Check

- Each `vessel` names an existing type and matches its instance's folder, and each `status` is `active` or `paused`.
- No two instances of one type claim the same subject.
- `.delta-flume/vessels/README.md` lists every instance with its trigger and where it runs, and no `<placeholder>` is left. `{type}` and `{instance}` in Run stay.
- Every Trigger is a schedule that the runtime in Runs on takes as written.
- Every command, script and path in AGENTS.md and `.delta-flume/vessels/README.md` exists.
- Neither file holds a secret value.
- Each override changes policy that exists in its type file.

Report what passed, what failed, and what you couldn't check.

## 7. Hand off

Show the diff. Ask before committing, and follow the project's commit conventions. Schedule waits until the change is merged.

## 8. Schedule

After the merge, give each instance a trigger in the runtime its Runs on names. Not before: the prompt reads the files from the main branch.

1. Read Instances and Run in `.delta-flume/vessels/README.md` on the main branch.
2. List the triggers that already exist in that runtime. An instance's trigger is titled `<project> vessel <type>/<instance>`.
3. Plan one action per instance: create, update what differs, or nothing. Take every field from the files: that title, the prompt in Run with `{type}` and `{instance}` filled in, and the schedule in Trigger. Never write or adjust a field yourself. If the runtime can't take a Trigger as written, ask the human to change the row first.
4. Turn every trigger on, even a paused instance's: `status` stays the only switch, and a paused run stops at once.
5. List the triggers that run a vessel but match no instance, such as one made by hand before setup. For each, ask: take it over for an instance, keep it, or delete it.
6. Ask about each instance's action, showing its fields. Apply only what the human approved.
7. List the triggers again, compare each with the plan, and report each one's next run.

Run this step again whenever Instances or Run changes. It changes only what differs, and so also undoes edits made by hand in the runtime.

If the runtime has no tool to create triggers, give the human each trigger's fields to enter.
