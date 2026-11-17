# Keep copied skills current

`agents skills sync mattp` merges upstream changes into an agents Git checkout.
The same command syncs any author folder with an `upstream.tsv` manifest, such as
`pstack` or `tstack`.
Review and commit that diff before distributing it through `agents update`.
Syncing leaves installed selections and private profile answers alone.

## Add one installed skill

If the skill is already in this repository, keep your current selection and add it:

```sh
agents skills add mattp/tdd
```

A bare name also works when it is unique. When another selected folder ships the
same plain name, both install under their folder names, such as `mattp-tdd` and
`pstack-tdd`, and `tdd` lists them.
Global configuration still requires `jonasw/nice`.

On an older installation, run `agents skills`, open the author folder, and toggle
only the desired skill. The installer option `--skills` replaces the selection;
it does not add to it.

## Sync a copied set

Run the command from the agents checkout whose source you want to maintain:

```sh
./bin/agents skills sync mattp --dry-run
./bin/agents skills sync mattp
git diff -- skills/mattp
```

The command needs Git, Bash 3.2 or newer, and standard Unix tools. It refuses to
sync the installed snapshot under `~/.local/share/agents/`, where a later update
would replace your edits. It fetches upstream only when explicitly invoked.
Installation and `agents update` use this repository's reviewed copies.

A sync uses the manifest's recorded upstream commit as the common baseline. It
merges text edits, preserves local additions, applies upstream resource removals,
and preserves executable flags. Overlapping changes stop the whole sync before
source files are replaced. The error names the conflicting files. Compare your
local file with the baseline and upstream, reconcile that edit, and retry. Binary
files changed on both sides also need manual reconciliation. Links and special
files inside copied skill trees are rejected.

A mapped skill that disappears or moves upstream stops the sync. Update its path
in the manifest if it moved. Replace its `skill` row with a `local` row if you want
to retain your copy without upstream updates. Sync does not automatically remove
whole skills or change saved selections.

## Copy one new upstream skill

The sync lists upstream candidates that have no manifest entry. Import one by name:

```sh
./bin/agents skills sync mattp --add pr
```

This syncs the existing tracked set too. It adds the complete `pr` directory and a
manifest row, but does not select the skill on any machine. Review the diff, publish
it through your normal Git workflow, then run these on each machine that needs it:

```sh
agents update
agents skills add mattp/pr
```

Repeat `--add` to import several skills. No category is imported automatically,
including upstream's `in-progress` and `misc` categories. Existing local skill
directories cannot be taken over with `--add`.

Use `--ref` to sync to a specific upstream commit, tag, or ref instead of the
manifest's default branch. Remote branch refs can be written as `origin/name`.
The manifest records the resulting commit; its default branch stays unchanged.

## Manifest

Each copied author folder can have an `upstream.tsv` file. It is tab-separated data,
never executed as shell code. For example:

```text
repository<TAB>https://github.com/mattpocock/skills.git
ref<TAB>main
commit<TAB>FULL_40_CHARACTER_UPSTREAM_COMMIT
skill<TAB>tdd<TAB>skills/engineering/tdd
local<TAB>find-skills
```

Use actual tabs instead of `<TAB>`. Each skill can have one row. `skill` maps the
flat local directory to its upstream directory. `local` keeps a skill outside the
sync and candidate list. Comments begin with `#`.

An optional `root` row names the upstream folder that holds `skills/` and
`LICENSE`, for a repository that ships more than one skill set. Skill paths are then
relative to that folder. For example, `root<TAB>pstack` reads
`pstack/skills/statechart` as `skills/statechart`.

The baseline must match the source originally copied, not today's upstream HEAD.
Otherwise the merge cannot distinguish upstream edits from local edits. If a
mapped skill moved since that baseline, sync locates its unique old directory by
name. The current upstream path must be explicit in the manifest.

The initial Matt baseline is `2ab958093e83e0ec752e6c1c5932da465bf23e0c`.
All 64 files in the 21 skills copied from Matt matched that snapshot. `find-skills`
was not in it. `resolving-merge-conflicts` and `writing-great-skills` are retained as
local copies because upstream removed or renamed them. The upstream MIT license
is stored alongside the copied set and is updated through the same merge.

The `tstack` set was copied unchanged from upstream commit
`11e37a74d0a6868c121cd0910ab2b3bd9873b92a`, which is its baseline.

The `pstack` set comes from the `pstack` folder of
`https://github.com/cursor/plugins`, written by Lauren Tan and published under MIT.
It was copied without a recorded commit. Its baseline is
`63d938c2e4a165a0fec1bd0f61a8e325f0cb751e`, the latest upstream change to
`pstack/skills` before the copy was made: all 121 files in the 44 copied skills
match that snapshot byte for byte, and no other version of that folder does. The one
local edit, renaming `poteto-mode`'s front matter `name` from `Poteto Mode` so it
equals its directory, was later made upstream too.

Sync is manual. This change creates no recurring job. Another author can use the
same command once its provenance and baseline are recorded.
