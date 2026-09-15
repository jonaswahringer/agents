---
name: commit
description: Write commit messages as changelog headlines and open pull requests, asking before each git or GitHub action. Use when committing, writing or amending a commit message, splitting work into commits, or opening, stacking, or updating a pull request.
---

# Headline commits

A commit message is a **headline**: one line a reader skimming `git log` can act on. Modeled on `pingdotgg/t3code`:

```
fix(server): self-update no longer rolls itself back on restart
feat(cli): `npx t3 pair` - generate QR code from a running server
fix(web): pasting a huge screenshot now compresses it instead of erroring
build(desktop): reduce installed app size by ~300MB
```

## Subject

- `type(scope): headline`. Types: `feat` `fix` `perf` `refactor` `docs` `style` `chore` `build` `ci` `test`. Scope is the affected surface; omit when repo-wide.
- State the **observable outcome** ("X now Y", "X no longer Y"), with concrete names and numbers.
- One line, lowercase after the colon, no trailing period, under ~72 chars.

## Body

Add a body only when the diff can't show the cause: a short prose paragraph, cause → consequence.

When a message has both a one-liner and longer text, the one-liner is the subject and the longer text is the body, separated by a blank line. Pass them as `git commit -m "<subject>" -m "<body>"` so git stores them apart. The body holds reasons, not a restated diff, headers, test plans, or emoji.

## Running the commit

Group the changes into one commit per independent change, then take one path:

- **The user's latest message explicitly says to commit:** stage only that commit's files and run `git commit`, with no `Co-Authored-By` trailer. Pushing, tagging, and amending pushed commits each need their own explicit instruction.
- **Otherwise:** leave the tree untouched and end the reply with `Proposed commit: <message>`, one per commit.

For a pull request, read [pull-requests.md](pull-requests.md) first.

## Done when

Each subject alone tells a log-skimmer what changed, each body explains a cause the diff can't, and every commit ran on an explicit instruction from the user.
