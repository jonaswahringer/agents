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
- Install a skill under its plain name, because that is the name agents load it by. When several selected folders ship the same name, install each as `folder-name` and make the plain name a generated skill that lists them.
- Require valid front matter, and keep each skill's `name` equal to its directory name.
- Update copied sets with `./bin/agents skills sync <folder>`, following each folder's `upstream.tsv` and `docs/skills-sync.md`. Use `--add <name>` to import a new upstream skill without changing installed selections. Sync needs network, preserves local edits, and stops on overlapping changes. Keep intentional customizations when resolving conflicts; local dependency and compatibility fixes remain possible when upstream lags.

## Checks

- `./tests/test.sh` needs Bash, Git and Python 3. It tests installation in a temporary home, `agents doctor`, usage, skills sync, the skill menu and Furnace installation without third-party Python packages.
- `./tests/all.sh` adds tool suites and each skill's `scripts/test.sh`. It needs Python 3.9+ and Node 18+. Bun suites are skipped without Bun; with Bun, missing tool dependencies are installed from their lockfile.
- The full suite omits the two copied skill packages. In `skills/pstack/poteto-mode/scripts`, run `bun install --frozen-lockfile`, `bun run typecheck`, then `bun run test`.
- In `skills/pstack/statechart/scripts`, run `npm install --include=dev --package-lock=false`, then `npm test`. This test command needs Node 22.18 through 22.x, or 23.6+. For TLC tests, set `TLA2TOOLS` to the pinned `tla2tools.jar` named in `skills/pstack/statechart/scripts/run.ts`; use Java 11+ on PATH or set `JAVA` to its executable. Report skipped TLC tests when the prerequisites are missing.
- No separate repository-wide runtime check beyond these tests is named. The temporary-home install is the closest existing check; report that gap.
- No check needs a secret.

## Safety

- Keep private profile answers outside this repository.
- Do not overwrite files that the installer does not own without making a backup after user approval.
- Deduplicate equivalent config files and links without discarding unique instructions.
- Updates must preserve the saved profile and selected skills.
- Comms uses `POSTPLAN_BOOTSTRAP_API_KEY` from the ignored `tools/comms/.env` or `tools/comms/com.wahringer.comms.plist`. Keep those values out of agent context; the tests set their own key. Live `bin/usage` reads provider logins, including Claude's keychain entry or `~/.claude/.credentials.json`; it is not a credential-free smoke check.
- The comms launchd service runs from the main checkout on the Mac mini, so make changes in a worktree. `git clean -xd` in the main checkout removes comms dependencies and stops the service.

## Frameworks

- `frameworks/delta-flume` is published to the read-only repo jonaswahringer/delta-flume by `.github/workflows/publish-delta-flume.yml` on every push to main. Change it here, never there.
- Keep links inside `frameworks/delta-flume` relative to that folder, so they work in both repos.

## Documentation

Write in plain words. Lead with the result, and report failed or skipped checks.
