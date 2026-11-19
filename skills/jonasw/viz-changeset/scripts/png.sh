#!/usr/bin/env bash
# Saves a viz-changeset page as a full-height PNG with headless Chrome or
# Chromium, at 2x, light scheme, toolbar hidden.
#
# Usage: png.sh <page.html> [out.png] [width]
#   out.png  defaults to the page path with .png
#   width    CSS pixels, default 1100
# Set CHROME to pick a browser binary. Exits 3 when none is found.
set -eu

[ "$#" -ge 1 ] && [ "$#" -le 3 ] || { echo "usage: png.sh <page.html> [out.png] [width]" >&2; exit 2; }
page="$1"
[ -f "$page" ] || { echo "png.sh: no such file: $page" >&2; exit 2; }
page="$(cd "$(dirname "$page")" && pwd -P)/$(basename "$page")"
out="${2:-${page%.*}.png}"
width="${3:-1100}"

chrome="${CHROME:-}"
if [ -z "$chrome" ]; then
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
    google-chrome google-chrome-stable chromium chromium-browser; do
    if [ -x "$candidate" ] || command -v "$candidate" >/dev/null 2>&1; then
      chrome="$candidate"
      break
    fi
  done
fi
[ -n "$chrome" ] || { echo "png.sh: no Chrome or Chromium found; set CHROME" >&2; exit 3; }

# Spaces and other URL-unsafe bytes in the path must be percent-encoded.
url="file://$(printf '%s' "$page" | od -An -tx1 -v | tr -d ' \n' |
  sed 's/\(..\)/%\1/g; s/%2f/\//g')#export"

profile="$(mktemp -d "${TMPDIR:-/tmp}/viz-changeset.XXXXXX")"
trap 'rm -rf "$profile"' EXIT
run() {
  "$chrome" --headless --disable-gpu --no-first-run --hide-scrollbars \
    --user-data-dir="$profile" --virtual-time-budget=2000 "$@" 2>/dev/null
}

# The page records its own full height on load; size the window to it.
height="$(run --window-size="$width,800" --dump-dom "$url" |
  sed -n 's/.*data-height="\([0-9][0-9]*\)".*/\1/p' | head -n 1)"
[ -n "$height" ] || height=2000

run --window-size="$width,$height" --force-device-scale-factor=2 \
  --screenshot="$out" "$url" >/dev/null
[ -s "$out" ] || { echo "png.sh: Chrome wrote no image" >&2; exit 1; }
echo "$out"
