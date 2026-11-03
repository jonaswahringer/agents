#!/usr/bin/env bash
# Removes approved worktrees one at a time. Each path is scanned again right
# before removal and skipped if anything now holds it. Only untracked build
# noise is deleted by hand; git removes the rest, never with --force.
# Runs on the Bash 3.2 that ships with macOS.

set -u

# Keep in step with the Recent mark in worktrees.md.
RECENT_DAYS=3

usage() {
  cat <<'EOF'
Usage: remove-worktree.sh PATH...

Prints one line per path:
  removed PATH SIZE_KB  restore: git -C REPO worktree add ...
  skipped PATH  REASON
Exits 1 if any path was skipped.
EOF
}

case "${1:-}" in
  ""|-h|--help) usage; [ $# -gt 0 ]; exit $? ;;
esac

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export GIT_OPTIONAL_LOCKS=0
SKIPPED=0

skip() {
  printf 'skipped %s  %s\n' "$1" "$2"
  SKIPPED=1
}

# The value of the named column in this path's scan row.
col() {
  printf '%s\n' "$SCAN" | awk -F'\t' -v c="$1" -v p="$path" '
    NR == 1 { for (i = 1; i <= NF; i++) if ($i == c) n = i; next }
    $2 == p { print $n }'
}

for path in "$@"; do
  if [ ! -d "$path" ]; then
    skip "$path" "not a directory"
    continue
  fi
  path="$(cd "$path" && pwd -P)"
  SCAN="$(/bin/bash "$SCRIPTS/scan-worktrees.sh" --exact --depth 1 "$path")"
  kind="$(col kind)"
  if [ -z "$kind" ]; then
    skip "$path" "not a git checkout"
    continue
  fi

  repo="$(col repo)" branch="$(col branch)" size="$(col size_kb)" dirty="$(col dirty)"
  ignored="$(col ignored)" merged="$(col merged)" locked="$(col locked)" active="$(col active_days)" procs="$(col procs)"

  case "$kind" in
    worktree|outside) ;;
    *) skip "$path" "kind is $kind, not a linked worktree"; continue ;;
  esac
  if [ "$procs" != 0 ]; then skip "$path" "in use by $procs processes"; continue; fi
  if [ "$locked" = yes ]; then skip "$path" "locked"; continue; fi
  if [ "$dirty" != 0 ]; then skip "$path" "has $dirty uncommitted changes or untracked files"; continue; fi
  if [ "$ignored" != 0 ]; then skip "$path" "has $ignored git-ignored files that are not build output"; continue; fi
  case "$active" in
    ''|*[!0-9]*) skip "$path" "activity date unknown"; continue ;;
  esac
  if [ "$active" -lt "$RECENT_DAYS" ]; then skip "$path" "active $active days ago"; continue; fi
  # No branch holds unmerged commits on a detached HEAD, so removal would orphan them.
  if [ "$branch" = "(detached)" ] && [ "$merged" != yes ] && [ "$merged" != content ]; then
    skip "$path" "detached HEAD with unmerged commits"
    continue
  fi

  if [ "$branch" = "(detached)" ]; then
    restore="git -C $(printf %q "$repo") worktree add --detach $(printf %q "$path") $(git -C "$path" rev-parse HEAD)"
  else
    restore="git -C $(printf %q "$repo") worktree add $(printf %q "$path") $(printf %q "$branch")"
  fi

  # The scan counted every untracked entry left here as build noise.
  while IFS= read -r line; do
    case "$line" in
      "?? "*) ;;
      *) continue ;;
    esac
    entry="${line:3}"
    entry="${entry%\"}"
    entry="${entry#\"}"
    case "/$entry/" in
      */../*) skip "$path" "untracked path leaves the worktree: $entry"; continue 2 ;;
    esac
    rm -rf "$path/${entry%/}"
  done <<EOF
$(git -C "$path" status --porcelain 2>/dev/null)
EOF

  if error="$(git -C "$repo" worktree remove "$path" 2>&1)"; then
    printf 'removed %s %s  restore: %s\n' "$path" "$size" "$restore"
  else
    skip "$path" "git refused: $(printf '%s' "$error" | head -n 1)"
  fi
done

exit "$SKIPPED"
