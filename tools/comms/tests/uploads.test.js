import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileBucket, noAssets, SqliteD1 } from "../src/adapters.js";
import { createApp } from "../src/api.js";
import { MediaFiles } from "../src/media.js";
import { ProjectLogos } from "../src/projects.js";

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
    LOGOS: new ProjectLogos(join(directory, "projects")),
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

test("the public dashboard does not authorize uploads, API deletion, logos or key changes", async () => {
  await call("/dashboard");
  for (const [method, path] of [
    ["POST", "/api/uploads"], ["POST", "/api/media?filename=test.mp4"],
    ["DELETE", "/api/drafts/test"], ["DELETE", "/api/media/test.mp4"],
    ["POST", "/api/drafts/test/disable"], ["POST", "/api/api-keys"],
    ["POST", "/api/api-keys/test/revoke"], ["PUT", "/api/projects/test/logo"],
    ["DELETE", "/api/projects/test/logo"]
  ]) expect((await call(path, { method })).status).toBe(401);
});

const ORIGIN = "https://comms.test:8774";

async function video(filename, createdAt) {
  const item = await env.MEDIA.put(filename, new Response(recording).body, { maxBytes: 100, accountId: "acct_bootstrap" });
  if (createdAt) {
    const path = join(directory, "media", `${item.name}.json`);
    await Bun.write(path, JSON.stringify({ ...JSON.parse(await Bun.file(path).text()), createdAt }));
  }
  return item;
}

async function dated(draft, updatedAt) {
  await db.prepare("UPDATE drafts SET updated_at = ? WHERE id = ?").bind(updatedAt, draft.draftId).run();
}

