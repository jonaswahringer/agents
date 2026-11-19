#!/usr/bin/env bash
# Builds a throwaway repository and checks the area totals loc.sh prints.
set -eu

SKILL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOC="$SKILL_ROOT/scripts/loc.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/agents-viz-changeset.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

quiet_git() {
  git -c user.name=Test -c user.email=test@example.com -c init.defaultBranch=main "$@" >/dev/null 2>&1
}

expect_row() {
  printf '%s\n' "$1" | grep -qxF "$2" || fail "missing row '$2' in:
$1"
}

REPO="$TEST_ROOT/repo with spaces"
mkdir -p "$REPO/src/app" "$REPO/docs"
quiet_git init "$REPO"
printf 'a\nb\nc\n' > "$REPO/src/app/main.js"
printf 'readme\n' > "$REPO/README.md"
quiet_git -C "$REPO" add .
quiet_git -C "$REPO" commit -m base
quiet_git -C "$REPO" checkout -b feature

# Committed on the branch: one line changed, two added.
printf 'a\nB\nc\nd\ne\n' > "$REPO/src/app/main.js"
printf '{}\n' > "$REPO/src/app/package-lock.json"
quiet_git -C "$REPO" add .
quiet_git -C "$REPO" commit -m feature
# Uncommitted and untracked, including a binary file and a spaced name.
printf 'readme\nmore\n' > "$REPO/README.md"
printf 'one\ntwo\n' > "$REPO/docs/new guide.md"
printf '\000\001\002' > "$REPO/docs/logo.bin"

out="$(cd "$REPO" && "$LOC")"
expect_row "$out" "$(printf 'src\t3\t1\t1')"
expect_row "$out" "$(printf 'docs\t2\t0\t2')"
expect_row "$out" "$(printf '(root)\t1\t0\t1')"
expect_row "$out" "$(printf '(lockfiles)\t1\t0\t1')"
[ "$(printf '%s\n' "$out" | tail -n 1)" = "$(printf 'total\t7\t1\t5')" ] || fail "total should be last: $out"
[ "$(printf '%s\n' "$out" | head -n 1 | cut -f 1)" = "src" ] || fail "largest area should be first: $out"

out="$(cd "$REPO/src" && "$LOC" -d 2 main)"
expect_row "$out" "$(printf 'src/app\t3\t1\t1')"

(cd "$REPO" && "$LOC" -d 0 >/dev/null 2>&1) && fail "depth 0 should be rejected"
(cd "$REPO" && "$LOC" no-such-ref >/dev/null 2>&1) && fail "an unknown base should be rejected"

echo "viz-changeset: ok"
