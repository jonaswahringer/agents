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

OLD_DATE="2020-01-01T00:00:00"
old_git() {
  GIT_AUTHOR_DATE="$OLD_DATE" GIT_COMMITTER_DATE="$OLD_DATE" quiet_git "$@"
}

ROOT="$TEST_ROOT/projects with spaces"
REPO="$ROOT/app"
TREES="$ROOT/app-worktrees"
mkdir -p "$ROOT" "$TREES" "$TEST_ROOT/elsewhere"
quiet_git init --bare "$TEST_ROOT/origin.git"
quiet_git clone "$TEST_ROOT/origin.git" "$REPO"
printf 'one\n' > "$REPO/file.txt"
printf 'a\n' > "$REPO/later.txt"
printf '.env\nnode_modules/\n' > "$REPO/.gitignore"
quiet_git -C "$REPO" add .
quiet_git -C "$REPO" commit -m one
quiet_git -C "$REPO" push origin HEAD:main
quiet_git -C "$REPO" remote set-head origin main
printf 'SECRET=main\n' > "$REPO/.env"

for name in merged dirty noise ahead busy gone envcopy envunique squashed later pushed nopr; do
  quiet_git -C "$REPO" worktree add -b "$name" "$TREES/$name"
done
old_git -C "$REPO" worktree add -b old "$TREES/old"
old_git -C "$TREES/old" commit --allow-empty -m old
# Checked out today on a commit from 2020: activity comes from the checkout, not the commit.
quiet_git -C "$REPO" worktree add -b revived "$TREES/revived" old
quiet_git -C "$REPO" worktree add -b outside "$TEST_ROOT/elsewhere/outside"

echo changed > "$TREES/dirty/file.txt"
mkdir -p "$TREES/noise/__pycache__" "$TREES/noise/node_modules/pkg"
touch "$TREES/noise/.DS_Store"
# Real content, so build_kb has sizes to add up: 40 KB untracked, 80 KB ignored.
head -c 40960 /dev/zero > "$TREES/noise/__pycache__/cache.pyc"
head -c 81920 /dev/zero > "$TREES/noise/node_modules/pkg/index.js"
echo two > "$TREES/ahead/file.txt"
quiet_git -C "$TREES/ahead" commit -am two
echo three > "$TREES/nopr/file.txt"
quiet_git -C "$TREES/nopr" commit -am three
cp "$REPO/.env" "$TREES/envcopy/.env"
printf 'SECRET=only-here\n' > "$TREES/envunique/.env"

# Squash-merge two branches, then change one of them again on main.
for name in squashed later; do
  printf '%s\n' "$name" > "$TREES/$name/$name.txt"
  quiet_git -C "$TREES/$name" add .
  quiet_git -C "$TREES/$name" commit -m "$name"
done
printf 'b\n' > "$TREES/later/later.txt"
quiet_git -C "$TREES/later" commit -am "later edit"
quiet_git -C "$REPO" merge --squash squashed
quiet_git -C "$REPO" commit -m "Squash squashed"
quiet_git -C "$REPO" merge --squash later
quiet_git -C "$REPO" commit -m "Squash later"
printf 'c\n' > "$REPO/later.txt"
quiet_git -C "$REPO" commit -am "Change later.txt again"
quiet_git -C "$REPO" push origin HEAD:main

echo pushed > "$TREES/pushed/file.txt"
quiet_git -C "$TREES/pushed" commit -am pushed
quiet_git -C "$TREES/pushed" push origin pushed

rm -rf "$TREES/gone"
mkdir -p "$TREES/orphan" "$TREES/screenshots"
printf 'gitdir: %s\n' "$TEST_ROOT/missing/.git/worktrees/orphan" > "$TREES/orphan/.git"
(cd "$TREES/busy" && exec sleep 60) &
SLEEPER=$!
disown "$SLEEPER"

# A second repository whose origin is unreachable.
quiet_git init "$ROOT/lost"
quiet_git -C "$ROOT/lost" commit --allow-empty -m lost
quiet_git -C "$ROOT/lost" remote add origin "$TEST_ROOT/missing-origin.git"
quiet_git init "$ROOT/local"
quiet_git -C "$ROOT/local" commit --allow-empty -m local

BEFORE="$(git -C "$REPO" worktree list --porcelain; git -C "$TREES/dirty" status --porcelain)"
INDEX="$(git -C "$TREES/dirty" rev-parse --path-format=absolute --git-dir)/index"
touch -t 202001010000 "$INDEX"
touch -t 202001010001 "$TEST_ROOT/marker"
/bin/bash "$SCAN" "$ROOT" > "$TEST_ROOT/scan.tsv" || fail "scan exited with $?"
[ -z "$(find "$INDEX" -newer "$TEST_ROOT/marker")" ] || fail "scan rewrote a worktree index"
AFTER="$(git -C "$REPO" worktree list --porcelain; GIT_OPTIONAL_LOCKS=0 git -C "$TREES/dirty" status --porcelain)"
[ "$BEFORE" = "$AFTER" ] || fail "scan changed repository state"

