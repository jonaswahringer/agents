#!/usr/bin/env bash

set -eu

url=""
output=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o)
      output="$2"
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

[[ -n "$url" && -n "$output" ]]
if [[ -n "${FAKE_UPDATE_CALLS:-}" ]]; then
  printf '%s\n' "$url" >> "$FAKE_UPDATE_CALLS"
fi

case "$url" in
  https://raw.githubusercontent.com/*/setup/install.sh\?*)
    cp "$FAKE_UPDATE_INSTALLER" "$output"
    ;;
  https://raw.githubusercontent.com/*/install.sh\?*)
    cp "${FAKE_UPDATE_BOOTSTRAP:-$FAKE_UPDATE_INSTALLER}" "$output"
    ;;
  https://raw.githubusercontent.com/*)
    echo "bootstrap URL did not have a cache key: $url" >&2
    exit 1
    ;;
  https://codeload.github.com/*\?*)
    cp "$FAKE_UPDATE_LATEST_ARCHIVE" "$output"
    ;;
  https://codeload.github.com/*)
    cp "$FAKE_UPDATE_CACHED_ARCHIVE" "$output"
    ;;
  *)
    echo "unexpected URL: $url" >&2
    exit 1
    ;;
esac
