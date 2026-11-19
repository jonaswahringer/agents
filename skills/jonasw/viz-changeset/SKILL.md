---
name: viz-changeset
description: Map a changeset in-thread as one page, with lines of code by area, before and after, and gaps filled, saved as HTML and PNG. Use when the user says "viz changeset" or "visualize changes", or asks to see what a branch, PR, or thread changed.
---

# Viz changeset

Draw one high-level map of the change: where the lines went, how the system worked before and after, and which gaps the change filled.

## Steps

1. **Pin the scope.** Default: the current branch against its merge-base with the default branch, plus uncommitted and untracked files, in every repo this thread touched. A PR, range, or commit the user names replaces the default. Done when the scope fits on one line, such as `main…t3/viz-changeset + uncommitted · agents`.
2. **Count lines by area.** In each repo, run this skill's [scripts/loc.sh](scripts/loc.sh):

   ```sh
   scripts/loc.sh [-d depth] [base]   # TSV: area, added, removed, files; total last
   ```

   Choose the depth whose areas a reader recognizes, such as `-d 3` for `skills/<folder>/<name>`. Keep the top 8 areas, fold the rest into `other`, and give `(lockfiles)` and generated files their own row. Done when the area rows add up to the total row.
3. **Trace each claim.** From the diff and the thread, note per area what changed, what the system did before, and what it does now. Give each gap filled its evidence: a test, a command you ran, or a `path:line`. Done when every claim traces to the diff, a command output, or the thread.
4. **Fill the template.** Copy [template.html](template.html) and replace its placeholders, keeping the four sections in order:

   | Section | Shows |
   | --- | --- |
   | Headline | The change in one sentence, the scope, and totals for files, added, removed, and areas |
   | Where the lines went | One bar per area, `width` = that side's lines ÷ the largest area's total, plus a few words on what changed there |
   | Before and after | Short lists of how it worked before and how it works now, or an inline SVG diagram when the change is structural |
   | Gaps filled | Gap, what fills it, and evidence, then a row tagged `open` for each thing not done, skipped, or unverified |

   Style through the template's CSS tokens, or the project's brand tokens when `html-communication` would use a brand file. Keep the toolbar and its script. Done when no placeholder text is left.
5. **Save HTML and PNG.** Write `<repo>-<branch>.html` to the session scratchpad, else `${TMPDIR:-/tmp}/viz-changeset/`. Render the PNG beside it:

   ```sh
   scripts/png.sh <page.html> [out.png] [width]   # exits 3 when no Chrome, Chromium, or Edge
   ```

   Done when both files exist, or you have the reason the PNG is missing.
6. **Show it in the thread.** Render with the host's inline HTML renderer (T3 Code: `html_preview` with the HTML path, then `html_render`); on hosts without one, embed the PNG as a Markdown image. Reply with:
   - the headline sentence
   - absolute paths to the HTML and the PNG, or why the PNG is missing
   - each `open` row, in plain words
   - a note that the page toolbar has Copy HTML, Save HTML, Copy PNG, and Save PNG, and that the saved files are the fallback when the viewer blocks the clipboard or downloads

   Done when the page shows in the thread and the reply covers all four points.
