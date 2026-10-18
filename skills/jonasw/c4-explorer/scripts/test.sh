#!/usr/bin/env bash
# Package checks. Browser checks run separately in the host's browser.
set -euo pipefail
SKILL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
C4_PYTHON="${PYTHON:-python3}"
node "$SKILL_ROOT/scripts/test-core.cjs"
node "$SKILL_ROOT/scripts/test-model.cjs"
"$C4_PYTHON" "$SKILL_ROOT/scripts/test-build.py"
