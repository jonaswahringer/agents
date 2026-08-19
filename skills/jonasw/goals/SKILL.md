---
name: goals
description: >-
  Shape aspirations into deliverable goals with binary done-when, then track
  them under a user-chosen goals root. Use when the user invokes /goals, wants
  to set or manage goals, names an aspiration ("learn X", "become a Y",
  "contribute to open source"), or needs help picking what to build next.
---

# Goals

**Aspirations** are the outer rim. **Goals** are **deliverables** with a binary **done when**. Arrows chain goal→goal (**From**); the rim is the aspiration folder. Steer by the deliverable; name the aspiration as backdrop.

**Goals root** = the directory this skill fills (aspirations, goals, and the root marker). There is no separate pointer elsewhere — a root is a folder that contains `_root.md`.

Layout and file shapes: [template.md](template.md). Classification, dig prompts, manage moves: [reference.md](reference.md). Framing: Theo Browne, [Your Goals Kinda Suck](https://www.youtube.com/watch?v=rzwaaWH0ksk).

Cap **active** goals at three; one is better.

## Steps

### 0. Resolve the goals root

Find the root in this order; stop at the first hit:

1. **Already known this conversation** — reuse that absolute path.
2. **Walk up from the workspace cwd** — if a parent (or cwd) contains `_root.md`, that directory is the root.
3. **Ask** (one question): path to an existing goals folder, or create a new one (offer `~/goals` only as a suggestion). Expand `~`. On create, `mkdir -p` the path. Write `_root.md` per [template.md](template.md) if missing. If they named an existing folder that is not yet a root, confirm once, then write `_root.md`.

**Relocate:** ask for the new path, move the whole tree (including `_root.md`) if they want the files to follow, ensure `_root.md` exists at the new root. Nothing outside that tree is updated.

**Done when:** an absolute path to a directory that contains `_root.md` is known, and every later step uses only that path.

### 1. Classify

| Label | Next |
|---|---|
| **aspiration** | Dig (step 2). Do not invent a goal file yet; an aspiration folder may be created when a goal lands under it. |
| **vague** | Dig one level to a specific deliverable. |
| **deliverable** | Confirm done-when → Write (step 3). |
| **manage** | Manage (step 4). |

**Done when:** the ask has exactly one label and the matching next step is chosen.

### 2. Dig

Ask **one question at a time** until the answer is a deliverable with a binary done-when (tests and prompts in [reference.md](reference.md)). Prefer a problem they already have; a specific clone still beats an aspiration.

If cash or status is the only driver and nothing to build excites them, say plainly this skill fits passion-fed deliverables and point them elsewhere for a pure cash path.

**Done when:** a candidate deliverable + binary done-when exists, its aspiration folder is clear, and **From** is set (prior goal refs, or none if this is the first arrow), or the user stops digging.

### 3. Write

Under the goals root, ensure `<aspiration-slug>/_aspiration.md` exists, then write `<aspiration-slug>/<goal-slug>.md` per [template.md](template.md). Goal files list aspiration refs, **From** (prior goals), **done when**, and one small next action in Notes. Status stays `active` until Manage moves it.

**Done when:** aspiration file and goal file are on disk under the resolved root; **From** and Notes are filled as required.

### 4. Manage

1. Resolve root (step 0), then scan aspiration folders for goal files (skip `_root.md` and `_aspiration.md`; include `done/` and `dropped/` when listing history).
2. Show each **active** goal: title, deliverable, done-when, aspiration(s), **From**, next action.
3. Offer only moves that apply: **add**, **narrow**, **pivot**, **complete**, **drop**, **relocate root** — rules in [reference.md](reference.md).

**Done when:** the tree reflects the chosen move (or unchanged if list-only), and the user has one clear next action.

## Scope

This skill **shapes and tracks**. Build the deliverable only when asked; then the written done-when is the contract.
