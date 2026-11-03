#!/usr/bin/env bash
# Inventory of git checkouts under one or more folders, one tab-separated row each.
# It leaves work trees, indexes, and refs alone. Only --fetch updates
# remote-tracking refs, and the merge check may add unreferenced tree objects,
# which git gc removes.
# Runs on the Bash 3.2 that ships with macOS: no associative arrays or mapfile.

set -u

usage() {
  cat <<'EOF'
Usage: scan-worktrees.sh [--fetch] [--gh] [--depth N] [--exact] [ROOT...]

Searches each ROOT for git checkouts, then adds every other worktree that the
repositories it found know about. Default roots: ~/.t3/worktrees ~/Projects

  --fetch    fetch origin once per repository first, so "merged" is current
  --gh       look up pull requests for branches with unmerged commits
  --depth N  how deep to search each root (default 4)
  --exact    list only checkouts found under the roots: no outside, gone,
             or unknown rows

Columns:
  kind            main, worktree, outside (a worktree of a scanned repository
                  that lives outside the roots), orphan (.git link points
                  nowhere), gone (registered, directory missing), or unknown
                  (a folder beside worktrees that is not a checkout)
  path            the checkout
  repo            the main checkout, the place to run `git worktree` commands
  branch          the checked-out branch, or (detached)
  size_kb         disk usage as du counts it
  build_kb        the part of size_kb in build noise. Package managers such
                  as bun and pnpm often clone or link these files from a shared
                  store, so removing them can free far less than this
  dirty           tracked changes plus untracked files that are not build noise
  dirty_sample    up to three of those paths
  ignored         git-ignored files that are neither build noise nor exact
                  copies of the same path in the main checkout, such as .env
  ignored_sample  up to three of those paths
  noise           build noise such as __pycache__/ or node_modules/
  ahead           commits on HEAD that the default branch lacks
  merged          yes (HEAD is in the default branch), content (merging would
                  change nothing, as after a squash merge), no, or ? (unknown)
  pushed          yes when a remote branch contains HEAD
  pr              open (any open PR for the branch), merged or closed (a PR
                  containing HEAD), diverged (PRs exist, none contain HEAD),
                  none, or - when not looked up
  remote          fresh (fetched now), stale (fetch failed), skipped (no
                  --fetch), or none (no origin)
  locked          yes when `git worktree lock` protects it
  active_days     days since the last commit, checkout, or reset in this worktree
  procs           processes whose working directory is inside the checkout
EOF
}

FETCH=0
GH=0
DEPTH=4
EXACT=0
ROOTS=""
NL='
'
TAB='	'

# Keep `git status` from refreshing the index, so the scan does not count as activity.
export GIT_OPTIONAL_LOCKS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --fetch) FETCH=1 ;;
    --gh) GH=1 ;;
    --depth)
      [ $# -ge 2 ] || { usage >&2; exit 2; }
      DEPTH="$2"
      shift
      ;;
    --exact) EXACT=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) ROOTS="$ROOTS$1$NL" ;;
  esac
  shift
done

if [ -z "$ROOTS" ]; then
  ROOTS="$HOME/.t3/worktrees$NL$HOME/Projects$NL"
fi

if git merge-tree -h 2>&1 | grep -q -- --write-tree; then
  HAS_MERGE_TREE=1
else
  HAS_MERGE_TREE=0
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
    out="$out$(field "$value")$TAB"
  done
  printf '%s\n' "${out%$TAB}"
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

unquote() {
  local path="${1%\"}"
  path="${path#\"}"
  printf '%s' "${path%/}"
}

# Output that a build or install recreates.
is_noise() {
  case "${1##*/}" in
    __pycache__|.DS_Store|node_modules|.venv|venv|dist|build|out|target|coverage|.cache|.next|.nuxt|.svelte-kit|.turbo|.parcel-cache|.vite|.expo|.gradle|DerivedData|.pytest_cache|.mypy_cache|.ruff_cache|*.pyc|*.tsbuildinfo) return 0 ;;
  esac
  return 1
}

