#!/usr/bin/env bash
# This is a source-maintenance command, separate from installation and updates.
# Keep it compatible with macOS Bash 3.2 and standard Git/Unix tools.
set -eo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { echo "agents skills sync: $*" >&2; exit 1; }
usage() { die "usage: agents skills sync folder [--add name] [--ref ref] [--dry-run]"; }
valid_name() { [[ "$1" =~ ^[a-z0-9][a-z0-9-]*$ && ${#1} -le 64 ]]; }
valid_path() {
  [[ "$1" =~ ^[a-zA-Z0-9_./-]+$ ]] || return 1
  case "/$1/" in *'/../'*|*'/./'*|*'//'* ) return 1 ;; esac
  [[ "$1" != /* ]]
}

[[ $# -gt 0 ]] || usage
folder="$1"; shift
valid_name "$folder" || die "invalid folder: $folder"
ref_override=""; dry_run=0; additions=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --add) shift; [[ $# -gt 0 ]] || usage; valid_name "$1" || die "invalid skill: $1"; additions+=("$1") ;;
    --ref) shift; [[ $# -gt 0 && -n "$1" ]] || usage; ref_override="$1" ;;
    --dry-run) dry_run=1 ;;
    *) usage ;;
  esac
  shift
done
checkout="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)" || die "run this command from an agents Git checkout, not an installed snapshot"
[[ "$(cd "$checkout" && pwd -P)" == "$(cd "$ROOT" && pwd -P)" ]] || die "the source must be an agents Git checkout"
group="$ROOT/skills/$folder"
manifest="$group/upstream.tsv"
[[ -d "$group" && ! -L "$group" && -f "$manifest" && ! -L "$manifest" ]] || die "no upstream manifest for $folder"
repository=""; branch=""; baseline=""; names=(); paths=(); locals=()
while IFS=$'\t' read -r kind value path extra || [[ -n "$kind" ]]; do
  case "$kind" in ''|'#'*) continue ;; esac
  [[ -z "$extra" ]] || die "too many fields in manifest"
  case "$kind" in
    repository) [[ -z "$repository" && -n "$value" && -z "$path" && "$value" != -* ]] || die "invalid repository row"; repository="$value" ;;
    ref) [[ -z "$branch" && -n "$value" && -z "$path" ]] || die "invalid ref row"; branch="$value" ;;
    commit) [[ -z "$baseline" && "$value" =~ ^[0-9a-f]{40}$ && -z "$path" ]] || die "invalid commit row"; baseline="$value" ;;
    skill|local)
      valid_name "$value" || die "invalid skill name in manifest: $value"
      for existing in "${names[@]}" "${locals[@]}"; do
        [[ "$existing" != "$value" ]] || die "duplicate manifest skill: $value"
      done
      if [[ "$kind" == local ]]; then
        [[ -z "$path" ]] || die "invalid local row"
        locals+=("$value")
      else
        valid_path "$path" && [[ "$path" == skills/* && "${path##*/}" == "$value" ]] || die "invalid upstream skill path: $path"
        names+=("$value"); paths+=("$path")
      fi ;;
    *) die "unknown manifest row: $kind" ;;
  esac
done < "$manifest"
[[ -n "$repository" && -n "$branch" && -n "$baseline" && ${#names[@]} -gt 0 ]] || die "manifest needs repository, ref, commit, and skill rows"
target="${ref_override:-$branch}"
[[ "$target" =~ ^[a-zA-Z0-9_./-]+$ && "$target" != -* ]] || die "invalid ref: $target"

# The lock and publication backup live beside the source, on the same filesystem.
lock="$ROOT/skills/.sync-$folder.lock"
mkdir "$lock" 2>/dev/null || die "sync lock exists at $lock; check for another running sync"
stage=""; published=0
cleanup() {
  if [[ -d "$lock/original" && $published -eq 0 ]]; then
    [[ ! -e "$group" ]] || rm -rf "$group"
    mv "$lock/original" "$group"
  fi
  [[ -z "$stage" ]] || rm -rf "$stage"
  rm -rf "$lock"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
stage="$(mktemp -d "${TMPDIR:-/tmp}/agents-skills-sync.XXXXXX")"
echo "Fetching $repository..."
git clone --quiet --no-checkout -- "$repository" "$stage/upstream"
next_commit="$(git -C "$stage/upstream" rev-parse --verify "$target^{commit}")" || die "upstream ref not found: $target"
git -C "$stage/upstream" cat-file -e "$baseline^{commit}" || die "baseline commit is missing upstream: $baseline"
mkdir "$stage/base" "$stage/next"
git -C "$stage/upstream" archive "$baseline" | tar -xf - -C "$stage/base"
git -C "$stage/upstream" archive "$next_commit" | tar -xf - -C "$stage/next"

# Do not follow links or copy devices from upstream or from edited local skills.
check_tree() {
  local directory="$1" entry
  [[ -d "$directory" && ! -L "$directory" ]] || die "not a regular directory: $directory"
  while IFS= read -r -d '' entry; do
    [[ ! -L "$entry" && ( -f "$entry" || -d "$entry" ) ]] || die "unsupported file or link: $entry"
    case "$entry" in *$'\n'*|*$'\t'*) die "tabs and newlines in file names are unsupported" ;; esac
  done < <(find "$directory" -print0)
}
check_tree "$group"
check_tree "$stage/base/skills"
if [[ -e "$stage/next/skills" || -L "$stage/next/skills" ]]; then check_tree "$stage/next/skills"; fi
for tree in "$stage/base" "$stage/next"; do
  [[ ! -L "$tree/LICENSE" ]] || die "upstream LICENSE must be a regular file"
done

find_skill() {
  local tree="$1" wanted="$2" found="" entry
  while IFS= read -r entry; do
    [[ -z "$found" ]] || die "more than one upstream skill is named $wanted; use an explicit manifest path"
    found="${entry%/SKILL.md}"
  done < <(find "$tree/skills" -type f -path "*/$wanted/SKILL.md" | LC_ALL=C sort)
  [[ -n "$found" ]] || die "upstream skill not found: $wanted"
  printf '%s\n' "$found"
}
for name in "${additions[@]}"; do
  for existing in "${names[@]}" "${locals[@]}"; do
    [[ "$existing" != "$name" ]] || die "$name already has a manifest entry"
  done
  [[ ! -e "$group/$name" ]] || die "refusing to take over existing local skill: $name"
  source="$(find_skill "$stage/next" "$name")"
  path="${source#"$stage/next/"}"
  valid_path "$path" || die "invalid upstream path: $path"
  names+=("$name"); paths+=("$path")
done

cp -R "$group" "$stage/result"
conflicts=0
same_content() {
  if [[ ! -f "$1" && ! -f "$2" ]]; then return 0; fi
  [[ -f "$1" && -f "$2" ]] && cmp -s "$1" "$2"
}
mode_of() { if [[ -x "$1" ]]; then echo 1; else echo 0; fi; }
merge_file() {
  local base="$1" ours="$2" theirs="$3" output="$4" label="$5" chosen="" status ours_mode base_mode theirs_mode mode
  if same_content "$ours" "$theirs"; then chosen="$ours"
  elif same_content "$ours" "$base"; then chosen="$theirs"
  elif same_content "$theirs" "$base"; then chosen="$ours"
  elif [[ -f "$base" && -f "$ours" && -f "$theirs" ]]; then
    mkdir -p "$(dirname "$output")"
    git merge-file -p -L local -L baseline -L upstream "$ours" "$base" "$theirs" > "$output" && status=0 || status=$?
    if [[ $status -ne 0 ]]; then
      echo "Conflict: $label" >&2
      conflicts=$((conflicts + 1)); return 0
    fi
  else
    echo "Conflict: $label (addition or deletion overlaps a local change)" >&2
    conflicts=$((conflicts + 1)); return 0
  fi
  if [[ -n "$chosen" ]]; then
    [[ -f "$chosen" ]] || return 0
    mkdir -p "$(dirname "$output")"
    cp "$chosen" "$output"
  fi
  ours_mode="$(mode_of "$ours")"; base_mode="$(mode_of "$base")"; theirs_mode="$(mode_of "$theirs")"
  if [[ "$ours_mode" == "$base_mode" ]]; then mode="$theirs_mode"; else mode="$ours_mode"; fi
  if [[ "$mode" == 1 ]]; then chmod a+x "$output"; else chmod a-x "$output"; fi
}

for ((index=0; index<${#names[@]}; index++)); do
  name="${names[$index]}"; path="${paths[$index]}"
  [[ -f "$stage/next/$path/SKILL.md" ]] || die "$name was removed or moved upstream; update its manifest path or mark it local before syncing"
  bash "$ROOT/bin/agents" _validate_skill "$stage/next/$path/SKILL.md" "$name" || die "invalid upstream metadata for $name"
  base_dir="$stage/base/$path"
  if [[ ! -f "$base_dir/SKILL.md" ]]; then
    if [[ -e "$group/$name" ]]; then base_dir="$(find_skill "$stage/base" "$name")"
    else base_dir="$stage/absent"; fi
  fi
  ours_dir="$group/$name"; theirs_dir="$stage/next/$path"; merged="$stage/merged/$name"
  mkdir -p "$merged"
  {
    for directory in "$base_dir" "$ours_dir" "$theirs_dir"; do
      [[ -d "$directory" ]] || continue
      while IFS= read -r file; do printf '%s\n' "${file#"$directory/"}"; done < <(find "$directory" -type f)
    done
  } | LC_ALL=C sort -u > "$stage/files"
  before="$conflicts"
  while IFS= read -r file; do
    merge_file "$base_dir/$file" "$ours_dir/$file" "$theirs_dir/$file" "$merged/$file" "$folder/$name/$file"
  done < "$stage/files"
  if [[ $conflicts -eq $before ]]; then
    bash "$ROOT/bin/agents" _validate_skill "$merged/SKILL.md" "$name" || die "invalid merged metadata for $name"
    rm -rf "$stage/result/$name"
    cp -R "$merged" "$stage/result/$name"
    if ! diff -r "$ours_dir" "$merged" >/dev/null 2>&1; then echo "Updated $folder/$name"; fi
  fi
done
[[ -f "$stage/next/LICENSE" && -f "$stage/base/LICENSE" ]] || die "upstream must provide LICENSE at both commits"
rm -f "$stage/result/LICENSE"
merge_file "$stage/base/LICENSE" "$group/LICENSE" "$stage/next/LICENSE" "$stage/result/LICENSE" "$folder/LICENSE"
# A newly tracked license is copied even if it is identical to the baseline.
[[ -f "$group/LICENSE" || -f "$stage/result/LICENSE" ]] || cp "$stage/next/LICENSE" "$stage/result/LICENSE"
[[ -f "$stage/result/LICENSE" ]] || die "upstream license must be retained"
[[ $conflicts -eq 0 ]] || die "$conflicts conflict(s); no source files changed. Resolve local edits against upstream and retry."
{
  printf '# Copied skills. See docs/skills-sync.md for the manifest format.\n'
  printf 'repository\t%s\nref\t%s\ncommit\t%s\n' "$repository" "$branch" "$next_commit"
  for ((index=0; index<${#names[@]}; index++)); do printf 'skill\t%s\t%s\n' "${names[$index]}" "${paths[$index]}"; done
  for name in "${locals[@]}"; do printf 'local\t%s\n' "$name"; done
} > "$stage/result/upstream.tsv"
echo "Upstream candidates (not imported):"
while IFS= read -r file; do
  name="$(basename "$(dirname "$file")")"; tracked=0
  for existing in "${names[@]}" "${locals[@]}"; do [[ "$existing" != "$name" ]] || tracked=1; done
  [[ $tracked -eq 0 ]] || continue
  printf '  %s\n' "${file#"$stage/next/"}" | sed 's|/SKILL.md$||'
done < <(find "$stage/next/skills" -type f -name SKILL.md | LC_ALL=C sort)
if [[ $dry_run -eq 1 ]]; then
  echo "Dry run complete for $next_commit; no source files changed."
else
  cp -R "$stage/result" "$lock/new"
  mv "$group" "$lock/original"
  mv "$lock/new" "$group"
  published=1
  echo "Synced $folder to $next_commit. Review git diff before committing."
fi