awk -F'\t' 'NF != 19 && $1 != "orphan" && $1 != "gone" && $1 != "unknown" { exit 1 }' "$TEST_ROOT/scan.tsv" \
  || fail "a checkout row lacks 19 columns"

# expect PATH COLUMN VALUE, where COLUMN is a header name.
expect() {
  local got
  got="$(awk -F'\t' -v p="$1" -v c="$2" '
    NR == 1 { for (i = 1; i <= NF; i++) col[$i] = i; next }
    $2 == p { print $(col[c]) }' "${4:-$TEST_ROOT/scan.tsv}")"
  [ "$got" = "$3" ] || fail "$1: expected $2=$3, got '${got}'"
}

expect "$REPO" kind main
expect "$TREES/merged" kind worktree
expect "$TREES/merged" repo "$REPO"
expect "$TREES/merged" merged yes
expect "$TREES/merged" dirty 0
expect "$TREES/merged" ignored 0
expect "$TREES/merged" active_days 0
expect "$TREES/revived" active_days 0
expect "$TREES/dirty" dirty 1
expect "$TREES/dirty" dirty_sample file.txt
expect "$TREES/noise" dirty 0
expect "$TREES/noise" noise 3
expect "$TREES/merged" build_kb 0
noise_kb="$(du -sk "$TREES/noise/__pycache__" "$TREES/noise/.DS_Store" "$TREES/noise/node_modules" | awk '{ n += $1 } END { print n }')"
[ "$noise_kb" -ge 120 ] || fail "test setup: build noise is only ${noise_kb} KB"
expect "$TREES/noise" build_kb "$noise_kb"
expect "$TREES/noise" ignored 0
expect "$TREES/envcopy" ignored 0
expect "$TREES/envunique" ignored 1
expect "$TREES/envunique" ignored_sample .env
expect "$TREES/ahead" ahead 1
expect "$TREES/ahead" merged no
expect "$TREES/ahead" pushed no
expect "$TREES/ahead" pr -
expect "$TREES/squashed" merged content
expect "$TREES/later" merged no
expect "$TREES/old" merged content
expect "$TREES/pushed" merged no
expect "$TREES/pushed" pushed yes
expect "$TREES/merged" remote skipped
expect "$ROOT/lost" remote skipped
expect "$ROOT/local" remote none
expect "$TREES/busy" procs 1
expect "$TREES/merged" procs 0
expect "$TEST_ROOT/elsewhere/outside" kind outside
expect "$TREES/gone" kind gone
expect "$TREES/orphan" kind orphan
expect "$TREES/screenshots" kind unknown
expect "$TREES/merged" locked no

old_days="$(awk -F'\t' -v p="$TREES/old" 'NR == 1 { for (i = 1; i <= NF; i++) if ($i == "active_days") n = i } $2 == p { print $n }' "$TEST_ROOT/scan.tsv")"
[ "${old_days:-0}" -gt 1000 ] || fail "$TREES/old: expected active_days above 1000, got '$old_days'"

/bin/bash "$SCAN" --fetch "$ROOT" > "$TEST_ROOT/fetch.tsv" 2>/dev/null
expect "$TREES/merged" remote fresh "$TEST_ROOT/fetch.tsv"
expect "$ROOT/lost" remote stale "$TEST_ROOT/fetch.tsv"