# An ignored file that the main checkout holds byte for byte, such as a copied .env.
is_copy_of_main() {
  local copy="$2/$3" original="$1/$3"
  [ -e "$original" ] || return 1
  if [ -d "$copy" ]; then
    diff -rq "$original" "$copy" >/dev/null 2>&1
  else
    cmp -s "$original" "$copy"
  fi
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
REPO_REMOTES=""
OUTSIDE=""
LOCKED=""
WORKTREE_PARENTS=""
GONE_ROWS=""

repo_remote() {
  printf '%s' "$REPO_REMOTES" | awk -F'\t' -v r="$1" '$1 == r { print $2; exit }'
}

# Fetch once per repository, and note the worktrees git lists for it.
visit_repo() {
  local repo="$1" line path="" first=1 remote
  in_set "$repo" "$SEEN_REPOS" && return 0
  SEEN_REPOS="$SEEN_REPOS$repo$NL"

  if ! git -C "$repo" remote get-url origin >/dev/null 2>&1; then
    remote=none
  elif [ "$FETCH" -eq 0 ]; then
    remote=skipped
  elif git -C "$repo" fetch --quiet origin </dev/null >/dev/null 2>&1; then
    remote=fresh
  else
    remote=stale
  fi
  REPO_REMOTES="$REPO_REMOTES$repo$TAB$remote$NL"

  while IFS= read -r line; do
    case "$line" in
      "worktree "*)
        path="${line#worktree }"
        # The first entry is the main checkout, which is never listed from outside.
        if [ "$first" -eq 0 ]; then OUTSIDE="$OUTSIDE$path$NL"; fi
        first=0
        ;;
      locked*) LOCKED="$LOCKED$path$NL" ;;
      prunable*) GONE_ROWS="$GONE_ROWS$(row gone "$path" "$repo")$NL" ;;
    esac
  done <<EOF
$(git -C "$repo" worktree list --porcelain 2>/dev/null)
EOF
}

# The newest of the last commit and the last HEAD move recorded for this worktree.
active_days() {
  local commit moved newest
  commit="$(git -C "$1" log -1 --format=%ct 2>/dev/null)"
  moved="$(git -C "$1" reflog -1 --date=unix --format=%gd HEAD 2>/dev/null | sed -n 's/.*@{\([0-9]*\)}.*/\1/p')"
  newest="${commit:-0}"
  if [ -n "$moved" ] && [ "$moved" -gt "$newest" ]; then newest="$moved"; fi
  if [ "$newest" -eq 0 ]; then
    echo "?"
  else
    echo $(( ($(date +%s) - newest) / 86400 ))
  fi
}

# The state of the most relevant pull request for a branch.
pr_state() {
  local dir="$1" branch="$2" head="$3" state oid open=0 merged=0 closed=0 any=0
  while read -r state oid; do
    [ -n "$state" ] || continue
    any=1
    case "$state" in
      OPEN) open=1 ;;
      *)
        if [ "$oid" = "$head" ] || git -C "$dir" merge-base --is-ancestor "$head" "$oid" 2>/dev/null; then
          if [ "$state" = MERGED ]; then merged=1; else closed=1; fi
        fi
        ;;
    esac
  done <<EOF
$(cd "$dir" && gh pr list --head "$branch" --state all --limit 20 --json state,headRefOid --jq '.[] | "\(.state) \(.headRefOid)"' </dev/null 2>/dev/null)
EOF
  if [ "$open" -eq 1 ]; then echo open
  elif [ "$merged" -eq 1 ]; then echo merged
  elif [ "$closed" -eq 1 ]; then echo closed
  elif [ "$any" -eq 1 ]; then echo diverged
  else echo none
  fi
}

