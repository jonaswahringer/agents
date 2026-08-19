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

## Safety

- Keep private profile answers outside this repository.
- Do not overwrite files that the installer does not own without making a backup after user approval.
- Deduplicate equivalent config files and links without discarding unique instructions.
- Updates must preserve the saved profile and selected skills.

## Documentation

Write in plain words. Lead with the result, and report failed or skipped checks.
