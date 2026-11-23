---
name: delta-flume
description: Set up delta-flume vessels in a project with the user. Survey the project, propose vessel instances on an HTML page, ask in two rounds, write the .delta-flume/vessels/ files, and after the merge create each instance's scheduled task. Use when the user wants to add, set up, plan, or schedule vessels or maintenance agents for a project.
---

# delta-flume

Set up delta-flume vessels in a project, new to vessels or not, together with the user.

## Find the framework

Resolve the repository containing this skill by following its installed symlink. The framework is `frameworks/delta-flume` in that repository. If that folder is missing, the installation predates the framework: tell the user to run `agents update`, and until then read it from https://github.com/jonaswahringer/delta-flume.

## Set up

Follow `setup.md` in the framework from start to end. It is the source of truth; this skill only names the tools for its steps.

- Page: build and share it with the html-communication skill when it is installed. Otherwise write one self-contained HTML file and say which machine it is on.
- Rounds: ask with the user-input tool, one decision per question, recommended answer first.
- Hand off: use the commit skill when it is installed, and ask before every commit and push.
- Schedule: in T3 Code, a trigger is a scheduled task in the project's T3 project. List them with `list_scheduled_tasks`. Create one with `schedule_task`, setting `bindToCurrentThread: false` and `freshSession: false` so each run opens its own thread. Update one by its `scheduledTaskId`, sending only the fields that differ. Map Trigger to `schedule` as below, and ask the human to reword any other Trigger. T3 has no monthly schedule. Never call `run_scheduled_task_now` unless the human asks.

  | Trigger | `schedule` |
  |---|---|
  | every day at 05:00 | `{type: "fixed_time", timeOfDay: "05:00"}` |
  | every Monday at 05:00 | `{type: "fixed_time", timeOfDay: "05:00", weekdays: [1]}`, where 0 is Sunday |
  | every 4 weeks | `{type: "interval", everyMs: 2419200000}`, which is 4 × 7 × 86,400,000 |

Run setup on the machine that holds the project, and say where the files were written.
