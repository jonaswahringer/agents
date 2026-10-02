import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileBucket, noAssets, SqliteD1 } from "../src/adapters.js";
import { createApp } from "../src/api.js";
import { MediaFiles } from "../src/media.js";
import { sha256 } from "../src/crypto.js";

let directory;
let db;
let env;
let app;
const KEY = "media-test-key";
const recording = new TextEncoder().encode("0123456789abcdefghij");

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "comms-media-"));
  db = new SqliteD1(join(directory, "postplan.sqlite"));
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await Bun.file(new URL(name, migrations)).text());
  }
  env = {
    DB: db,
    DRAFTS: new FileBucket(join(directory, "drafts")),
    MEDIA: new MediaFiles(join(directory, "media")),
    ASSETS: noAssets,
    POSTPLAN_BOOTSTRAP_API_KEY: KEY,
    POSTPLAN_PUBLIC_BASE_URL: "https://comms.test:8774"
  };
  app = createApp();
});

afterEach(async () => {
  db.close();
  await rm(directory, { recursive: true, force: true });
});

function call(path, init = {}) {
  return app.fetch(new Request(new URL(path, "https://comms.test:8774"), init), env);
}

function upload(filename = "screen recording.mp4", body = recording, key = KEY, headers = {}) {
  return call(`/api/media?filename=${encodeURIComponent(filename)}`, {
    method: "POST",
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers },
    body
  });
}

test("publishing a recording returns working player, media and download links", async () => {
  const uploaded = await upload();
  expect(uploaded.status).toBe(201);
  const result = await uploaded.json();
  expect(result.size).toBe(recording.length);
  expect(result.publicUrl).toStartWith("https://comms.test:8774/m/");
  const player = await call(result.publicUrl);
  expect(player.status).toBe(200);
  expect(player.headers.get("content-security-policy")).toContain("media-src 'self'");
  const html = await player.text();
  expect(html).toContain(`<video controls playsinline preload="metadata"`);
  expect(html).toContain(`/media/${result.mediaId}`);
  expect(html).toContain("Download recording");

  const media = await call(result.mediaUrl);
  expect(media.status).toBe(200);
  expect(media.headers.get("content-type")).toBe("video/mp4");
  expect(media.headers.get("accept-ranges")).toBe("bytes");
  expect(media.headers.get("x-content-type-options")).toBe("nosniff");
  expect(new Uint8Array(await media.arrayBuffer())).toEqual(recording);
  const downloaded = await call(result.downloadUrl);
  expect(downloaded.headers.get("content-disposition")).toContain('attachment; filename="screen recording.mp4"');
  expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(recording);
  const head = await call(result.mediaUrl, { method: "HEAD", headers: { range: "bytes=0-3" } });
  expect(head.status).toBe(200);
  expect(head.headers.get("content-length")).toBe("20");
  expect(await head.text()).toBe("");
});

test("video seeking returns the requested bytes and correct lengths", async () => {
  const { mediaUrl } = await (await upload()).json();
  for (const [range, body, contentRange] of [
    ["bytes=2-5", "2345", "bytes 2-5/20"],
    ["bytes=16-", "ghij", "bytes 16-19/20"],
    ["bytes=-3", "hij", "bytes 17-19/20"],
    ["bytes=18-200", "ij", "bytes 18-19/20"],
    ["bytes=-100", "0123456789abcdefghij", "bytes 0-19/20"]
  ]) {
    const response = await call(mediaUrl, { headers: { range } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(contentRange);
    expect(response.headers.get("content-length")).toBe(String(body.length));
    expect(await response.text()).toBe(body);
  }
  for (const range of ["bytes=20-", "bytes=8-2", "bytes=-0", "bytes=", "bytes=0-1,3-4", "bytes=99999999999999999999-"]) {
    const response = await call(mediaUrl, { headers: { range } });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */20");
  }
  const full = await call(mediaUrl);
  const matching = await call(mediaUrl, { headers: { range: "bytes=0-1", "if-range": full.headers.get("etag") } });
  expect(matching.status).toBe(206);
  const changed = await call(mediaUrl, { headers: { range: "bytes=0-1", "if-range": '"old"' } });
  expect(changed.status).toBe(200);
  expect(await changed.text()).toBe("0123456789abcdefghij");
});

test("an uploaded HTML report can embed the recording and link to its download", async () => {
  const { mediaId } = await (await upload()).json();
  const html = `<!doctype html><title>Recorded walkthrough</title><video controls src="/media/${mediaId}"></video><a href="/media/${mediaId}?download=1" download>Download</a>`;
  const response = await call("/api/uploads", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ html, filename: "walkthrough.html" })
  });
  expect(response.status).toBe(201);
  const published = await response.json();
  const page = await call(published.publicUrl);
  expect(page.headers.get("content-security-policy")).toContain("media-src 'self'");
  expect(page.headers.get("content-security-policy")).toContain("connect-src 'none'");
  expect(await page.text()).toBe(html);
  expect((await call(`/media/${mediaId}`)).status).toBe(200);
});