function sliceOf(html, id) {
  const start = html.indexOf(`<details id="${id}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</details>", start));
}

test("a project's reports and videos share one collapsed group named by its report", async () => {
  const launch = await report("Smart Reminder · launch video v2");
  await dated(launch, "2026-10-05T10:00:00.000Z");
  const wide = await video("smart-reminder-launch-v2-wide.mp4", "2026-10-05T12:00:00.000Z");
  const square = await video("smart-reminder-launch-v2-square.mp4", "2026-10-05T11:00:00.000Z");
  const digest = await report("T3 Code update digest");
  await dated(digest, "2026-10-04T08:00:00.000Z");
  await video("tiro-promo-v14-33s-60fps.mp4", "2026-10-03T00:00:00.000Z");
  await video("tiro-promo-v13-33s.mp4", "2026-10-02T00:00:00.000Z");

  const html = await (await call("/dashboard")).text();
  expect(html).toContain("6 uploads in 2 projects");
  const group = sliceOf(html, "project-smart-reminder");
  expect(group).not.toContain(" open>");
  expect(group).toContain("Smart Reminder</span>");
  expect(group).toContain("1 report · 2 videos · Updated <time datetime=\"2026-10-05T12:00:00.000Z\">");
  // Newest first inside the group.
  const order = [`/m/${wide.name}`, `/m/${square.name}`, `/d/${launch.draftId}`].map((path) => group.indexOf(path));
  expect(order.every((position) => position > -1)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  // A group with no report is named from its filenames.
  expect(sliceOf(html, "project-tiro")).toContain("Tiro</span>");
  // A one-off upload stays a single row, after the newer group.
  expect(html.indexOf(`/d/${digest.draftId}`)).toBeGreaterThan(html.indexOf("project-smart-reminder"));
  expect(html).not.toContain('id="project-t3-code-update-digest"');
});

test("opening a group by name renders it expanded", async () => {
  await video("findus-promo-15s.mp4");
  await video("findus-promo-20s-web.mp4");
  expect(sliceOf(await (await call("/dashboard?open=findus")).text(), "project-findus")).toContain(" open>");
  expect(await (await call('/dashboard?open="><script>')).text()).not.toContain("<script>\"");
});

test("rows without a logo get an icon for what they are", async () => {
  await report("Learning tool research: existing top-down and zoom");
  await report("T3 Code update digest");
  await report("Payments migration");
  await video("MP4 playback test.mp4");
  const html = await (await call("/dashboard")).text();
  for (const kind of ["research", "digest", "report", "video"]) expect(html).toContain(`<span class="tile ${kind}">`);
  expect(html).not.toContain('class="tile project"');
});

test("a project logo replaces the generic icon on its group", async () => {
  await video("findus-promo-15s.mp4");
  await video("findus-promo-20s-web.mp4");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';
  const put = await call("/api/projects/findus/logo", { method: "PUT", headers: { authorization: `Bearer ${KEY}` }, body: svg });
  expect(put.status).toBe(200);
  const html = await (await call("/dashboard")).text();
  const src = html.match(/<img src="(\/projects\/findus\/logo\?v=[^"]+)" alt="">/)[1];
  const summary = sliceOf(html, "project-findus").split("</summary>")[0];
  expect(summary).toContain('class="tile logo"');
  expect(summary).not.toContain('class="tile video"');
  const logo = await call(src);
  expect(logo.status).toBe(200);
  expect(logo.headers.get("content-type")).toBe("image/svg+xml");
  expect(await logo.text()).toBe(svg);
});

test("the dashboard allows its own images, forms and nonce script, and nothing else", async () => {
  const response = await call("/dashboard");
  const html = await response.text();
  const nonce = html.match(/<script nonce="([^"]+)">/)[1];
  const policy = response.headers.get("content-security-policy");
  expect(policy).toContain(`script-src 'nonce-${nonce}'`);
  expect(policy).toContain("img-src 'self'");
  expect(policy).toContain("form-action 'self'");
  expect(policy).toContain("default-src 'none'");
  expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
});

test("deleting a video from the dashboard removes it and reopens its group", async () => {
  const first = await video("tiro-promo-v13-33s.mp4");
  await video("tiro-promo-v14-33s.mp4");
  const html = await (await call("/dashboard")).text();
  const action = `/dashboard/videos/${first.name}/delete?open=tiro`;
  expect(html).toContain(`action="${action}"`);
  expect(html).toContain("cannot be restored");

  const response = await call(action, { method: "POST", headers: { origin: ORIGIN } });
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/dashboard?open=tiro#project-tiro");
  expect((await call(`/m/${first.name}`)).status).toBe(404);
  expect(await readdir(join(directory, "media"))).not.toContain(first.name);
  expect((await call(action, { method: "POST", headers: { origin: ORIGIN } })).status).toBe(404);
});

test("deleting a report from the dashboard takes down every version", async () => {
  const draft = await report("Payments migration");
  await report("Payments migration v2", draft.draftId);
  const html = await (await call("/dashboard")).text();
  expect(html).toContain("and all 2 versions");
  const response = await call(`/dashboard/reports/${draft.draftId}/delete`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" }
  });
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/dashboard");
  expect((await call(`/d/${draft.draftId}`)).status).toBe(404);
  expect((await call(`/d/${draft.draftId}/v/1`)).status).toBe(404);
  expect(await (await call("/dashboard")).text()).toContain("No uploads yet.");
});

test("other origins cannot delete through the dashboard", async () => {
  const draft = await report("Kept report");
  const kept = await video("kept.mp4");
  for (const headers of [
    { origin: "https://comms.test:8801" },
    { origin: "null" },
    { "sec-fetch-site": "same-site" },
    {}
  ]) {
    expect((await call(`/dashboard/reports/${draft.draftId}/delete`, { method: "POST", headers })).status).toBe(403);
    expect((await call(`/dashboard/videos/${kept.name}/delete`, { method: "POST", headers })).status).toBe(403);
  }
  expect((await call(`/d/${draft.draftId}`)).status).toBe(200);
  expect((await call(`/m/${kept.name}`)).status).toBe(200);
});
