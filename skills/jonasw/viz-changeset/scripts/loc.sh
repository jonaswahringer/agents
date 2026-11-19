#!/usr/bin/env bash
# Prints lines added and removed per area of a changeset as TSV:
#   area <TAB> added <TAB> removed <TAB> files
# sorted by lines touched, with a final "total" row. The working tree,
# untracked files included, is compared against the base. Lockfiles are
# pooled under "(lockfiles)"; binary files count as files but not lines.
#
# Usage: loc.sh [-d depth] [base]
#   -d depth  how many leading directories name an area (default 1)
#   base      commit to compare against (default: merge-base with the
#             default branch, else HEAD)
set -eu

usage() {
  echo "usage: loc.sh [-d depth] [base]" >&2
  exit 2
}

depth=1
while getopts d: opt; do
  case "$opt" in
    d) depth="$OPTARG" ;;
    *) usage ;;
  esac
done
shift $((OPTIND - 1))
[ "$#" -le 1 ] || usage
case "$depth" in '' | *[!0-9]* | 0) usage ;; esac

base="${1:-}"
if [ -z "$base" ]; then
  default="$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  for ref in "$default" main master; do
    if [ -n "$ref" ] && git rev-parse -q --verify "$ref^{commit}" >/dev/null; then
      base="$(git merge-base HEAD "$ref")"
      break
    fi
  done
  [ -n "$base" ] || base=HEAD
fi
git rev-parse -q --verify "$base^{commit}" >/dev/null || {
  echo "loc.sh: unknown base: $base" >&2
  exit 2
}

top="$(git rev-parse --show-toplevel)"
cd "$top"

{
  git -c core.quotepath=off diff --numstat --no-renames "$base" --
  git -c core.quotepath=off ls-files --others --exclude-standard -z |
    while IFS= read -r -d '' file; do
      if [ -s "$file" ] && ! grep -Iq . "$file"; then
        printf -- '-\t-\t%s\n' "$file"
      else
        printf '%s\t0\t%s\n' "$(wc -l < "$file" | tr -d ' ')" "$file"
      fi
    done
} | awk -F '\t' -v depth="$depth" '
  BEGIN { OFS = "\t" }
  {
    path = $3
    n = split(path, part, "/")
    name = part[n]
    if (name ~ /^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|go\.sum|Gemfile\.lock|poetry\.lock|uv\.lock|composer\.lock|Package\.resolved|flake\.lock)$/) {
      area = "(lockfiles)"
    } else if (n == 1) {
      area = "(root)"
    } else {
      area = part[1]
      for (i = 2; i <= depth && i < n; i++) area = area "/" part[i]
    }
    if ($1 != "-") { add[area] += $1; del[area] += $2; ta += $1; td += $2 }
    files[area]++; tf++
  }
  END {
    # The total sorts last because it is keyed -1.
    for (a in files) print add[a] + del[a], a, add[a] + 0, del[a] + 0, files[a]
    print -1, "total", ta + 0, td + 0, tf + 0
  }
' | sort -t "$(printf '\t')" -k1,1nr -k2,2 | cut -f 2-
