#!/usr/bin/env bash
# Builds throwaway repositories with one worktree per case and checks each scan row.
set -eu

SKILL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCAN="$SKILL_ROOT/scripts/scan-worktrees.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/agents-tidy.XXXXXX")"
TEST_ROOT="$(cd "$TEST_ROOT" && pwd -P)"
SLEEPER=""
cleanup() {
  [ -z "$SLEEPER" ] || kill "$SLEEPER" 2>/dev/null || true
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

quiet_git() {
  git -c user.name=Test -c user.email=test@example.com -c init.defaultBranch=main "$@" >/dev/null 2>&1
}

ROOT="$TEST_ROOT/projects with spaces"
REPO="$ROOT/app"
TREES="$ROOT/app-worktrees"
mkdir -p "$ROOT" "$TREES"
quiet_git init --bare "$TEST_ROOT/origin.git"
quiet_git clone "$TEST_ROOT/origin.git" "$REPO"
echo one > "$REPO/file.txt"
quiet_git -C "$REPO" add file.txt
quiet_git -C "$REPO" commit -m one
quiet_git -C "$REPO" push origin HEAD:main
quiet_git -C "$REPO" remote set-head origin main

for name in merged dirty noise ahead busy gone; do
  quiet_git -C "$REPO" worktree add -b "$name" "$TREES/$name"
done
echo changed > "$TREES/dirty/file.txt"
mkdir -p "$TREES/noise/__pycache__"
touch "$TREES/noise/__pycache__/cache.pyc" "$TREES/noise/.DS_Store"
echo two > "$TREES/ahead/file.txt"
quiet_git -C "$TREES/ahead" commit -am two
rm -rf "$TREES/gone"
mkdir -p "$TREES/orphan" "$TREES/screenshots"
printf 'gitdir: %s\n' "$TEST_ROOT/missing/.git/worktrees/orphan" > "$TREES/orphan/.git"
(cd "$TREES/busy" && exec sleep 60) &
SLEEPER=$!
disown "$SLEEPER"

BEFORE="$(git -C "$REPO" worktree list --porcelain; git -C "$TREES/dirty" status --porcelain)"
/bin/bash "$SCAN" "$ROOT" > "$TEST_ROOT/scan.tsv" || fail "scan exited with $?"
AFTER="$(git -C "$REPO" worktree list --porcelain; git -C "$TREES/dirty" status --porcelain)"
[ "$BEFORE" = "$AFTER" ] || fail "scan changed repository state"

awk -F'\t' 'NF != 13 && $1 != "orphan" && $1 != "gone" && $1 != "unknown" { exit 1 }' "$TEST_ROOT/scan.tsv" \
  || fail "a checkout row lacks 13 columns"

# expect PATH COLUMN VALUE, where COLUMN is a header name.
expect() {
  local got
  got="$(awk -F'\t' -v p="$1" -v c="$2" '
    NR == 1 { for (i = 1; i <= NF; i++) col[$i] = i; next }
    $2 == p { print $(col[c]) }' "$TEST_ROOT/scan.tsv")"
  [ "$got" = "$3" ] || fail "$1: expected $2=$3, got '${got}'"
}

expect "$REPO" kind main
expect "$TREES/merged" kind worktree
expect "$TREES/merged" repo "$REPO"
expect "$TREES/merged" merged yes
expect "$TREES/merged" dirty 0
expect "$TREES/dirty" dirty 1
expect "$TREES/dirty" dirty_sample file.txt
expect "$TREES/noise" dirty 0
expect "$TREES/noise" noise 2
expect "$TREES/ahead" ahead 1
expect "$TREES/ahead" merged no
expect "$TREES/ahead" pr -
expect "$TREES/busy" procs 1
expect "$TREES/merged" procs 0
expect "$TREES/gone" kind gone
expect "$TREES/orphan" kind orphan
expect "$TREES/screenshots" kind unknown

/bin/bash "$SCAN" --depth 2 "$TREES" > "$TEST_ROOT/one.tsv"
grep -q "	$REPO	" "$TEST_ROOT/one.tsv" || fail "a root of worktrees alone does not resolve their repo"

echo "tidy scan: all checks passed"
