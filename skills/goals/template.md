# Goals tree

Everything below the **goals root** (absolute path in `~/.config/agents/goals-root`):

```text
<goals-root>/
  <aspiration-slug>/
    _aspiration.md           # outer rim — not a deliverable
    <goal-slug>.md           # active deliverable
    done/
      <goal-slug>.md         # finished (done-when met)
    dropped/
      <goal-slug>.md         # honest stop
```

- **Aspiration folder** = the circle (outer rim). Slug: lowercase kebab-case from the aspiration name.
- **Goal file** = a pointed deliverable on an **arrow**. Lives under its primary aspiration; may reference other aspirations by slug.
- **From** = prior goal(s) whose arrows led here (`aspiration-slug/goal-slug`, including `done/` or `dropped/` peers). Empty only for a true first arrow from the rim.
- **Status** = which directory the goal file is in (`active` at folder root, else `done/` or `dropped/`).

## `_aspiration.md`

```markdown
# <Aspiration title>

- **Slug:** <aspiration-slug>
- **Rim:** <one line — the vague outer aim, not a done-when>
- **Notes:** <optional>
```

## Goal file (`<goal-slug>.md`)

```markdown
# <Goal title>

- **Status:** active
- **Deliverable:** <the concrete thing that exists when done>
- **Done when:** <binary check — runnable demo, merged PR, shipped page>
- **Aspirations:** <primary-slug>[, <other-slug>…]
- **From:** <aspiration-slug/goal-slug>[, …]   # prior goals on the path; omit or `—` if first arrow
- **Started:** YYYY-MM-DD
- **Notes:** <pivots, blockers, next bite-sized step>
```

On **complete** or **drop**, move the file into `done/` or `dropped/`, set **Status** to match, and add:

```markdown
- **Ended:** YYYY-MM-DD
- **What happened:** <one or two lines — include useful failures>
```

(For drop, **What happened** is why it was dropped.)