scan_checkout() {
  local dir="$1" kind="$2" gitdir common repo branch head def ahead merged pushed pr status line entry
  local locked build_kb=0 dirty=0 noise=0 ignored=0 dirty_sample="" ignored_sample=""

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
    if [ "$kind" = worktree ]; then WORKTREE_PARENTS="$WORKTREE_PARENTS${dir%/*}$NL"; fi
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
  head="$(git -C "$dir" rev-parse -q --verify HEAD 2>/dev/null)"

  status="$(git -C "$dir" status --porcelain --ignored 2>/dev/null)"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    entry="$(unquote "${line:3}")"
    case "$line" in
      "!! "*)
        if is_noise "$entry"; then
          noise=$((noise + 1))
          build_kb=$((build_kb + $(size_kb "$dir/$entry")))
        elif [ "$kind" != main ] && [ -d "$repo/.git" ] && is_copy_of_main "$repo" "$dir" "$entry"; then
          :
        else
          ignored=$((ignored + 1))
          if [ "$ignored" -le 3 ]; then ignored_sample="${ignored_sample:+$ignored_sample, }$entry"; fi
        fi
        continue
        ;;
      "?? "*)
        if is_noise "$entry"; then
          noise=$((noise + 1))
          build_kb=$((build_kb + $(size_kb "$dir/$entry")))
          continue
        fi
        ;;
    esac
    dirty=$((dirty + 1))
    if [ "$dirty" -le 3 ]; then dirty_sample="${dirty_sample:+$dirty_sample, }$entry"; fi
  done <<EOF
$status
EOF

  ahead="?"
  merged="?"
  if [ -n "$head" ] && def="$(default_ref "$dir")"; then
    ahead="$(git -C "$dir" rev-list --count "$def..HEAD" 2>/dev/null || echo "?")"
    if [ "$ahead" = 0 ]; then
      merged=yes
    elif [ "$ahead" != "?" ] && [ "$HAS_MERGE_TREE" -eq 1 ]; then
      # Merging into the default branch would change nothing: the work is already there.
      if [ "$(git -C "$dir" merge-tree --write-tree "$def" HEAD 2>/dev/null | head -n 1)" = \
           "$(git -C "$dir" rev-parse "$def^{tree}" 2>/dev/null)" ]; then
        merged=content
      else
        merged=no
      fi
    fi
  fi

  pushed=no
  if [ -n "$head" ] && [ -n "$(git -C "$dir" for-each-ref --contains HEAD --count=1 --format=x refs/remotes 2>/dev/null)" ]; then
    pushed=yes
  fi

  locked=no
  if in_set "$dir" "$LOCKED"; then locked=yes; fi

  pr="-"
  if [ "$GH" -eq 1 ] && [ "$merged" != yes ] && [ "$merged" != content ] && [ "$branch" != "(detached)" ]; then
    pr="$(pr_state "$dir" "$branch" "$head")"
  fi

  row "$kind" "$dir" "$repo" "$branch" "$(size_kb "$dir")" "$build_kb" "$dirty" "$dirty_sample" \
    "$ignored" "$ignored_sample" "$noise" "$ahead" "$merged" "$pushed" "$pr" \
    "$(repo_remote "$repo")" "$locked" "$(active_days "$dir")" "$(procs_in "$dir")"
}

printf 'kind\tpath\trepo\tbranch\tsize_kb\tbuild_kb\tdirty\tdirty_sample\tignored\tignored_sample\tnoise\tahead\tmerged\tpushed\tpr\tremote\tlocked\tactive_days\tprocs\n'

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
    scan_checkout "$dir" worktree
  done <<EOF
$(find "$root" -maxdepth "$DEPTH" \( -name node_modules -o -name .venv -o -name target -o -name .Trash \) -prune \
  -o -name .git -print -prune 2>/dev/null | sort)
EOF
done <<EOF
$ROOTS
EOF

[ "$EXACT" -eq 0 ] || exit 0

# Worktrees of the scanned repositories that live outside the roots.
while IFS= read -r dir; do
  [ -n "$dir" ] && [ -d "$dir" ] || continue
  dir="$(cd "$dir" && pwd -P)"
  in_set "$dir" "$SEEN_CHECKOUTS" && continue
  SEEN_CHECKOUTS="$SEEN_CHECKOUTS$dir$NL"
  scan_checkout "$dir" outside
done <<EOF
$(printf '%s' "$OUTSIDE" | sort -u)
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
