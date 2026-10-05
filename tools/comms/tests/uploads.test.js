import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileBucket, noAssets, SqliteD1 } from "../src/adapters.js";
import { createApp } from "../src/api.js";
import { MediaFiles } from "../src/media.js";

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

async function report(title, draftId) {
  const response = await call("/api/uploads", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ html: `<!doctype html><title>${title}</title><p>Report</p>`, draftId })
  });
  expect(response.status).toBe(draftId ? 200 : 201);
  return response.json();
}

test("home opens the login-free dashboard, including before the first upload", async () => {
  const home = await call("/");
  expect(home.status).toBe(302);
  expect(home.headers.get("location")).toBe("/dashboard");
  const dashboard = await call("/dashboard");
  expect(dashboard.status).toBe(200);
  expect(dashboard.headers.get("cache-control")).toBe("no-store");
  expect(dashboard.headers.get("content-security-policy")).toContain("default-src 'none'");
  expect(await dashboard.text()).toContain("No uploads yet.");
  expect((await call("/settings/api-keys")).status).toBe(503);
});

test("lists latest reports and videos across accounts in date order with escaped titles", async () => {
  const draft = await report("First report");
  await report("&lt;img src=x onerror=alert(1)&gt;", draft.draftId);
  await db.prepare("UPDATE drafts SET updated_at = ? WHERE id = ?").bind("2020-01-01T00:00:00.000Z", draft.draftId).run();
  const video = await env.MEDIA.put('<video onload="alert(1)">.mp4', new Response(recording).body, {
    maxBytes: 100, accountId: "another-account"
  });
  const html = await (await call("/dashboard")).text();
  expect(html).toContain("2 uploads");
  expect(html).toContain("Version 2");
  expect(html).not.toContain("First report");
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  expect(html).toContain("&lt;video onload=&quot;alert(1)&quot;&gt;.mp4");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("another-account");
  expect(html.indexOf(`/m/${video.name}`)).toBeLessThan(html.indexOf(`/d/${draft.draftId}`));
  for (const path of [`/m/${video.name}`, `/d/${draft.draftId}`]) expect((await call(path)).status).toBe(200);
});

test("deleted and disabled uploads disappear and incomplete media is ignored", async () => {
  const deleted = await report("Deleted report");
  const disabled = await report("Disabled report");
  const video = await (await upload()).json();
  const headers = { authorization: `Bearer ${KEY}` };
  expect((await call(`/api/drafts/${deleted.draftId}`, { method: "DELETE", headers })).status).toBe(200);
  expect((await call(`/api/drafts/${disabled.draftId}/disable`, { method: "POST", headers })).status).toBe(200);
  expect((await call(`/api/media/${video.mediaId}`, { method: "DELETE", headers })).status).toBe(200);
  const name = `${"a".repeat(32)}.mp4`;
  await writeFile(join(directory, "media", name), recording);
  await writeFile(join(directory, "media", `${name}.json`), "invalid json");
  await writeFile(join(directory, "media", "pending.mp4.tmp"), recording);
  expect(await (await call("/dashboard")).text()).toContain("No uploads yet.");
});

test("the public dashboard does not authorize uploads, deletion or key changes", async () => {
  await call("/dashboard");
  for (const [method, path] of [
    ["POST", "/api/uploads"], ["POST", "/api/media?filename=test.mp4"],
    ["DELETE", "/api/drafts/test"], ["DELETE", "/api/media/test.mp4"],
    ["POST", "/api/drafts/test/disable"], ["POST", "/api/api-keys"],
    ["POST", "/api/api-keys/test/revoke"]
  ]) expect((await call(path, { method })).status).toBe(401);
});
