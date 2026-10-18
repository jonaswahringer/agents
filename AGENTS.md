# Repository instructions

This repository installs shared agent instructions and skills.

## Shell support

- Keep the installer dependency-free.
- Support the Bash 3.2 version included with macOS as well as newer Bash releases on Linux.
- Quote paths and test changes with a temporary home directory.

## Skills

- Keep skills at `skills/<folder>/<name>/SKILL.md`, where the folder names whoever wrote them.
- Read folders from disk instead of listing them in code, so a new folder needs no installer change.
- Store a selection as `folder/name`, and keep resolving names saved before folders existed.
- Install a skill under its plain name, because that is the name agents load it by.
- Require valid front matter, and keep each skill's `name` equal to its directory name.

## Safety

- Keep private profile answers outside this repository.
- Do not overwrite files that the installer does not own without making a backup after user approval.
- Deduplicate equivalent config files and links without discarding unique instructions.
- Updates must preserve the saved profile and selected skills.

## Documentation

Write in plain words. Lead with the result, and report failed or skipped checks.

## Pull requests

- Use `.github/PULL_REQUEST_TEMPLATE.md`. Keep the visible summary short, with
  a before/after table and one main review decision. Link detailed evidence.
- Name branches `<type>/<topic>-<change>`, using lowercase words separated by
  hyphens. Use `skills/` for skill changes, `docs/` for documentation, `fix/`
  for fixes, and `feat/` for new behavior.
- Scheduled model refreshes use
  `skills/work-smart-not-hard-refresh-YYYY-MM-DD`, with the local run date.
- Check for an existing open PR for the same skill before creating another.
  Review it first and continue on its branch when appropriate.
- A merged model-skill update is installed on the Mac mini by the next weekly
  maintenance run. Follow `docs/model-skill-maintenance.md` and verify the
  installed skill against `main` before reporting it as updated.
