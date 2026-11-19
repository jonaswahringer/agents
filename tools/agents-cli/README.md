# agents CLI

The public command is `agents`. Its implementation is `agents-cli` in this folder;
`skills-sync.sh` handles the `agents skills sync` subcommand.

## Update or change the setup

```sh
agents update
agents update --skills
agents configure
agents skills
agents skills add mattp/tdd
agents doctor
```

Updates restore the local command links as well as the saved skill selection.
If `furnace` is missing, run `agents update` on that machine, check that
`~/.local/bin/` is in `PATH`, and use `agents doctor` to inspect its link.

## See where files come from

```sh
agents source
agents skills source
agents doctor --verbose
```

`agents source` shows the folder `agents` runs from, whether `agents update`
replaces it or it is a Git checkout you pull yourself, and how `~/.claude/CLAUDE.md`
and `~/.codex/AGENTS.md` link to the shared `~/.agents/AGENTS.md`.

`agents skills source` lists each skills folder with how many of its skills are
selected, then shows the source folder behind every selected skill. A link that is
missing or points somewhere else gets its own `!` line.

`agents doctor --verbose` runs the usual checks, then prints both reports.

`agents update` downloads the newest repository version and restores the saved
skill selection. It does not ask for the global configuration again or regenerate
the file. It can replace known legacy lines and add the user-input tool rule in an
installer-managed global file while preserving profile answers and personal additions.

A selection saved before skills were grouped in folders still works: each saved name is matched to the folder it now lives in, and links left pointing at the old location are repaired. A saved skill that has since been removed is reported and dropped.

An update does not change optional skill selections. It only ensures that `nice` is
present when global configuration is enabled. The update ends by saying how many
optional skills it left out. Run `agents update --skills` to open the menu straight
after updating, or `agents skills` at any time to reopen it. Cancelling that menu
with `q` keeps the saved selection and still finishes the update.

For the same reason, `agents skills --none` keeps `nice` while global configuration
is enabled. Install with `--no-config` to manage skills without that requirement.

Run `agents configure` when you want to change the saved answers.

`agents skills add mattp/tdd` adds one skill while keeping the saved selection.
Use `folder/name` when more than one folder ships that name. A competing selected
version must be deselected through `agents skills` first.

Copied upstream skills are maintained in a Git checkout with
`./tools/agents-cli/agents-cli skills sync mattp`. It merges upstream edits into reviewable source
changes and lists new candidates. Import one with
`./tools/agents-cli/agents-cli skills sync mattp --add pr`. See [skills syncing](../../docs/skills-sync.md)
for dry runs, conflicts, and manifests. Installing and updating never fetch skills
directly from their upstream repositories.


## Development

Run `./tools/agents-cli/agents-cli help` from the repository root, or use the
installed `agents` command. [Setup](../../setup/README.md) documents installation
and profiles; [skills sync](../../docs/skills-sync.md) documents upstream merges.