# A fake gh answers `gh pr list --head BRANCH` from prs/BRANCH, already in the --jq format.
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/prs"
cat > "$TEST_ROOT/bin/gh" <<'GH'
#!/bin/sh
while [ $# -gt 0 ]; do
  if [ "$1" = --head ]; then cat "$PRS/$2" 2>/dev/null; exit 0; fi
  shift
done
GH
chmod +x "$TEST_ROOT/bin/gh"
echo "OPEN $(git -C "$TREES/ahead" rev-parse HEAD)" > "$TEST_ROOT/prs/ahead"
echo "MERGED $(git -C "$TREES/pushed" rev-parse HEAD)" > "$TEST_ROOT/prs/pushed"
echo "MERGED $(git -C "$TREES/later" rev-parse HEAD~1)" > "$TEST_ROOT/prs/later"
PATH="$TEST_ROOT/bin:$PATH" PRS="$TEST_ROOT/prs" /bin/bash "$SCAN" --gh "$ROOT" > "$TEST_ROOT/gh.tsv"
expect "$TREES/ahead" pr open "$TEST_ROOT/gh.tsv"
expect "$TREES/pushed" pr merged "$TEST_ROOT/gh.tsv"
expect "$TREES/later" pr diverged "$TEST_ROOT/gh.tsv"
expect "$TREES/nopr" pr none "$TEST_ROOT/gh.tsv"
expect "$TREES/squashed" pr - "$TEST_ROOT/gh.tsv"

/bin/bash "$SCAN" --depth 2 "$TREES" > "$TEST_ROOT/one.tsv"
grep -q "	$REPO	" "$TEST_ROOT/one.tsv" || fail "a root of worktrees alone does not resolve their repo"


/bin/bash "$SCAN" --exact "$ROOT" > "$TEST_ROOT/exact.tsv"
! grep -q -e '^outside' -e '^gone' -e '^unknown' "$TEST_ROOT/exact.tsv" || fail "--exact lists rows outside the roots"

# Removal runs on a repository dated 2020, so its worktrees are not recent.
REMOVE="$SKILL_ROOT/scripts/remove-worktree.sh"
STALE="$TEST_ROOT/stale repo"
STALE_TREES="$TEST_ROOT/stale-trees"
old_git init "$STALE"
printf '.env\nnode_modules/\n' > "$STALE/.gitignore"
old_git -C "$STALE" add .
old_git -C "$STALE" commit -m base
for name in noise dirty env locked busy; do
  old_git -C "$STALE" worktree add -b "$name" "$STALE_TREES/$name"
done
old_git -C "$STALE" worktree add --detach "$STALE_TREES/detached"
echo only-here > "$STALE_TREES/detached/work.txt"
old_git -C "$STALE_TREES/detached" add work.txt
old_git -C "$STALE_TREES/detached" commit -m "only here"
quiet_git -C "$STALE" worktree add -b fresh "$STALE_TREES/fresh"
mkdir -p "$STALE_TREES/noise/__pycache__" "$STALE_TREES/noise/node_modules/pkg"
touch "$STALE_TREES/noise/__pycache__/cache.pyc" "$STALE_TREES/noise/node_modules/pkg/index.js"
echo changed > "$STALE_TREES/dirty/.gitignore"
printf 'SECRET=only-here\n' > "$STALE_TREES/env/.env"
quiet_git -C "$STALE" worktree lock "$STALE_TREES/locked"
(cd "$STALE_TREES/busy" && exec sleep 60) &
BUSY=$!
disown "$BUSY"

/bin/bash "$SCAN" --exact "$STALE_TREES" > "$TEST_ROOT/stale.tsv"
expect "$STALE_TREES/locked" locked yes "$TEST_ROOT/stale.tsv"

/bin/bash "$REMOVE" "$STALE_TREES/noise" > "$TEST_ROOT/removed.txt" || fail "removing a stale worktree with only build noise exited non-zero"
[ ! -e "$STALE_TREES/noise" ] || fail "the stale worktree with only build noise is still there"
git -C "$STALE" show-ref --verify -q refs/heads/noise || fail "removal deleted the branch"
restore="$(sed -n 's/.*restore: //p' "$TEST_ROOT/removed.txt")"
eval "$restore" >/dev/null 2>&1 || fail "the printed restore command failed: $restore"
[ -d "$STALE_TREES/noise" ] || fail "the restore command did not bring the worktree back"

set +e
/bin/bash "$REMOVE" "$STALE_TREES/dirty" "$STALE_TREES/env" "$STALE_TREES/locked" "$STALE_TREES/busy" \
  "$STALE_TREES/detached" "$STALE_TREES/fresh" "$STALE" "$STALE_TREES/missing" > "$TEST_ROOT/skipped.txt"
status=$?
set -e
kill "$BUSY" 2>/dev/null || true
[ "$status" -eq 1 ] || fail "skipped removals exited with $status, expected 1"

skipped() {
  grep -q "^skipped $1  $2" "$TEST_ROOT/skipped.txt" || fail "$1: expected skip reason '$2', got: $(grep -F "$1" "$TEST_ROOT/skipped.txt")"
  [ -e "$1" ] || [ "$1" = "$STALE_TREES/missing" ] || fail "$1 was skipped but deleted"
}
skipped "$STALE_TREES/dirty" "has 1 uncommitted"
skipped "$STALE_TREES/env" "has 1 git-ignored"
skipped "$STALE_TREES/locked" "locked"
skipped "$STALE_TREES/busy" "in use"
skipped "$STALE_TREES/detached" "detached HEAD"
skipped "$STALE_TREES/fresh" "active 0 days ago"
skipped "$STALE" "kind is main"
skipped "$STALE_TREES/missing" "not a directory"

echo "tidy scan and removal: all checks passed"
