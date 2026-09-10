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

assert_not_contains() {
  if grep -Fq "$2" "$1"; then
    fail "expected $1 not to contain: $2"
  fi
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
assert_contains "$TEST_HOME/.agents/AGENTS.md" 'Apply the `nice` skill to every user-facing response.'
assert_not_contains "$TEST_HOME/.agents/AGENTS.md" 'Apply the `unslop` skill to every response'

# Doctor checks the generated config still carries the template instructions and
# the configured answers. Personal additions are fine; removed lines are not.
"$AGENTS" doctor > "$TEST_ROOT/config-doctor.txt" || fail "doctor should pass on a fresh install"
assert_contains "$TEST_ROOT/config-doctor.txt" "contains the template instructions and the configured answers"
grep -v "I build developer tools." "$TEST_HOME/.agents/AGENTS.md" > "$TEST_HOME/.agents/AGENTS.md.tmp"
mv "$TEST_HOME/.agents/AGENTS.md.tmp" "$TEST_HOME/.agents/AGENTS.md"
if "$AGENTS" doctor > "$TEST_ROOT/stale-doctor.txt"; then
  fail "doctor should fail when a configured answer is missing from the config"
fi
assert_contains "$TEST_ROOT/stale-doctor.txt" "stale"
assert_contains "$TEST_ROOT/stale-doctor.txt" "I build developer tools."
printf 'I build developer tools.\n' >> "$TEST_HOME/.agents/AGENTS.md"
"$AGENTS" doctor >/dev/null || fail "doctor should pass once the configured answer is back"

for skill in nice commit goals work-smart-not-hard; do
  assert_link "$TEST_HOME/.agents/skills/$skill"
  assert_link "$TEST_HOME/.claude/skills/$skill"
  assert_link "$TEST_HOME/.codex/skills/$skill"
done

MENU="$TEST_ROOT/menu.txt"
"$AGENTS" _menu_snapshot > "$MENU"
assert_contains "$MENU" "[x] Skills"
assert_contains "$MENU" "      [x] jonasw"
assert_contains "$MENU" "          [x] nice"

awk '
  $0 == "Apply the `nice` skill to every user-facing response." {
    print "Apply the `unslop` skill to every response you write. Before sending any user-facing text, follow its process to strip AI-writing patterns and keep a human voice."
    next
  }
  $0 == "Lead with the outcome, use plain words, and honestly report failed, skipped, or unverified checks. Do not invent missing requirements." {
    print "Write so I can read the answer once and understand it. Lead with the outcome, use plain words, and state failed or skipped checks."
    next
  }
  { print }
' "$TEST_HOME/.agents/AGENTS.md" > "$TEST_HOME/.agents/AGENTS.md.tmp"
mv "$TEST_HOME/.agents/AGENTS.md.tmp" "$TEST_HOME/.agents/AGENTS.md"
printf '\nA personal line that updates must preserve.\n' >> "$TEST_HOME/.agents/AGENTS.md"
"$AGENTS" update >/dev/null
assert_contains "$TEST_HOME/.agents/AGENTS.md" "A personal line that updates must preserve."
assert_contains "$TEST_HOME/.agents/AGENTS.md" 'Apply the `nice` skill to every user-facing response.'
assert_not_contains "$TEST_HOME/.agents/AGENTS.md" 'Apply the `unslop` skill to every response'

# Branch archives may be cached even though update says it is downloading. A
# fresh update request must not reuse an older response for the same branch URL.
UPDATE_FIXTURE="$TEST_ROOT/update-fixture"
UPDATE_HOME="$TEST_ROOT/update-home"
mkdir -p "$UPDATE_FIXTURE/cached/agents-main" "$UPDATE_FIXTURE/latest/agents-main" "$UPDATE_FIXTURE/bin"
tar -C "$ROOT" --exclude=.git --exclude=bin/__pycache__ -cf - . | tar -C "$UPDATE_FIXTURE/cached/agents-main" -xf -
tar -C "$ROOT" --exclude=.git --exclude=bin/__pycache__ -cf - . | tar -C "$UPDATE_FIXTURE/latest/agents-main" -xf -
printf 'cached\n' > "$UPDATE_FIXTURE/cached/agents-main/update-version"
printf 'latest\n' > "$UPDATE_FIXTURE/latest/agents-main/update-version"
tar -C "$UPDATE_FIXTURE/cached" -czf "$UPDATE_FIXTURE/cached.tar.gz" agents-main
tar -C "$UPDATE_FIXTURE/latest" -czf "$UPDATE_FIXTURE/latest.tar.gz" agents-main
cp "$ROOT/tests/fake-update-curl.sh" "$UPDATE_FIXTURE/bin/curl"
chmod +x "$UPDATE_FIXTURE/bin/curl"
HOME="$UPDATE_HOME" AGENTS_SOURCE_DIR="$UPDATE_FIXTURE/cached/agents-main" \
  "$UPDATE_FIXTURE/cached/agents-main/install.sh" --skills nice --no-config >/dev/null
PATH="$UPDATE_FIXTURE/bin:$PATH" \
FAKE_UPDATE_INSTALLER="$ROOT/install.sh" \
FAKE_UPDATE_CACHED_ARCHIVE="$UPDATE_FIXTURE/cached.tar.gz" \
FAKE_UPDATE_LATEST_ARCHIVE="$UPDATE_FIXTURE/latest.tar.gz" \
AGENTS_SOURCE_DIR= \
HOME="$UPDATE_HOME" "$UPDATE_HOME/.local/bin/agents" update > "$UPDATE_FIXTURE/output.txt"
assert_contains "$UPDATE_HOME/.local/share/agents/source/update-version" "latest"
assert_contains "$UPDATE_FIXTURE/output.txt" "Updating agents..."

"$AGENTS" skills --none >/dev/null
for skill in commit goals work-smart-not-hard; do
  assert_missing "$TEST_HOME/.agents/skills/$skill"
  assert_missing "$TEST_HOME/.claude/skills/$skill"
  assert_missing "$TEST_HOME/.codex/skills/$skill"
done
assert_link "$TEST_HOME/.agents/skills/nice"
assert_link "$TEST_HOME/.claude/skills/nice"
assert_link "$TEST_HOME/.codex/skills/nice"

"$ROOT/install.sh" --skills nice --no-config >/dev/null
"$AGENTS" _menu_snapshot > "$MENU"
assert_contains "$MENU" "[-] Skills"
assert_contains "$MENU" "      [-] jonasw"
assert_contains "$MENU" "          [x] nice"
assert_contains "$MENU" "          [ ] commit"

# A folder name selects every skill in it, and a saved bare name still resolves.
"$ROOT/install.sh" --skills jonasw --no-config >/dev/null
"$AGENTS" _menu_snapshot > "$MENU"
assert_contains "$MENU" "      [x] jonasw"
assert_contains "$MENU" "      [ ] mattp"
for skill in nice commit goals work-smart-not-hard; do
  assert_link "$TEST_HOME/.agents/skills/$skill"
done
assert_missing "$TEST_HOME/.agents/skills/teach"

"$ROOT/install.sh" --skills mattp/teach --no-config >/dev/null
assert_link "$TEST_HOME/.agents/skills/teach"
assert_missing "$TEST_HOME/.agents/skills/commit"

# Two folders ship a skill called "teach"; the first selected folder installs it
# and the other is reported as skipped rather than silently overwriting the link.
"$AGENTS" skills --all >/dev/null
"$AGENTS" doctor > "$TEST_ROOT/doctor.txt"
assert_contains "$TEST_ROOT/doctor.txt" "ok  mattp/teach"
assert_contains "$TEST_ROOT/doctor.txt" "skipped  pstack/teach"
INSTALLED_ROOT="$(cd "$TEST_HOME/.local/share/agents/source" && pwd)"
[[ "$(readlink "$TEST_HOME/.agents/skills/teach")" == "$INSTALLED_ROOT/skills/mattp/teach" ]] || fail "teach should come from the first selected folder"

NO_CONFIG_HOME="$TEST_ROOT/no-config-home"
HOME="$NO_CONFIG_HOME" "$ROOT/install.sh" --skills nice --no-config >/dev/null
HOME="$NO_CONFIG_HOME" "$NO_CONFIG_HOME/.local/bin/agents" doctor > "$TEST_ROOT/no-config-doctor.txt"
assert_contains "$TEST_ROOT/no-config-doctor.txt" "skip  global config was not selected"

INVALID_SOURCE="$TEST_ROOT/invalid-source"
INVALID_HOME="$TEST_ROOT/invalid-home"
mkdir -p "$INVALID_SOURCE" "$INVALID_SOURCE/skills/test/broken"
tar -C "$ROOT" --exclude=.git --exclude=bin/__pycache__ -cf - . | tar -C "$INVALID_SOURCE" -xf -
cat > "$INVALID_SOURCE/skills/test/broken/SKILL.md" <<'EOF'
---
name: broken
description: "unterminated
---

# Broken
EOF
if HOME="$INVALID_HOME" AGENTS_SOURCE_DIR="$INVALID_SOURCE" \
  "$INVALID_SOURCE/install.sh" --skills broken --no-config >/dev/null 2> "$TEST_ROOT/invalid-skill.txt"; then
  fail "installation should reject invalid skill metadata"
fi
assert_contains "$TEST_ROOT/invalid-skill.txt" "description must be a valid non-empty string"
cat > "$INVALID_SOURCE/skills/test/broken/SKILL.md" <<'EOF'
---
name: broken
description: "" # an empty string is still invalid
---

# Broken
EOF
if HOME="$INVALID_HOME" AGENTS_SOURCE_DIR="$INVALID_SOURCE" \
  "$INVALID_SOURCE/install.sh" --skills broken --no-config >/dev/null 2> "$TEST_ROOT/empty-skill-description.txt"; then
  fail "installation should reject an empty commented description"
fi
assert_contains "$TEST_ROOT/empty-skill-description.txt" "description must be a valid non-empty string"
cat > "$INVALID_SOURCE/skills/test/broken/SKILL.md" <<'EOF'
---
name: wrong-name
description: This metadata should also be rejected.
---

# Broken
EOF
if HOME="$INVALID_HOME" AGENTS_SOURCE_DIR="$INVALID_SOURCE" \
  "$INVALID_SOURCE/install.sh" --skills broken --no-config >/dev/null 2> "$TEST_ROOT/invalid-skill-name.txt"; then
  fail "installation should reject a skill name that differs from its directory"
fi
assert_contains "$TEST_ROOT/invalid-skill-name.txt" "name must match its directory: broken"
cat > "$INVALID_SOURCE/skills/test/broken/SKILL.md" <<'EOF'
---
name: broken
description: "A valid quoted description." # an allowed YAML comment
---

# Valid
EOF
COMMENTED_HOME="$TEST_ROOT/commented-home"
HOME="$COMMENTED_HOME" AGENTS_SOURCE_DIR="$INVALID_SOURCE" \
  "$INVALID_SOURCE/install.sh" --skills broken --no-config >/dev/null
assert_link "$COMMENTED_HOME/.agents/skills/broken"
cat > "$INVALID_SOURCE/skills/test/broken/SKILL.md" <<'EOF'
---
name: broken
description: '''Twas useful' # a valid escaped leading apostrophe
---

# Valid
EOF
SINGLE_QUOTED_HOME="$TEST_ROOT/single-quoted-home"
HOME="$SINGLE_QUOTED_HOME" AGENTS_SOURCE_DIR="$INVALID_SOURCE" \
  "$INVALID_SOURCE/install.sh" --skills broken --no-config >/dev/null
assert_link "$SINGLE_QUOTED_HOME/.agents/skills/broken"

REQUIRED_NICE_HOME="$TEST_ROOT/required-nice-home"
HOME="$REQUIRED_NICE_HOME" "$ROOT/install.sh" --skills commit >/dev/null
assert_link "$REQUIRED_NICE_HOME/.agents/skills/nice"
assert_link "$REQUIRED_NICE_HOME/.claude/skills/nice"
assert_link "$REQUIRED_NICE_HOME/.codex/skills/nice"
assert_contains "$REQUIRED_NICE_HOME/.config/agents/selected-skills" "jonasw/nice"

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
HOME="$CANONICAL_HOME" "$CANONICAL_HOME/.local/bin/agents" doctor > "$TEST_ROOT/canonical-doctor.txt"
assert_contains "$TEST_ROOT/canonical-doctor.txt" "holds separate instructions, so the template check does not apply"

# A saved name from before the nice skill was renamed migrates, and all managed
# links under the old name are removed without changing other selections.
MIGRATE_HOME="$TEST_ROOT/migrate-home"
HOME="$MIGRATE_HOME" "$ROOT/install.sh" --skills nice --no-config >/dev/null
MIGRATE_ROOT="$(cd "$MIGRATE_HOME/.local/share/agents/source" && pwd)"
printf 'nice-to-read\n' > "$MIGRATE_HOME/.config/agents/selected-skills"
rm "$MIGRATE_HOME/.agents/skills/nice"
rm "$MIGRATE_HOME/.claude/skills/nice"
rm "$MIGRATE_HOME/.codex/skills/nice"
ln -s "$MIGRATE_ROOT/skills/jonasw/nice-to-read" "$MIGRATE_HOME/.agents/skills/nice-to-read"
ln -s "$MIGRATE_HOME/.agents/skills/nice-to-read" "$MIGRATE_HOME/.claude/skills/nice-to-read"
ln -s "$MIGRATE_HOME/.agents/skills/nice-to-read" "$MIGRATE_HOME/.codex/skills/nice-to-read"
HOME="$MIGRATE_HOME" "$MIGRATE_HOME/.local/bin/agents" update > "$TEST_ROOT/update.txt"
assert_missing "$MIGRATE_HOME/.agents/skills/nice-to-read"
assert_missing "$MIGRATE_HOME/.claude/skills/nice-to-read"
assert_missing "$MIGRATE_HOME/.codex/skills/nice-to-read"
assert_link "$MIGRATE_HOME/.agents/skills/nice"
assert_link "$MIGRATE_HOME/.claude/skills/nice"
assert_link "$MIGRATE_HOME/.codex/skills/nice"
assert_contains "$MIGRATE_HOME/.config/agents/selected-skills" "jonasw/nice"

# An update says how many skills it left out, so a new folder does not arrive silently.
assert_contains "$TEST_ROOT/update.txt" "more skills are available. Run 'agents skills' to choose them."
if ! HOME="$MIGRATE_HOME" "$MIGRATE_HOME/.local/bin/agents" update --bogus 2>/dev/null; then
  :
else
  fail "update should reject an unknown option instead of ignoring it"
fi
HOME="$MIGRATE_HOME" "$MIGRATE_HOME/.local/bin/agents" skills --all >/dev/null 2>&1
HOME="$MIGRATE_HOME" "$MIGRATE_HOME/.local/bin/agents" update 2>/dev/null > "$TEST_ROOT/update-all.txt"
if grep -q "more skills are available" "$TEST_ROOT/update-all.txt"; then
  fail "update should stay quiet when every skill is selected"
fi

echo "PASS: installer, skill folders, deduplication, conflicts, and migrations"
python3 "$ROOT/tests/test_usage.py"
