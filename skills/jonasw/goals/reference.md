# Goals reference

## Aspiration vs deliverable

| Aspiration (folder / rim) | Deliverable (goal file) |
|---|---|
| Become a software engineer | Ship a Twitch-clone UI and demo it in an interview |
| Learn React | Build an Outriders drop-rate calculator as a React web app |
| Contribute to open source | Land a PR fixing outdated Deno websocket docs |
| Improve test coverage | Add regression tests for the three bugs that shipped last week |

**Aspiration test:** no clear *when succeeded* → still an aspiration. "I want to be… / learn… / get better at…" are feelings, not finish lines.

**Deliverable test:** there is a repo, PR, running app, or merged fix, and reasonable people agree done vs not.

## Dig prompts

Shrink toward something they can ship and care about. One at a time:

1. Is success a built thing, a job outcome, or something else? (Paths diverge.)
2. What product, tool, or problem are you drawn to right now?
3. What would you demo or merge when this is done?
4. Which aspiration does this serve — existing folder slug, or a new rim to name?
5. Which existing goal(s) led here (**From**), if any — or is this the first arrow from the rim?
6. Is there a tutorial, codebase, or bug in something you already use that gets you there faster?

**Open source path:** use something → hit a real problem (docs typo, bug, unclear example) → fix *that*. Contributions that stick come from interest in the project, not from shopping beginner-friendly tags.

## Manage moves

- **Narrow** — same file; sharpen deliverable / done-when (keep **From**).
- **Pivot** — new goal file from what the work revealed (may change aspiration folder); set **From** to the old goal (`aspiration-slug/goal-slug`); mark the old one dropped with why. Pivots are progress (Twitch clone → "get WebRTC video working" can stay under `become-an-engineer` even if `learn-react` slipped).
- **Complete** — done-when met; move file to `done/`, set Status + Ended + What happened. Later goals may still **From** it.
- **Drop** — honest stop; move to `dropped/` with why. A dropped attempt beats a fake finish.
- **Add** — only if active goals across the tree are under the cap; otherwise cut or complete one first.
- **Relocate root** — move the tree to a new path (keep `_root.md` at the new root). No files outside the tree are involved.

Every manage turn leaves **one** small next action on an active goal (open the tutorial, scaffold the app, reproduce the bug).
