---
name: proper-commits
description: Write commit messages as terse changelog headlines. Use whenever writing or amending a commit message, or when the user asks to clean up commit messages.
---

# Headline commits

A commit message is a **headline**, not a report. One line that a reader skimming `git log` can act on; a body only when the *cause* is non-obvious and can't be recovered from the diff.

Modeled on `pingdotgg/t3code`'s log — study these before writing:

```
fix(server): self-update no longer rolls itself back on restart
feat(cli): `npx t3 pair` - generate QR code from a running server
fix(web): pasting a huge screenshot now compresses it instead of erroring
perf(server): merge separate staged/unstaged numstat calls into single diff HEAD --numstat
docs: seed worktrees with a copy of real userdata instead of banning it
fix(connect): reboots no longer strand the relay link, 403s now say why
build(desktop): reduce installed app size by ~300MB
```

## The subject line

- Format: `type(scope): headline` — types: `feat` `fix` `perf` `refactor` `docs` `style` `chore` `build` `ci` `test`. Scope is the affected surface (`web`, `server`, `mobile`, a package name); omit when repo-wide.
- The headline states the **observable outcome** — what a user or developer experiences after this commit, not what you did to the code. "self-update no longer rolls itself back" beats "fix rollback logic in updater". Present tense or "X now Y" / "X no longer Y" phrasing both work.
- Be concrete: name the command, the number, the platform ("~300MB", "⌘P", "iOS"). Vague nouns ("improve handling", "update logic", "various fixes") are slop.
- One line, lowercase after the colon, no trailing period, aim under ~72 chars.

## The body

Default is **no body**. Add one only when the diff can't explain *why* — a non-obvious root cause, a broken assumption, a constraint. Then: a short plain-prose paragraph stating cause → consequence, like:

> actions/checkout implements sparse-checkout with --filter=blob:none, so the runner repo is a partial clone missing the .repos/ blobs. eas-cli archives the project via `git clone --depth 1 file://<workspace>`, which upload-pack cannot serve from a partial clone and exits 128.

Never in the body: bullet lists restating the diff, "This commit…" / "This change…" openers, test plans, headers like "Summary" or "Changes", emoji, or praise for the change.

## Explicit DON'Ts

- Do not run `git commit` (or any commit command) — return the commit message(s) as plain text only, unless the user explicitly and clearly asks you to commit.
- No `Co-Authored-By: <agent>` trailers — they add no value; strip them even when a harness default would append one.

## Done when

The subject alone tells a log-skimmer what changed for them, every word survives the question "does deleting this lose information?", and any body explains a cause the diff can't show.
