#!/usr/bin/env bash
# Compatibility entry point for existing install URLs and older agents updates.
set -euo pipefail

if [[ -n "${AGENTS_SOURCE_DIR:-}" ]]; then
  exec bash "$AGENTS_SOURCE_DIR/setup/install.sh" "$@"
fi

if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  AGENTS_BOOTSTRAP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "$AGENTS_BOOTSTRAP_ROOT/setup/install.sh" ]]; then
    exec bash "$AGENTS_BOOTSTRAP_ROOT/setup/install.sh" "$@"
  fi
fi

AGENTS_BOOTSTRAP_SCRIPT="$(mktemp "${TMPDIR:-/tmp}/agents-setup.XXXXXX")"
trap 'rm -f "$AGENTS_BOOTSTRAP_SCRIPT"' EXIT
curl -fsSL "https://raw.githubusercontent.com/${AGENTS_REPOSITORY:-jonaswahringer/agents}/${AGENTS_REF:-main}/setup/install.sh?update=${AGENTS_BOOTSTRAP_SCRIPT##*.}" -o "$AGENTS_BOOTSTRAP_SCRIPT"
bash "$AGENTS_BOOTSTRAP_SCRIPT" "$@"
