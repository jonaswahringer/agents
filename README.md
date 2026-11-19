# agents

Shared instructions, skills and tools for coding agents. One installer manages
the machine profile, selected skills and local commands.

- [`setup/`](setup/README.md): install and configure shared instructions and commands.
- [`tools/`](tools/): local commands.
  - [`agents-cli/`](tools/agents-cli/README.md): update, select skills, inspect links and sync upstream copies.
  - [`comms/`](tools/comms/README.md): publish reports and media to reachable tailnet URLs.
  - [`furnace/`](tools/furnace/README.md): a private backlog with claims, checkpoints and review reports.
  - [`usage/`](tools/usage/README.md): deprecated quota CLI, retained for existing users.
- [`frameworks/`](frameworks/README.md): organize agent work with delta-flume.
- [`skills/`](skills/): reusable instructions, grouped by author.

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
