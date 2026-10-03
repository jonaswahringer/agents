# Workflows

Run a T3 Code update check from cron. GitHub collection runs first. The configured
agent runs only when newly merged PRs or a new published nightly need a digest.
Reports and SQLite history stay outside the repository. Nothing installs cron,
updates T3, or sends a notification without a configured delivery command.

Requires Python 3.9+, `gh` authenticated for GitHub, a working installed T3 version
command, and Codex CLI or another configured summarizer. The installer needs no
new dependency. The CLI uses only the Python standard library on macOS and Linux.

## Setup on the Mac mini

Copy `config.example.json` to `~/.config/agents/workflows.json`, with mode 600.
Keep your private profile and command paths there. Check command paths with
`command -v python3 gh t3 codex`, then replace the example paths with the actual
paths on the Mac mini. Create the config directory with mode 700.

```sh
mkdir -p "$HOME/.config/agents"
chmod 700 "$HOME/.config/agents"
cp /Users/minj/Projects/agents/tools/workflows/config.example.json "$HOME/.config/agents/workflows.json"
chmod 600 "$HOME/.config/agents/workflows.json"
python3 /Users/minj/Projects/agents/tools/workflows/workflows.py collect
python3 /Users/minj/Projects/agents/tools/workflows/workflows.py run t3-updates
python3 /Users/minj/Projects/agents/tools/workflows/workflows.py status
python3 /Users/minj/Projects/agents/tools/workflows/workflows.py history
```

`collect` prints evidence without an agent or delivery call. `run` and `tick` do
the same single bounded check. `status` prints the latest run, pending delivery,
reported event count, and recent failures. `history` shows the last 50 runs and
failures. All commands accept `--config /absolute/file.json` and
`--state-dir /absolute/private/directory`.

Default state is `~/.local/state/agents/workflows`. It contains `workflows.sqlite3`,
`reports/t3-update-<run-id>.md`, complete `evidence-<run-id>.json`, and validated
agent JSON. The digest contains the recommendation, installed version, date, and
at most five linked changes. Full evidence stays in the separate evidence file.
These are Mac mini files. Opening them from your MacBook requires your existing
remote file access or a configured delivery command. There is no localhost server.

## Agent and delivery commands

By default the tool runs `codex exec --ignore-user-config --skip-git-repo-check
--output-schema ... --output-last-message ... --sandbox read-only --ephemeral -`
from the private state directory. It sends the prompt on stdin and keeps Codex's
normal permission policy. The prompt forbids tool actions and treats PR bodies as
untrusted evidence. A read-only sandbox still permits reads; use a separately
isolated agent environment if your threat model requires blocking access to other
readable machine files.

The sandbox covers only Codex's shell. MCP servers, plugins, connectors, and
browser tools run outside it, so the summarizer gets none of them: the run skips
`~/.codex/config.toml`, where MCP servers are configured, and turns off apps,
plugins, browser and computer use, and web search. Codex still uses its saved
login.

`codex_command` supplies the Codex executable and global options while retaining
the built-in schema, output validation, and read-only sandbox. The example config
uses GPT-6.1 Sol with medium reasoning and an absolute executable path. Because
the run skips `config.toml`, set the model and reasoning effort here. It uses
the existing Codex login; do not add API credentials to enable subscription work.

To use another summarizer, add `agent_command` as an argv array. It receives the
prompt on stdin and must return only JSON on stdout:

```json
{
  "recommendation": "later",
  "summary": "The remote reconnect fix is merged, but release inclusion is unverified.",
  "changes": [{"url": "https://github.com/pingdotgg/t3code/pull/123", "reason": "Relevant to Tailscale reconnects"}]
}
```

Valid recommendations are `update now`, `later`, and `skip`. Invalid structure,
unsupported URLs, missing PR links for an update recommendation, or excessive length fail without advancing
the reported cursor. Custom agents must provide their own sandbox policy. Commands
are argv arrays, never shell strings; shell interpolation is not performed.

Delivery is optional. A successful report counts as reported locally when no
`delivery_command` is configured. With a delivery command, the report goes to
stdin; `{report}` and `{run_id}` in arguments expand to the saved path and ID:

```json
{"delivery_command": ["/absolute/path/to/delivery-adapter", "--id", "t3-update-{run_id}", "--file", "{report}"]}
```

