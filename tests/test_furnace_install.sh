#!/usr/bin/env bash
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/agents-furnace-install.XXXXXX")"
TEST_HOME="$TEST_ROOT/home with spaces"
trap 'rm -rf "$TEST_ROOT"' EXIT

run_home() {
  env HOME="$TEST_HOME" AGENTS_SOURCE_DIR="$ROOT" \
    AGENTS_CONFIG_DIR="$TEST_HOME/.config/agents" \
    AGENTS_INSTALL_DIR="$TEST_HOME/.local/share/agents" \
    AGENTS_BIN_DIR="$TEST_HOME/.local/bin" \
    AGENTS_HOME="$TEST_HOME/.agents" CLAUDE_HOME="$TEST_HOME/.claude" \
    CODEX_HOME="$TEST_HOME/.codex" XDG_STATE_HOME="$TEST_HOME/.local/state" "$@"
}

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

run_home /bin/bash "$ROOT/install.sh" --skills nice --no-config > "$TEST_ROOT/install.txt"
AGENTS="$TEST_HOME/.local/bin/agents"
FURNACE="$TEST_HOME/.local/bin/furnace"
INSTALLED_ROOT="$TEST_HOME/.local/share/agents/source"
cp "$TEST_HOME/.config/agents/selected-skills" "$TEST_ROOT/selection"
mkdir -p "$TEST_HOME/.config/agents/profile"
printf 'Private profile answer\n' > "$TEST_HOME/.config/agents/profile/about-me"
run_home python3 "$INSTALLED_ROOT/tools/furnace/furnace.py" add 'Keep this idea' > "$TEST_ROOT/idea.json"

# Reproduce an old installation that has the skill/tool source but no CLI link.
[[ ! -L "$FURNACE" ]] || rm "$FURNACE"
run_home "$AGENTS" update > "$TEST_ROOT/update.txt"
[[ -x "$FURNACE" ]] || fail "agents update leaves furnace unavailable: command not found"
run_home "$FURNACE" list > "$TEST_ROOT/list.json"
run_home python3 - "$TEST_ROOT/list.json" <<'PY'
import json, sys
rows = json.load(open(sys.argv[1]))
assert len(rows) == 1 and rows[0]['title'] == 'Keep this idea', rows
PY
cmp -s "$TEST_ROOT/selection" "$TEST_HOME/.config/agents/selected-skills" || fail "update changed skill selection"
[[ ! -e "$TEST_HOME/.agents/skills/furnace" ]] || fail "installing the CLI should not select the optional skill"
[[ "$(cat "$TEST_HOME/.config/agents/profile/about-me")" == 'Private profile answer' ]] || fail "update lost the private profile"
run_home "$AGENTS" doctor > "$TEST_ROOT/doctor.txt"
grep -Fq "$FURNACE" "$TEST_ROOT/doctor.txt" || fail "doctor does not check furnace"

# Fresh installs link the tool too, regardless of the selected skills.
rm "$FURNACE"
run_home /bin/bash "$ROOT/install.sh" --skills nice --no-config > "$TEST_ROOT/reinstall.txt"
[[ -x "$FURNACE" ]] || fail "fresh install did not link furnace"

# A separate command is kept without approval, and replacement makes a backup.
rm "$FURNACE"
printf '#!/bin/sh\nprintf "Other furnace\\n"\n' > "$FURNACE"
chmod +x "$FURNACE"
run_home /bin/bash "$ROOT/install.sh" --skills nice --no-config > "$TEST_ROOT/conflict.txt" 2>&1
[[ ! -L "$FURNACE" ]] || fail "install replaced an unrelated command without approval"
grep -Fq 'Other furnace' "$FURNACE" || fail "unrelated command was changed"
if run_home "$AGENTS" doctor > "$TEST_ROOT/conflict-doctor.txt"; then
  fail "doctor should report the unrelated furnace command"
fi
run_home /bin/bash "$ROOT/install.sh" --skills nice --no-config --force > "$TEST_ROOT/force.txt"
[[ -L "$FURNACE" ]] || fail "approved replacement did not link furnace"
compgen -G "$FURNACE.backup-*" > /dev/null || fail "approved replacement did not back up the old command"

echo 'PASS: furnace installation, update recovery, private state, and command conflicts'