test("uploads require authentication and only accept recording formats", async () => {
  expect((await upload("test.mp4", recording, null)).status).toBe(401);
  expect((await upload("test.mp4", recording, "wrong-key")).status).toBe(401);
  expect((await upload("test.html")).status).toBe(415);
  expect((await upload("test.exe")).status).toBe(415);
  for (const filename of ["../test.mp4", "a/b.mp4", "a\\b.mp4", "a\n.mp4", ""]) {
    expect((await upload(filename)).status).toBe(400);
  }
  for (const [filename, type] of [["test.MP4", "video/mp4"], ["test.m4v", "video/mp4"], ["test.webm", "video/webm"], ["test.mov", "video/quicktime"]]) {
    const result = await (await upload(filename)).json();
    expect((await call(result.mediaUrl)).headers.get("content-type")).toBe(type);
  }
});

test("limits apply to streamed uploads as well as Content-Length, with no files left behind", async () => {
  env.MAX_MEDIA_BYTES = "8";
  expect((await upload("big.mp4", recording, KEY, { "content-length": "20" })).status).toBe(413);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(recording.slice(0, 5));
      controller.enqueue(recording.slice(5, 10));
      controller.close();
    }
  });
  expect((await upload("big.mp4", stream)).status).toBe(413);
  expect(await readdir(join(directory, "media"))).toEqual([]);
  expect((await upload("empty.mp4", new Uint8Array())).status).toBe(400);
  expect(await readdir(join(directory, "media"))).toEqual([]);
  const broken = new ReadableStream({ start(controller) { controller.error(new Error("connection lost")); } });
  // The app hides internal errors from the caller, and the temporary file is removed.
  const logger = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect((await upload("interrupted.mp4", broken)).status).toBe(500);
    expect(logger).toHaveBeenCalled();
  } finally {
    logger.mockRestore();
  }
  expect(await readdir(join(directory, "media"))).toEqual([]);
});

test("missing files, path traversal and symlinks never expose host files", async () => {
  expect((await call("/media/missing.mp4")).status).toBe(404);
  expect((await call("/media/%2e%2e%2fpostplan.sqlite")).status).toBe(404);
  const { mediaId, mediaUrl } = await (await upload()).json();
  await rm(join(directory, "media", mediaId));
  await writeFile(join(directory, "private.mp4"), "private");
  await symlink(join(directory, "private.mp4"), join(directory, "media", mediaId));
  expect((await call(mediaUrl)).status).toBe(404);
});

test("filenames are escaped in the player and encoded in download headers", async () => {
  const filename = 'screen "<test>" café.mp4';
  const result = await (await upload(filename)).json();
  const player = await (await call(result.publicUrl)).text();
  expect(player).toContain("screen &quot;&lt;test&gt;&quot; café.mp4");
  expect(player).not.toContain('<test>');
  const response = await call(result.downloadUrl);
  expect(response.headers.get("content-disposition")).toContain("caf%C3%A9.mp4");
});

test("only the owning account can remove a recording", async () => {
  const result = await (await upload()).json();
  expect((await call(`/api/media/${result.mediaId}`, { method: "DELETE" })).status).toBe(401);
  await db.prepare("INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .bind("foreign-account", "Other uploader", new Date().toISOString(), new Date().toISOString()).run();
  await db.prepare("INSERT INTO api_keys (id, account_id, name, key_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind("foreign-key", "foreign-account", "Other key", await sha256("foreign-token"), new Date().toISOString()).run();
  expect((await call(`/api/media/${result.mediaId}`, { method: "DELETE", headers: { authorization: "Bearer foreign-token" } })).status).toBe(404);
  expect((await call(`/api/media/${result.mediaId}`, { method: "DELETE", headers: { authorization: `Bearer ${KEY}` } })).status).toBe(200);
  expect((await call(result.mediaUrl)).status).toBe(404);
  expect((await call(result.publicUrl)).status).toBe(404);
  expect(await readdir(join(directory, "media"))).toEqual([]);
});

test("the publish command uploads a path with spaces through an actual HTTP server", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => app.fetch(request, env) });
  const path = join(directory, "screen capture.mp4");
  await writeFile(path, recording);
  try {
    const child = Bun.spawn([process.execPath, new URL("../scripts/publish-media.js", import.meta.url).pathname, path], {
      env: { ...Bun.env, POSTPLAN_API_URL: `http://127.0.0.1:${server.port}`, POSTPLAN_API_KEY: KEY },
      stdout: "pipe",
      stderr: "pipe"
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const published = JSON.parse(stdout);
    expect(published.filename).toBe("screen capture.mp4");
    expect(published.size).toBe(recording.length);
    expect(new Uint8Array(await (await call(published.mediaUrl)).arrayBuffer())).toEqual(recording);
  } finally {
    await server.stop(true);
  }
});
