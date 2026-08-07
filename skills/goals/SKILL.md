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

**Goals root** (tree of aspirations and goals): chosen by the user.  
**Root pointer** (how this skill finds that tree every run): `~/.config/agents/goals-root` — one absolute path, nothing else.

Layout and file shapes: [template.md](template.md). Classification, dig prompts, manage moves: [reference.md](reference.md). Framing: Theo Browne, [Your Goals Kinda Suck](https://www.youtube.com/watch?v=rzwaaWH0ksk).

Cap **active** goals at three; one is better.

## Steps

### 0. Resolve the goals root

1. Read `~/.config/agents/goals-root` if it exists.
2. If the file is missing, empty, or the path is not an existing directory → **ask** (one question): use an existing folder, or create a new one (suggest `~/goals` only as a default option, not a silent choice). Expand `~`, create the directory when they pick "create", then write the absolute path as the sole line of `~/.config/agents/goals-root` (create `~/.config/agents` if needed).
3. If they want to **move** the root later, ask for the new path, move or leave the old tree as they say, then rewrite the pointer.

**Done when:** `goals-root` points at an existing directory, and every later step uses only that path.

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

1. Resolve root (step 0), then scan aspiration folders for goal files (skip `_aspiration.md`; include `done/` and `dropped/` when listing history).
2. Show each **active** goal: title, deliverable, done-when, aspiration(s), **From**, next action.
3. Offer only moves that apply: **add**, **narrow**, **pivot**, **complete**, **drop**, **relocate root** — rules in [reference.md](reference.md).

**Done when:** the tree reflects the chosen move (or unchanged if list-only), and the user has one clear next action.

## Scope

This skill **shapes and tracks**. Build the deliverable only when asked; then the written done-when is the contract.
