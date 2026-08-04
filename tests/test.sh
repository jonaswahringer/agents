#!/usr/bin/env bash

set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/agents-test.XXXXXX")"
TEST_HOME="$TEST_ROOT/home"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_file() {
  [[ -f "$1" ]] || fail "expected file $1"
}

assert_link() {
  [[ -L "$1" ]] || fail "expected link $1"
}

assert_missing() {
  [[ ! -e "$1" && ! -L "$1" ]] || fail "expected $1 to be absent"
}

assert_contains() {
  grep -Fq "$2" "$1" || fail "expected $1 to contain: $2"
}

mkdir -p "$TEST_HOME/.codex"
printf 'old local instructions\n' > "$TEST_HOME/.codex/AGENTS.md"

export HOME="$TEST_HOME"
export AGENTS_SOURCE_DIR="$ROOT"
export AGENTS_PROFILE_ABOUT_ME="I build developer tools."
export AGENTS_PROFILE_MACHINE="This MacBook is used for local development."
export AGENTS_PROFILE_NETWORK="Services on another machine are not reachable through this machine's localhost."
export AGENTS_PROFILE_SYNC="Push changes, then pull them on the machine that runs the service."
export AGENTS_PROFILE_TOOLING="Use zsh, Git, and the package manager already used by each project."

"$ROOT/install.sh" --all --force >/dev/null

AGENTS="$TEST_HOME/.local/bin/agents"
assert_link "$AGENTS"
assert_file "$TEST_HOME/.agents/AGENTS.md"
assert_file "$TEST_HOME/.claude/CLAUDE.md"
assert_link "$TEST_HOME/.codex/AGENTS.md"
assert_file "$TEST_HOME/.codex/AGENTS.md.backup-"* 2>/dev/null || fail "expected the old Codex config to be backed up"
assert_contains "$TEST_HOME/.agents/AGENTS.md" "I build developer tools."

for skill in nice-to-read proper-commits work-smart-not-hard; do
  assert_link "$TEST_HOME/.agents/skills/$skill"
  assert_link "$TEST_HOME/.claude/skills/$skill"
  assert_link "$TEST_HOME/.codex/skills/$skill"
done

MENU="$TEST_ROOT/menu.txt"
"$AGENTS" _menu_snapshot > "$MENU"
assert_contains "$MENU" "[x] Skills"
assert_contains "$MENU" "      [x] nice-to-read"

printf '\nA personal line that updates must preserve.\n' >> "$TEST_HOME/.agents/AGENTS.md"
"$AGENTS" update >/dev/null
assert_contains "$TEST_HOME/.agents/AGENTS.md" "A personal line that updates must preserve."

"$AGENTS" skills --none >/dev/null
for skill in nice-to-read proper-commits work-smart-not-hard; do
  assert_missing "$TEST_HOME/.agents/skills/$skill"
  assert_missing "$TEST_HOME/.claude/skills/$skill"
  assert_missing "$TEST_HOME/.codex/skills/$skill"
done

"$ROOT/install.sh" --skills nice-to-read --no-config >/dev/null
"$AGENTS" _menu_snapshot > "$MENU"
assert_contains "$MENU" "[-] Skills"
assert_contains "$MENU" "      [x] nice-to-read"
assert_contains "$MENU" "      [ ] proper-commits"

"$AGENTS" skills --all >/dev/null
"$AGENTS" doctor >/dev/null

NO_CONFIG_HOME="$TEST_ROOT/no-config-home"
HOME="$NO_CONFIG_HOME" "$ROOT/install.sh" --skills nice-to-read --no-config >/dev/null
HOME="$NO_CONFIG_HOME" "$NO_CONFIG_HOME/.local/bin/agents" doctor > "$TEST_ROOT/no-config-doctor.txt"
assert_contains "$TEST_ROOT/no-config-doctor.txt" "skip  global config was not selected"

echo "PASS: installer, nested skills, update, and migration checks"
