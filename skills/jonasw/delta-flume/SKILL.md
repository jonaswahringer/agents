---
name: delta-flume
description: Set up delta-flume vessels in a project with the user. Survey the project, propose vessel instances on an HTML page, ask in two rounds, then write the .delta-flume/vessels/ files. Use when the user wants to add, set up, or plan vessels or maintenance agents for a project.
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

Run setup on the machine that holds the project, and say where the files were written.
