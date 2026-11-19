# Model skill maintenance

The existing weekly T3 task checks merged skill changes before researching new
models. It installs approved updates on the Mac mini and opens proposed model
changes for human review. Installation happens on the next scheduled run after
merge, rather than immediately when GitHub records the merge.

The task is named `Modernize work-smart-not-hard skill` and runs on Sunday at
05:00 in the configured scheduler timezone. Its configuration lives in T3.
Changes to this document alone do not change that configuration.

## Install merged changes first

1. Check merged PRs into `jonaswahringer/agents` on `main` that changed
   `skills/jonasw/work-smart-not-hard/`. Verify merge state through GitHub.
2. Read `agents source` and `agents skills source` to find the active installer
   source, selected skill, and installed links. Work on the Mac mini only.
3. Compare the selected, installed skill with the version currently on `main`.
   Compare every file in the skill directory, including supporting resources.
   If the files already match and the links resolve, no installation is needed.
4. If an update is needed, run `agents update`. Keep saved profile answers and
   skill selections. Do not use `--force`, change selections, or install from
   the PR branch. If the source is a Git checkout, report the prerequisite to
   update that checkout rather than changing its branch or discarding work.
5. Verify the installed skill and its links again against `main`. Record the
   checked main commit and affected PRs only after verification succeeds.
   If the skill is unselected, report it rather than selecting it automatically.

Keep installation records outside this repository at
`~/.local/state/agents/model-skill-maintenance.json`. Do not mark a failed or
unverified update as installed. Retry it on the next run. A missing record is
handled by comparing the current files before doing any installation.

If installation fails, report the failure before doing further refresh work.
An open PR is a proposal, so its contents must not be installed by this workflow.
Updates on the Mac mini do not update the MacBook or iPhone.

## Research and propose changes

Check for an existing open model-refresh PR before starting another. Read its
diff and review feedback. Avoid duplicate branches and PRs when no additional
changes are needed.

Use official Artificial Analysis pages for new releases, task costs, intelligence
scores, and relevant task benchmarks. Keep benchmark variants and effort levels
explicit. Check the runtime's model names and effort controls separately before
putting them in the allowed table.

Use `skills/work-smart-not-hard-refresh-YYYY-MM-DD` for a new refresh branch.
Use the PR template and a short before/after comparison. Identify the main review
decision and link detailed evidence. Follow the repository's commit and push
approval rules. The human decides whether to merge.

Report the PR link, the installed version if it was updated, and any failed or
skipped checks. Notify through the task's T3 result rather than sending messages
through other services.

## Desired output

The reader should be able to see the changed choices and the main review decision
in about a minute. Both the task result and PR description use the same summary:

- One sentence stating the result.
- A table with `Area`, `Before`, and `After`, covering at most five changed
  choices. Show costs or effort settings only where they explain a change.
- One main review decision or unresolved tradeoff.
- A short checks and installation status, with machine and version when updated.

Put the full model list, benchmark variants, source links, secondary changes,
and runtime assumptions in expandable details or a linked report. Keep the
summary faithful to the actual diff, and distinguish proposed changes from
verified installation. Report “no changes needed” when that is the result.

For a visual task result, use `html-communication` to make a compact before/after
view with expandable details. In T3, preview and render it through `html_preview`
and `html_render` when available. Keep the final chat response short. The PR
description uses Markdown and `<details>` so it remains readable on GitHub.
An optional HTML report link must be published and accessible before it is added;
label links that require Tailscale access.
