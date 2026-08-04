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

mkdir -p "$TEST_HOME/.claude" "$TEST_HOME/.codex"
printf '<!-- Managed by agents. Run `agents configure` to regenerate this file. -->\n\nOld generated Claude config.\n' > "$TEST_HOME/.claude/CLAUDE.md"
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
assert_link "$TEST_HOME/.claude/CLAUDE.md"
assert_link "$TEST_HOME/.codex/AGENTS.md"
assert_file "$TEST_HOME/.claude/CLAUDE.md.backup-"* 2>/dev/null || fail "expected the managed Claude config to be backed up"
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

DEDUP_HOME="$TEST_ROOT/dedup-home"
HOME="$DEDUP_HOME" "$ROOT/install.sh" --all --force >/dev/null
rm "$DEDUP_HOME/.claude/CLAUDE.md"
cp "$DEDUP_HOME/.agents/AGENTS.md" "$DEDUP_HOME/.claude/CLAUDE.md"
HOME="$DEDUP_HOME" "$DEDUP_HOME/.local/bin/agents" update >/dev/null
assert_link "$DEDUP_HOME/.claude/CLAUDE.md"
if find "$DEDUP_HOME/.claude" -maxdepth 1 -name 'CLAUDE.md.backup-*' | grep -q .; then
  fail "a byte-for-byte duplicate should not create a backup"
fi

ln -s "$DEDUP_HOME/.agents/AGENTS.md" "$DEDUP_HOME/shared-global-config"
rm "$DEDUP_HOME/.claude/CLAUDE.md"
ln -s ../shared-global-config "$DEDUP_HOME/.claude/CLAUDE.md"
HOME="$DEDUP_HOME" "$DEDUP_HOME/.local/bin/agents" update >/dev/null
[[ "$(readlink "$DEDUP_HOME/.claude/CLAUDE.md")" == "../shared-global-config" ]] || fail "an equivalent relative link should be kept"

CONFLICT_HOME="$TEST_ROOT/conflict-home"
mkdir -p "$CONFLICT_HOME/.claude" "$CONFLICT_HOME/.codex"
printf 'Claude-only instructions.\n' > "$CONFLICT_HOME/.claude/CLAUDE.md"
ln -s "$CONFLICT_HOME/missing-config" "$CONFLICT_HOME/.codex/AGENTS.md"
HOME="$CONFLICT_HOME" "$ROOT/install.sh" --all >/dev/null 2> "$TEST_ROOT/conflicts.txt"
assert_contains "$CONFLICT_HOME/.claude/CLAUDE.md" "Claude-only instructions."
[[ "$(readlink "$CONFLICT_HOME/.codex/AGENTS.md")" == "$CONFLICT_HOME/missing-config" ]] || fail "a conflicting broken link should be kept"
if HOME="$CONFLICT_HOME" "$CONFLICT_HOME/.local/bin/agents" doctor >/dev/null; then
  fail "doctor should report separate config files as conflicts"
fi
HOME="$CONFLICT_HOME" "$CONFLICT_HOME/.local/bin/agents" configure --non-interactive --force >/dev/null
assert_link "$CONFLICT_HOME/.claude/CLAUDE.md"
assert_link "$CONFLICT_HOME/.codex/AGENTS.md"
assert_file "$CONFLICT_HOME/.claude/CLAUDE.md.backup-"*
assert_link "$CONFLICT_HOME/.codex/AGENTS.md.backup-"*

DIRECTORY_HOME="$TEST_ROOT/directory-home"
mkdir -p "$DIRECTORY_HOME/.claude/CLAUDE.md"
if HOME="$DIRECTORY_HOME" "$ROOT/install.sh" --all --force >/dev/null 2> "$TEST_ROOT/directory-error.txt"; then
  fail "a config directory conflict should stop installation"
fi
[[ -d "$DIRECTORY_HOME/.claude/CLAUDE.md" ]] || fail "the conflicting directory should be preserved"
assert_contains "$TEST_ROOT/directory-error.txt" "is a directory"

CANONICAL_HOME="$TEST_ROOT/canonical-home"
mkdir -p "$CANONICAL_HOME/.agents"
printf 'My existing canonical instructions.\n' > "$CANONICAL_HOME/.agents/AGENTS.md"
HOME="$CANONICAL_HOME" "$ROOT/install.sh" --all >/dev/null 2> "$TEST_ROOT/canonical-conflict.txt"
assert_contains "$CANONICAL_HOME/.agents/AGENTS.md" "My existing canonical instructions."
assert_link "$CANONICAL_HOME/.claude/CLAUDE.md"
assert_link "$CANONICAL_HOME/.codex/AGENTS.md"
HOME="$CANONICAL_HOME" "$CANONICAL_HOME/.local/bin/agents" doctor >/dev/null

echo "PASS: installer, nested skills, deduplication, conflicts, and migrations"
