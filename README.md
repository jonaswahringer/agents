# agents

Shared instructions, skills and tools for coding agents. One installer manages
the machine profile, selected skills and local commands.

| Area | Purpose |
| --- | --- |
| [Setup](setup/README.md) | Install and configure shared instructions and commands. |
| [CLI](tools/agents-cli/README.md) | Update, select skills, inspect links and sync upstream copies. |
| [Skills](skills/) | Reusable instructions, grouped by author. |
| [Furnace](tools/furnace/README.md) | A private backlog with claims, checkpoints and review reports. |
| [Comms](tools/comms/README.md) | Publish reports and media to reachable tailnet URLs. |
| [Frameworks](frameworks/README.md) | Organize agent work with delta-flume. |
| [usage](tools/usage/README.md) | Deprecated quota CLI, retained for existing users. |

## Start

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/jonaswahringer/agents/main/setup/install.sh)"
agents skills
agents doctor
```

Use `agents update` to update an installation. Setup details and non-interactive
options are in [setup/](setup/README.md).

## Develop

```sh
./tests/test.sh
./tests/all.sh
```

See [setup checks](setup/README.md#checks) for prerequisites. Ideas live in
[IDEAS.md](IDEAS.md). Profiles and tool state stay outside Git on each machine.

The retired `auto-resume` and `workflows` tools are preserved on the
`archive/t3-runtime-tools` branch. T3 Code handles scheduling and continuation.
