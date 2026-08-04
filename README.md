# agents

Set up shared instructions and skills for coding agents from one interactive installer.

## Install

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/jonaswahringer/agents/main/install.sh)"
```

The installer opens a keyboard menu:

```text
[x] Global config
[-] Skills
    [x] nice-to-read
    [x] proper-commits
    [ ] work-smart-not-hard
```

Use the arrow keys to move, Space to toggle an item, and Enter to install. Toggling `Skills` selects or clears every skill below it. A `[-]` mark means that only some skills are selected.

The global setup asks about you, this machine, network access, how work moves between machines, and your preferred tools. The answers stay on your machine under `~/.config/agents/`; they are not stored in this repository.

## What gets installed

The managed source lives at `~/.local/share/agents/`, and the `agents` command is linked into `~/.local/bin/`.

Global instructions are written to:

- `~/.agents/AGENTS.md`
- `~/.claude/CLAUDE.md`
- `~/.codex/AGENTS.md`, linked to the shared `AGENTS.md`

Selected skills are linked into the skill directories for agents, Claude Code, and Codex. Existing files that the installer does not own are skipped unless you approve a backup and replacement.

Make sure `~/.local/bin` is in your `PATH` so the command is available in new shells.

## Update or change the setup

```sh
agents update
agents configure
agents skills
agents doctor
```

`agents update` downloads the newest repository version and restores the saved skill selection. It does not ask for the global configuration again or regenerate those files.

Run `agents configure` when you want to change the saved answers. Run `agents skills` to reopen the nested skill menu.

## Non-interactive install

Install everything without opening the menu:

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/jonaswahringer/agents/main/install.sh)" -- --all
```

Select specific skills or skip global configuration:

```sh
./install.sh --skills nice-to-read,proper-commits --no-config
```

The profile prompts also accept these environment variables for automated machine setup:

- `AGENTS_PROFILE_ABOUT_ME`
- `AGENTS_PROFILE_MACHINE`
- `AGENTS_PROFILE_NETWORK`
- `AGENTS_PROFILE_SYNC`
- `AGENTS_PROFILE_TOOLING`

## Included skills

- `nice-to-read` makes explanations easy to read once and understand.
- `proper-commits` writes commit messages as terse changelog headlines.
- `work-smart-not-hard` chooses a suitable model and reasoning effort for delegated work.

## Development

Run the dependency-free test suite with:

```sh
./tests/test.sh
```

Set `AGENTS_SOURCE_DIR` to install or update from a local checkout instead of GitHub.

## Skills still wanted

- `teach` — a customized Matt Pocock teaching skill based on the knowledge-tree idea and an improved EITMLIF variant.
- `get-it-going` — a deep-thinking skill that focuses on getting the most out of the human.
- `plan` — a skill that builds a plan from snippets, articles, and paragraphs written by the human.
