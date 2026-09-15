# Pull requests

## Tooling

Use `gh` when `gh auth status` succeeds. Without it, push the branch and give the user the compare URL: `https://github.com/<owner>/<repo>/compare/<base>...<branch>`.

## Splitting

One PR per change a reviewer could approve alone. Split when the work mixes unrelated concerns, or when a refactor or migration can land before the feature that needs it. Propose the split (PR titles, the commits in each, merge order) and ask before creating branches.

## Stacking

Stack when split PRs depend on each other.

- **`gh stack`**, when `gh extension list` shows `github/gh-stack`: `gh stack init`, commit, `gh stack add <branch>` per layer, `gh stack submit` to open the PRs, `gh stack rebase` then `gh stack push` after changes, `gh stack view` to check. If it's missing, offer to install it with `gh extension install github/gh-stack` and use the fallback on a no.
- **Fallback**: branch each layer off the one below and open it with `gh pr create --base <branch-below>`. List the stack, in order and with links, at the top of each PR body. Merge bottom-up, retargeting the next PR to the base branch after each merge.

## Opening

- Title follows the subject rules in [SKILL.md](SKILL.md).
- Body: why the change exists and how to verify it, in a few lines.
- Show titles, bodies, and base branches, then ask before pushing or creating PRs.

## Done when

The reply ends with the URL of every PR created or updated, in stack order (`gh pr view <branch> --json url -q .url`).
