#!/usr/bin/env bash
# Read-only inventory of git checkouts under one or more folders, one tab-separated
# row each. Only --fetch writes anything, and then only remote-tracking refs.
# Runs on the Bash 3.2 that ships with macOS: no associative arrays or mapfile.

set -u

usage() {
  cat <<'EOF'
Usage: scan-worktrees.sh [--fetch] [--gh] [--depth N] [ROOT...]

Searches each ROOT for git checkouts. Default roots: ~/.t3/worktrees ~/Projects

  --fetch    fetch origin once per repository first, so "merged" is current
  --gh       look up the pull request of every branch with unmerged commits
  --depth N  how deep to search each root (default 4)

Columns:
  kind          main, worktree, orphan (.git link points nowhere),
                gone (registered, directory missing), or unknown
                (a folder beside worktrees that is not a checkout)
  path          the checkout
  repo          the main checkout, the place to run `git worktree` commands
  branch        the checked-out branch, or (detached)
  size_kb       disk usage
  dirty         tracked changes plus untracked files that are not build noise
  dirty_sample  up to three of those paths
  noise         untracked build noise such as __pycache__/ or node_modules/
  ahead         commits on HEAD that the default branch lacks
  merged        yes when ahead is 0
  pr            open, merged, closed, or none (with --gh); - when not looked up
  age_days      days since the last commit
  procs         processes whose working directory is inside the checkout
EOF
}

FETCH=0
GH=0
DEPTH=4
ROOTS=""
NL='
'

while [ $# -gt 0 ]; do
  case "$1" in
    --fetch) FETCH=1 ;;
    --gh) GH=1 ;;
    --depth)
      [ $# -ge 2 ] || { usage >&2; exit 2; }
      DEPTH="$2"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) ROOTS="$ROOTS$1$NL" ;;
  esac
  shift
done

if [ -z "$ROOTS" ]; then
  ROOTS="$HOME/.t3/worktrees$NL$HOME/Projects$NL"
fi

# Newline-separated sets stand in for associative arrays.
in_set() {
  case "$NL$2" in
    *"$NL$1$NL"*) return 0 ;;
  esac
  return 1
}

field() {
  printf '%s' "${1:--}" | tr '\t\n' '  '
}

row() {
  local out="" value
  for value in "$@"; do
    out="$out$(field "$value")	"
  done
  printf '%s\n' "${out%	}"
}

size_kb() {
  du -sk "$1" 2>/dev/null | awk '{print $1}'
}

# Working directories of running processes, read once.
CWDS="$(lsof -a -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
if [ -z "$CWDS" ] && [ -d /proc ]; then
  CWDS="$(for p in /proc/[0-9]*; do readlink "$p/cwd" 2>/dev/null; done)"
fi

procs_in() {
  printf '%s\n' "$CWDS" | awk -v p="$1" '$0 == p || index($0, p "/") == 1' | wc -l | tr -d ' '
}

is_noise() {
  local path="${1%\"}"
  path="${path#\"}"
  path="${path%/}"
  case "${path##*/}" in
    __pycache__|.DS_Store|node_modules|dist|build|.next|.turbo|.pytest_cache|.mypy_cache|.ruff_cache|*.pyc) return 0 ;;
  esac
  return 1
}

default_ref() {
  local ref
  ref="$(git -C "$1" symbolic-ref -q refs/remotes/origin/HEAD 2>/dev/null)"
  for ref in $ref refs/remotes/origin/main refs/remotes/origin/master refs/heads/main refs/heads/master; do
    if git -C "$1" show-ref --verify -q "$ref"; then
      printf '%s\n' "$ref"
      return 0
    fi
  done
  return 1
}

SEEN_CHECKOUTS=""
SEEN_REPOS=""
WORKTREE_PARENTS=""
GONE_ROWS=""

# Fetch once per repository and remember worktrees git can no longer find.
visit_repo() {
  local repo="$1" line path=""
  in_set "$repo" "$SEEN_REPOS" && return 0
  SEEN_REPOS="$SEEN_REPOS$repo$NL"
  if [ "$FETCH" -eq 1 ] && git -C "$repo" remote get-url origin >/dev/null 2>&1; then
    git -C "$repo" fetch --quiet origin </dev/null 2>/dev/null || echo "warning: fetch failed in $repo" >&2
  fi
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) path="${line#worktree }" ;;
      prunable*) GONE_ROWS="$GONE_ROWS$(row gone "$path" "$repo")$NL" ;;
    esac
  done <<EOF
