#!/usr/bin/env bash

set -euo pipefail

REPOSITORY="${AGENTS_REPOSITORY:-jonaswahringer/agents}"
REF="${AGENTS_REF:-main}"
DATA_DIR="${AGENTS_INSTALL_DIR:-$HOME/.local/share/agents}"
BIN_DIR="${AGENTS_BIN_DIR:-$HOME/.local/bin}"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agents-install.XXXXXX")"

if [[ -z "$DATA_DIR" || "$DATA_DIR" == "/" || "$DATA_DIR" == "$HOME" ]]; then
  echo "agents: refusing unsafe install directory: $DATA_DIR" >&2
  exit 1
fi

cleanup() {
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT

mkdir -p "$STAGE_DIR/source" "$DATA_DIR" "$BIN_DIR"

SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

SOURCE_DIR="${AGENTS_SOURCE_DIR:-}"
if [[ -z "$SOURCE_DIR" && -n "$SCRIPT_DIR" && -d "$SCRIPT_DIR/.git" ]]; then
  SOURCE_DIR="$SCRIPT_DIR"
fi

if [[ -n "$SOURCE_DIR" ]]; then
  if [[ ! -f "$SOURCE_DIR/bin/agents" ]]; then
    echo "agents: $SOURCE_DIR is not an agents repository" >&2
    exit 1
  fi
  # Copy the working tree, but never the files git ignores. Those are local
  # state, not the tool: node_modules, databases, logs, and the API key that
  # tools/comms keeps in .env and its private launchd plist. Installing from a
  # GitHub tarball never saw them; installing from a local checkout used to.
  EXCLUDES="$STAGE_DIR/excludes"

  # These never belong in a snapshot, whatever the source tree is. They are the
  # floor, so a source directory that is not a git checkout is still covered.
  # tar matches a pattern without a slash against any path component, so each of
  # these excludes that name at any depth, which is what we want here.
  cat > "$EXCLUDES" <<'FLOOR'
node_modules
.env
__pycache__
.DS_Store
FLOOR

  if git -C "$SOURCE_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    # core.quotepath=off keeps non-ASCII names literal; git would otherwise
    # C-quote them ("d\303\244t\303\244.log") and the pattern would never match.
    git -C "$SOURCE_DIR" -c core.quotepath=off ls-files --others --ignored \
      --exclude-standard --directory \
      | sed -e 's|/*$||' -e 's|^|./|' >> "$EXCLUDES"
  else
    # No .gitignore to read, so name the remaining local state explicitly. Full
    # paths only: a bare "data" or "*.log" would match at any depth and take
    # someone's docs/data or a tracked log with it.
    echo "agents: $SOURCE_DIR is not a git checkout; local state is excluded by name only" >&2
    cat >> "$EXCLUDES" <<'FALLBACK'
./tools/comms/data
./tools/comms/com.wahringer.comms.plist
./tools/comms/*.log
FALLBACK
  fi

  tar -C "$SOURCE_DIR" --exclude=.git --exclude-from="$EXCLUDES" -cf - . \
    | tar -C "$STAGE_DIR/source" -xf -
else
  ARCHIVE="$STAGE_DIR/agents.tar.gz"
  CACHE_KEY="${STAGE_DIR##*.}"
  URL="https://codeload.github.com/$REPOSITORY/tar.gz/refs/heads/$REF?update=$CACHE_KEY"
  if [[ "${1:-}" == "--update" ]]; then
    echo "Updating agents..."
  else
    echo "Installing agents..."
  fi
  curl -fsSL "$URL" -o "$ARCHIVE"
  tar -xzf "$ARCHIVE" -C "$STAGE_DIR"
  EXTRACTED="$STAGE_DIR/$(basename "$REPOSITORY")-$REF"
  if [[ ! -d "$EXTRACTED" ]]; then
    echo "agents: the downloaded archive had an unexpected layout" >&2
    exit 1
  fi
  rm -rf "$STAGE_DIR/source"
  mv "$EXTRACTED" "$STAGE_DIR/source"
fi

if [[ ! -f "$STAGE_DIR/source/bin/agents" ]]; then
  echo "agents: the installer is missing bin/agents" >&2
  exit 1
fi

chmod +x "$STAGE_DIR/source/bin/agents" "$STAGE_DIR/source/install.sh"

PREVIOUS="$DATA_DIR/source.previous"
rm -rf "$PREVIOUS"
if [[ -e "$DATA_DIR/source" ]]; then
  mv "$DATA_DIR/source" "$PREVIOUS"
fi
mv "$STAGE_DIR/source" "$DATA_DIR/source"
ln -sfn "$DATA_DIR/source/bin/agents" "$BIN_DIR/agents"

rollback_install() {
  rm -rf "$DATA_DIR/source"
  if [[ -e "$PREVIOUS" ]]; then
    mv "$PREVIOUS" "$DATA_DIR/source"
  else
    rm -f "$BIN_DIR/agents"
  fi
}

if [[ "${1:-}" == "--update" ]]; then
  shift
  if ! "$DATA_DIR/source/bin/agents" _reconcile "$@"; then
    rollback_install
    echo "agents: update failed; the previous version was restored" >&2
    exit 1
  fi
  rm -rf "$PREVIOUS"
  echo "agents is up to date."
else
  if ! "$DATA_DIR/source/bin/agents" _install "$@"; then
    rollback_install
    echo "agents: installation failed; the previous version was restored" >&2
    exit 1
  fi
  rm -rf "$PREVIOUS"
fi
