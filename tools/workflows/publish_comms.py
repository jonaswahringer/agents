#!/usr/bin/env python3
"""Publish a workflow digest to one stable comms URL using saved Postplan credentials."""
import argparse
import fcntl
import html
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def inline(text):
    pieces, cursor = [], 0
    for match in re.finditer(r"\[([^\]\n]+)\]\((https://[^\s)]+)\)", text):
        pieces.append(html.escape(text[cursor:match.start()]))
        pieces.append('<a href="%s">%s</a>' %
                      (html.escape(match[2], quote=True), html.escape(match[1])))
        cursor = match.end()
    pieces.append(html.escape(text[cursor:]))
    return "".join(pieces)


def render(markdown):
    blocks, paragraph, items = [], [], []

    def flush():
        if paragraph:
            blocks.append("<p>" + inline(" ".join(paragraph)) + "</p>")
            paragraph.clear()
        if items:
            blocks.append("<ul>" + "".join("<li>" + inline(item) + "</li>" for item in items) + "</ul>")
            items.clear()

    for line in markdown.splitlines():
        if line.startswith("# "):
            flush()
            blocks.append("<h1>" + html.escape(line[2:]) + "</h1>")
        elif line.startswith("- "):
            if paragraph:
                flush()
            items.append(line[2:])
        elif not line.strip():
            flush()
        else:
            if items:
                flush()
            paragraph.append(line)
    flush()
    return '''<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>T3 Code update digest</title><style>
:root { color-scheme: light dark; --bg: #fafafa; --fg: #202020; --muted: #555; --link: #1857a4; --line: #ddd; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #171717; --fg: #eee; --muted: #bbb; --link: #9bc7ff; --line: #444; }
}
body { background: var(--bg); color: var(--fg); font: 17px/1.65 system-ui, sans-serif; margin: 0; }
main { max-width: 46rem; margin: auto; padding: 2rem 1.25rem; }
h1 { font-size: 1.8rem; line-height: 1.25; }
a { color: var(--link); overflow-wrap: anywhere; }
li { margin-bottom: 1rem; }
</style></head><body><main>''' + "\n".join(blocks) + "</main></body></html>\n"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def write_private(path, content):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)


def publish(report, run_id, state, credentials_dir, timeout=30):
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    state.chmod(0o700)
    with (state / "comms.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        saved_path = state / "comms.json"
        saved = read_json(saved_path)
        if saved.get("last_run_id") == run_id:
            return dict(saved, reused=True)
        config = read_json(credentials_dir / "config.json")
        credentials = read_json(credentials_dir / "credentials.json")
        base = (os.environ.get("POSTPLAN_API_URL") or config.get("apiUrl") or "").rstrip("/")
        key = os.environ.get("POSTPLAN_API_KEY") or credentials.get("apiKey")
        url = urllib.parse.urlsplit(base)
        if (not url.hostname or url.username or url.password or url.query or url.fragment or
                not (url.scheme == "https" or
                     (url.scheme == "http" and url.hostname in ("127.0.0.1", "localhost", "::1")))):
            raise ValueError("Comms requires HTTPS, or HTTP on localhost.")
        if not isinstance(key, str) or not key:
            raise ValueError("Set up Postplan credentials before publishing.")
        if not re.fullmatch(r"[\x21-\x7e]+", key):
            raise ValueError("Postplan API key must contain only printable ASCII without whitespace.")
        if saved and saved.get("api_url") != base:
            raise ValueError("Comms endpoint changed; use a separate state directory.")
        document = render(report)
        write_private(state / "t3-update-digest.html", document)
        payload = {"html": document, "filename": "t3-update-digest.html",
                   "metadata": {"workflow": "t3-updates", "runId": run_id}}
        if saved.get("draft_id"):
            payload["draftId"] = saved["draft_id"]
        request = urllib.request.Request(base + "/api/uploads",
                                        data=json.dumps(payload).encode("utf-8"),
                                        headers={"Authorization": "Bearer " + key,
                                                 "Content-Type": "application/json"}, method="POST")
        # Comms is reached directly over the tailnet, without system proxy discovery.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects())
        try:
            with opener.open(request, timeout=timeout) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            code = error.code
            error.close()
            raise RuntimeError("Comms upload failed with HTTP %s." % code) from None
        except urllib.error.URLError:
            raise RuntimeError("Comms upload could not reach the server.") from None
        if (not isinstance(result, dict) or result.get("ok") is not True or not isinstance(result.get("draftId"), str) or
                not result["draftId"] or not isinstance(result.get("publicUrl"), str) or
                not result["publicUrl"]):
            raise RuntimeError("Comms upload returned an invalid response.")
        saved = {"api_url": base, "draft_id": result["draftId"], "url": result["publicUrl"],
                 "last_run_id": run_id, "version": result.get("versionNumber")}
        write_private(saved_path, json.dumps(saved) + "\n")
        return saved


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, required=True)
    parser.add_argument("--id", required=True)
    parser.add_argument("--state-dir", type=Path,
                        default=Path.home() / ".local/state/agents/workflows")
    parser.add_argument("--credentials-dir", type=Path, default=Path.home() / ".postplan")
    args = parser.parse_args()
    result = publish(args.file.read_text(encoding="utf-8"), args.id,
                     args.state_dir, args.credentials_dir)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
