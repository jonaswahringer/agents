#!/usr/bin/env bash

# Runs every test suite: the installer suite, then each tool under tools/.
# Suites are found on disk, so a new tool with tests needs no change here.
# PYTHON picks the interpreter, e.g. PYTHON=/usr/bin/python3 to check 3.9.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-python3}"
PASSED=0
FAILED=""
SKIPPED=""

suite() {
  local name="$1"
  shift
  echo "== $name"
  if "$@"; then
    PASSED=$((PASSED + 1))
  else
    FAILED="$FAILED
  $name"
  fi
}

bun_suite() (
  cd "$1" || exit 1
  # Only tools with a package.json have dependencies to install.
  if [[ -f package.json && ! -d node_modules ]]; then
    bun install --frozen-lockfile || exit 1
  fi
  bun test
)

suite "installer and usage" "$ROOT/tests/test.sh"

for tool in "$ROOT"/tools/*/; do
  tool="${tool%/}"
  name="${tool##*/}"

  for dir in "$tool" "$tool/tests"; do
    if [[ -d "$dir" && -n "$(find "$dir" -maxdepth 1 -name 'test_*.py' -print)" ]]; then
      suite "$name ($("$PYTHON" -c 'import platform; print("Python " + platform.python_version())'))" \
        "$PYTHON" -m unittest discover -s "$dir" -p 'test_*.py'
    fi
  done

  if [[ -n "$(find "$tool" -name node_modules -prune -o \( -name '*.test.js' -o -name '*.test.mjs' \) -print)" ]]; then
    if command -v bun >/dev/null 2>&1; then
      suite "$name (Bun)" bun_suite "$tool"
    else
      SKIPPED="$SKIPPED
  $name (Bun is not installed)"
    fi
  fi
done

echo
echo "Passed: $PASSED suites"
if [[ -n "$SKIPPED" ]]; then
  echo "Skipped:$SKIPPED"
fi
if [[ -n "$FAILED" ]]; then
  echo "Failed:$FAILED"
  exit 1
fi