$(git -C "$repo" worktree list --porcelain 2>/dev/null)
EOF
}

scan_checkout() {
  local dir="$1" kind gitdir common repo branch def ahead merged pr age status line entry
  local dirty=0 noise=0 sample=""

  if [ -d "$dir/.git" ]; then
    kind=main
  elif [ -f "$dir/.git" ]; then
    gitdir="$(sed -n 's/^gitdir: //p' "$dir/.git" | head -n 1)"
    case "$gitdir" in
      /*) ;;
      *) gitdir="$dir/$gitdir" ;;
    esac
    if [ ! -d "$gitdir" ]; then
      row orphan "$dir" "" "" "$(size_kb "$dir")"
      return 0
    fi
    case "$gitdir" in
      */modules/*) return 0 ;;  # a submodule belongs to its parent checkout
    esac
    kind=worktree
    WORKTREE_PARENTS="$WORKTREE_PARENTS${dir%/*}$NL"
  else
    return 0
  fi

  common="$(git -C "$dir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 0
  case "$common" in
    */.git) repo="${common%/.git}" ;;
    *) repo="$common" ;;
  esac
  visit_repo "$repo"

  branch="$(git -C "$dir" symbolic-ref --short -q HEAD)" || branch="(detached)"

  status="$(git -C "$dir" status --porcelain 2>/dev/null)"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    entry="${line:3}"
    case "$line" in
      "?? "*)
        if is_noise "$entry"; then
          noise=$((noise + 1))
          continue
        fi
        ;;
    esac
    dirty=$((dirty + 1))
    if [ "$dirty" -le 3 ]; then
      sample="${sample:+$sample, }$entry"
    fi
  done <<EOF
$status
EOF

  ahead="?"
  merged="?"
  if def="$(default_ref "$dir")"; then
    ahead="$(git -C "$dir" rev-list --count "$def..HEAD" 2>/dev/null || echo "?")"
    if [ "$ahead" = 0 ]; then merged=yes; elif [ "$ahead" != "?" ]; then merged=no; fi
  fi

  pr="-"
  if [ "$GH" -eq 1 ] && [ "$merged" = no ] && [ "$branch" != "(detached)" ]; then
    pr="$(cd "$dir" && gh pr list --head "$branch" --state all --limit 1 --json state --jq '.[0].state // "none"' </dev/null 2>/dev/null | tr 'A-Z' 'a-z')"
    pr="${pr:-?}"
  fi

  age="$(git -C "$dir" log -1 --format=%ct 2>/dev/null)"
  if [ -n "$age" ]; then
    age=$(( ($(date +%s) - age) / 86400 ))
  else
    age="?"
  fi

  row "$kind" "$dir" "$repo" "$branch" "$(size_kb "$dir")" "$dirty" "$sample" "$noise" \
    "$ahead" "$merged" "$pr" "$age" "$(procs_in "$dir")"
}

printf 'kind\tpath\trepo\tbranch\tsize_kb\tdirty\tdirty_sample\tnoise\tahead\tmerged\tpr\tage_days\tprocs\n'

while IFS= read -r root; do
  [ -n "$root" ] || continue
  if [ ! -d "$root" ]; then
    echo "warning: not a directory: $root" >&2
    continue
  fi
  root="$(cd "$root" && pwd -P)"
  while IFS= read -r gitpath; do
    [ -n "$gitpath" ] || continue
    dir="${gitpath%/.git}"
    in_set "$dir" "$SEEN_CHECKOUTS" && continue
    SEEN_CHECKOUTS="$SEEN_CHECKOUTS$dir$NL"
    scan_checkout "$dir"
  done <<EOF
$(find "$root" -maxdepth "$DEPTH" \( -name node_modules -o -name .venv -o -name target -o -name .Trash \) -prune \
  -o -name .git -print -prune 2>/dev/null | sort)
EOF
done <<EOF
$ROOTS
EOF

printf '%s' "$GONE_ROWS" | sort -u

# Folders beside worktrees that hold no checkout, such as screenshots or notes.
printf '%s' "$WORKTREE_PARENTS" | sort -u | while IFS= read -r parent; do
  [ -n "$parent" ] || continue
  for child in "$parent"/*; do
    [ -d "$child" ] || continue
    case "$NL$SEEN_CHECKOUTS" in
      *"$NL$child$NL"*|*"$NL$child/"*) continue ;;
    esac
    row unknown "$child" "" "" "$(size_kb "$child")"
  done
done
