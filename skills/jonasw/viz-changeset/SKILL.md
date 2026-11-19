---
name: viz-changeset
description: Map a changeset in-thread as one page, with lines of code by area, before and after, and gaps filled, saved as HTML and PNG. Use when the user says "viz changeset" or "visualize changes", or asks to see what a branch, PR, or thread changed.
---

# Viz changeset

Visualize the changes in-thread, high-level. Pick the form that shows this changeset best, and cover:

- **Lines by area.** `scripts/loc.sh [-d depth] [base]` prints added and removed lines per folder, uncommitted work included.
- **Before and after.** How it worked before, and how it works now.
- **Gaps filled.** Give each one its evidence. Mark anything not done or unverified as open.

Start from [template.html](template.html) or replace its body. Keep `<main id="viz">`, the toolbar, and the script, which handle Copy and Save for HTML and PNG.

Save the page to the scratchpad (else `$TMPDIR`), render it with `scripts/png.sh <page.html>`, show it in-thread (T3: `html_preview`, then `html_render`; else embed the PNG), and give both paths.