Configure and test your adapter before activating notifications. A failed delivery
keeps the exact report pending. The next run retries delivery first without another
GitHub collection or agent call. Supply an idempotent adapter using the run ID.
An external send that succeeds immediately before a crash can be attempted again;
local SQLite cannot make an external transport atomic. Delivery failures remain
in history after a later success. Every external command has a hard timeout, and
timeouts kill the process group. One file lock prevents overlapping checks.

### Publish to comms

The bundled `publish_comms.py` adapter converts the digest to escaped HTML and
publishes it to the existing comms service. It reads the saved Postplan endpoint
and key from `~/.postplan/config.json` and `credentials.json`. No key goes in the
workflow config or repository. Add this command to the private workflow config:

```json
{
  "delivery_command": [
    "/opt/homebrew/bin/python3",
    "/Users/minj/Projects/agents/tools/workflows/publish_comms.py",
    "--id", "{run_id}", "--file", "{report}",
    "--state-dir", "/Users/minj/.local/state/agents/workflows"
  ]
}
```

Each new digest updates the same URL. `comms.json` in the private state directory
records that URL, draft ID, and last delivered run. Retrying an acknowledged run
does not upload it again. A crash or lost response before that record is saved
can create an extra version, or an extra draft on the first upload. The adapter
connects directly without a system proxy and does not follow redirects with
credentials. Publishing creates no push notification.
An unchanged check leaves the previous digest and its collection date visible.

## Cron example

Review paths and create the private state directory before adding this yourself.
No cron entry is installed by this project.

```cron
PATH=/Users/minj/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
# Use the Mac mini's local cron timezone. This example runs at 09:15 local time.
15 9 * * * /opt/homebrew/bin/python3 /Users/minj/Projects/agents/tools/workflows/workflows.py tick t3-updates --config /Users/minj/.config/agents/workflows.json --state-dir /Users/minj/.local/state/agents/workflows >> /Users/minj/.local/state/agents/workflows/cron.log 2>&1
```

macOS cron follows the machine's timezone. Do not assume Linux's `CRON_TZ` is
supported on macOS. On a Linux cron implementation that supports it, `CRON_TZ=Europe/Vienna`
can set the schedule timezone. API timestamps and run history are UTC.

## Release evidence and limits

The first check looks back `bootstrap_days`, default seven days, for merged PRs.
It collects merges into `base_branch`, default `main`, so staging branch activity
does not fill a release digest. Set that field if a different branch feeds releases.
Later checks preserve the last reported collection date with a one-day overlap.
An outage preserves that cursor. A saturated 1,000-PR query fails visibly rather
than silently dropping results. Published nightlies match the configured regex
against tag and name. Draft releases are ignored. Only the latest new nightly is
an event; older release notes provide cumulative context from the installed tag.

When the installed version output contains an exact known release tag, collection
compares that tag with the latest nightly and includes every intermediate nightly's
notes. GitHub's cumulative compare supplies at most 250 commits; its total count
makes truncation visible in evidence. For each newly observed PR, a separate commit
ancestry comparison verifies inclusion in the latest nightly and the installed
version. A merged PR alone is never labeled shipped. Unknown tags, failed compare
requests, squash histories, and diverged branches retain an unverified label.
The agent sees these labels and is instructed to recommend later for merged-only
improvements and to avoid recommending changes already installed. Published release
availability does not establish compatibility with the user's deployment.

The first run may describe improvements already installed, with that status made
explicit. If the installed version cannot be matched, no exact upgrade difference
is claimed. Existing unchanged evidence skips the agent even if your local installed
version changes. A recreated nightly with the same release ID is not a new event.
GitHub release metadata and PR text are inputs, so the digest is advisory and does
not authorize changes. Reports and history are retained until you remove them.

## Tests

```sh
python3 -m unittest discover -s tools/workflows -p 'test_*.py' -v
```

Tests run the real CLI with a temporary HOME and paths containing spaces. Stub
commands cover new and unchanged material, cumulative release context, conservative
shipping labels, collection failures, malformed summaries, delivery retries,
concurrent checks, process timeouts, and private file permissions. They make no
network requests, invoke no real agent, and send no notifications.
