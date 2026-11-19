# Setup

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/jonaswahringer/agents/main/setup/install.sh)"
```

The installer opens a keyboard menu:

```text
  agents / setup                                                   4 of 103 selected
  1 jonasw  2 mattp  3 pstack  4 tstack

    [ ] Global config  Shared AGENTS.md for Claude Code and Codex
    [-] Skills                                                                 4/103
      ▸ [-] jonasw                                                              2/14
      ▾ [-] mattp                                                               2/22
        [x] ask-matt                  Ask which skill or flow fits your situation
  ❯     [ ] code-review               Review the changes since a fixed point (commi…
        [x] codebase-design           Shared vocabulary for designing deep modules
        [ ] diagnosing-bugs           Diagnosis loop for hard bugs and performance…
        [ ] domain-modeling           Build and sharpen a project's domain model
        [ ] find-skills               Helps users discover and install agent skills…
    ↓ 18 more
  ──────────────────────────────────────────────────────────────────────────────────
  Review the changes since a fixed point (commit, branch, tag, or merge-base) along
  two axes: Standards (does the code follow this repo's documented coding standards…

  ↑↓ move   ←→ collapse/expand   space toggle   enter continue   q cancel
```

Skills are grouped in folders named after whoever wrote them. Use the arrow keys to
move, Space to toggle an item, and Enter to save and install. `agents skill` is an
alias for `agents skills`.

- Press a creator's number to jump directly to it, such as `2` for `mattp` or `3`
  for `pstack`. Numbers follow the folders found on disk and appear above the list.
- Press a creator's first letter to jump to it, such as `m` for `mattp`. When
  creators share an initial, repeating the letter cycles between them.
- Folders start collapsed. Right arrow expands the folder under the cursor, and
  pressing it again steps onto its first skill. Left arrow collapses the folder,
  moving the cursor back onto it from one of its skills.
- Up and down only move the cursor; they never expand or collapse a folder.
- Each skill shows the first sentence of its description. The area under the list
  shows the full description of the highlighted row; short terminals leave it out.
- When selected folders share a skill name, each installs with its folder prefix;
  the plain name becomes a generated skill listing the variants.
- Long folders scroll within the terminal, keeping the cursor and controls visible.
  `↑ N more` and `↓ N more` show how much is out of view. Home/End jump to the
  first/last item, and Page Up/Down move a page at a time.
- Toggling a folder selects or clears every skill in it.
- Toggling `Skills` selects or clears everything.
- A `[-]` mark means only some of the skills below are selected.
- `q`, Escape, or Ctrl+C cancels without saving changes.

The menu highlights the current row and the creator it belongs to, and shows
selected totals for each folder. Colors come from the terminal's own palette.
Set `NO_COLOR=1` to disable styling; a locale that is not UTF-8 gets ASCII
glyphs. Leaving the menu restores the terminal. After saving, a spinner runs next
to `Updating skills` until installation finishes. It pauses for file replacement
prompts and clears before the result.

The global setup asks about you, this machine, network access, how work moves between machines, and your preferred tools. The answers stay on your machine under `~/.config/agents/`; they are not stored in this repository.

## What gets installed

The managed source lives at `~/.local/share/agents/`. The `agents`, `usage`, and
`furnace` commands are linked into `~/.local/bin/`; keep that directory in `PATH`.
An unrelated existing command is kept unless you approve its replacement.

Global instructions are written to:

- `~/.agents/AGENTS.md`, the canonical file
- `~/.claude/CLAUDE.md`, linked to the canonical file
- `~/.codex/AGENTS.md`, linked to the canonical file

Selected skills are linked into the skill directories for agents, Claude Code, and
Codex. A skill is linked under its own name, without the folder, because that is the
name agents load it by. When you select skills with the same name from several
folders, each one installs as `FOLDER-NAME`, such as `mattp-teach` and `pstack-teach`.
The plain name `teach` then becomes a short skill that agents generates. It lists both
skills with their descriptions and tells the agent to pick the one that fits, so skills
and people that ask for `teach` still reach one. The renamed copy changes only the
`name` line and links every other file to the source. `agents doctor` reports a
generated skill that no longer matches its source as stale; `agents update` rebuilds
it.

The global instructions use `jonasw/nice`, so selecting global configuration also
selects that skill. Other skills remain optional. The installer rejects a skill if
its required front matter is missing or its `name` does not match its directory.

The installer handles existing configuration without guessing:

- A link that already resolves to the canonical file is kept.
- A byte-for-byte duplicate file is replaced with the shared link.
- A file previously generated by `agents` is backed up and migrated.
- A separate file, broken link, or link to another config is kept unless you approve replacement. Non-interactive installs require `--force`.
- A directory at a config target stops installation and is never replaced.

Every replaced conflict receives a timestamped backup beside the original path.

Make sure `~/.local/bin` is in your `PATH` so the command is available in new shells.

## Non-interactive install

Install everything without opening the menu:

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/jonaswahringer/agents/main/setup/install.sh)" -- --all
```

Select specific skills or skip global configuration:

```sh
./setup/install.sh --skills nice,commit --no-config
```

`--skills` accepts a folder name to take everything in it, and `folder/name` when the
same skill name exists in more than one folder:

```sh
./setup/install.sh --skills jonasw,mattp/teach
```

The profile prompts also accept these environment variables for automated machine setup:

- `AGENTS_PROFILE_ABOUT_ME`
- `AGENTS_PROFILE_MACHINE`
- `AGENTS_PROFILE_NETWORK`
- `AGENTS_PROFILE_SYNC`
- `AGENTS_PROFILE_TOOLING`


## Source layout

`install.sh` stages a source snapshot and installs the public commands.
`templates/AGENTS.md` holds the shared instructions used with a private machine profile.
The small root `install.sh` forwards old URLs and existing installations here.

From a checkout, run `./setup/install.sh`. Set `AGENTS_SOURCE_DIR` to choose a
different local source. Installation starts no service, schedule or agent.

## Checks

`./tests/test.sh` exercises installation and updates in temporary homes, including
legacy command links and rollback. It needs Bash, Git and Python 3.
`./tests/all.sh` adds tool suites and skill-owned `scripts/test.sh` suites.
It needs Python 3.9+ and Node 18+. Bun suites are skipped without Bun; with Bun,
missing tool dependencies are installed from their lockfile. No check needs
provider credentials.

The full runner omits the copied packages in
`skills/pstack/poteto-mode/scripts` and `skills/pstack/statechart/scripts`.
Run their package checks separately when changing them.
There is no separate repository-wide runtime check beyond these tests.
