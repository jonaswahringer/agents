import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileBucket, noAssets, SqliteD1 } from "../src/adapters.js";
import { createApp } from "../src/api.js";
import { MediaFiles } from "../src/media.js";
import { groupUploads, ProjectLogos, projectOf } from "../src/projects.js";

let directory;
let db;
let env;
let app;
const KEY = "projects-test-key";
const SVG = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "comms-projects-"));
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

function putLogo(slug, body, key = KEY) {
  return call(`/api/projects/${slug}/logo`, {
    method: "PUT",
    headers: key ? { authorization: `Bearer ${key}` } : {},
    body
  });
}

test.each([
  ["Smart Reminder · launch video v13", "smart-reminder", "Smart Reminder"],
  ["smart-reminder-launch-v13-wide.mp4", "smart-reminder", null],
  ["smart-reminder-launch-vertical.mp4", "smart-reminder", null],
  ["tiro-promo-v14-33s-60fps.mp4", "tiro", null],
  ["findus-promo-20s-web.mp4", "findus", null],
  ["Learning tool research: existing top-down and zoom", "learning-tool-research", "Learning tool research"],
  ["Reader-editable blocks — prototype", "reader-editable-blocks", "Reader-editable blocks"],
  ["T3 Code update digest", "t3-code-update-digest", "T3 Code update digest"],
  ["MP4 playback test.mp4", "mp4-playback-test", "MP4 playback test"],
  ["Café Crème | menu", "cafe-creme", "Café Crème"],
  ["Release at 12:30", "release-at-12-30", "Release at 12:30"],
  ["launch-v2-wide.mp4", "launch", null]
])("%p belongs to project %p", (name, slug, label) => {
  expect(projectOf(name)).toEqual({ slug, label });
});

test("a name with no letters or digits gives no project", () => {
  expect(projectOf("🎬.mp4")).toBeNull();
  const groups = groupUploads([
    { kind: "video", title: "🎬.mp4", path: "/m/a", date: "2026-01-02" },
    { kind: "video", title: "🎞.mp4", path: "/m/b", date: "2026-01-01" }
  ]);
  expect(groups.map((group) => [group.slug, group.items.length])).toEqual([[null, 1], [null, 1]]);
});

test("the newest report names its group", () => {
  const [group] = groupUploads([
    { kind: "video", title: "smart-reminder-launch-v3-wide.mp4", path: "/m/a", date: "2026-01-04" },
    { kind: "report", title: "smart reminder · old notes", path: "/d/a", date: "2026-01-01" },
    { kind: "report", title: "Smart Reminder · storyboard", path: "/d/b", date: "2026-01-03" }
  ]);
  expect(group.name).toBe("Smart Reminder");
  expect(group.latest).toBe("2026-01-04");
  expect(group.items.map((item) => item.path)).toEqual(["/m/a", "/d/b", "/d/a"]);
});

test("a logo upload is typed from its bytes and replaces the previous one", async () => {
  const first = await putLogo("smart-reminder", SVG);
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({
    ok: true,
    project: "smart-reminder",
    contentType: "image/svg+xml",
    logoUrl: "https://comms.test:8774/projects/smart-reminder/logo"
  });
  const svg = await call("/projects/smart-reminder/logo");
  expect(svg.headers.get("content-type")).toBe("image/svg+xml");
  expect(svg.headers.get("content-security-policy")).toContain("sandbox");
  expect(svg.headers.get("x-content-type-options")).toBe("nosniff");

  expect((await putLogo("smart-reminder", PNG)).status).toBe(200);
  expect(await readdir(join(directory, "projects"))).toEqual(["smart-reminder.png"]);
  const png = await call("/projects/smart-reminder/logo");
  expect(png.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await png.arrayBuffer())).toEqual(PNG);
});

test("logo uploads need a key, a slug and an image of modest size", async () => {
  expect((await putLogo("findus", SVG, null)).status).toBe(401);
  expect((await putLogo("findus", SVG, "wrong")).status).toBe(401);
  expect((await putLogo("Findus", SVG)).status).toBe(400);
  expect((await putLogo("..%2Fescape", SVG)).status).toBe(400);
  expect((await putLogo("findus", "")).status).toBe(400);
  expect((await putLogo("findus", "<html><script>alert(1)</script></html>")).status).toBe(415);
  expect((await putLogo("findus", `<svg>${" ".repeat(256 * 1024)}</svg>`)).status).toBe(413);
  expect((await call("/projects/findus/logo")).status).toBe(404);
  expect((await call("/projects/..%2Fpostplan.sqlite/logo")).status).toBe(404);
});

test("deleting a logo returns the group to its generic icon", async () => {
  await putLogo("findus", SVG);
  const headers = { authorization: `Bearer ${KEY}` };
  expect((await call("/api/projects/findus/logo", { method: "DELETE", headers })).status).toBe(200);
  expect((await call("/projects/findus/logo")).status).toBe(404);
  expect((await call("/api/projects/findus/logo", { method: "DELETE", headers })).status).toBe(404);
});

test("the publish-logo command uploads a logo through an actual HTTP server", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => app.fetch(request, env) });
  const path = join(directory, "brand logo.svg");
  await writeFile(path, SVG);
  try {
    const child = Bun.spawn([process.execPath, new URL("../scripts/publish-logo.js", import.meta.url).pathname, "findus", path], {
      env: { ...Bun.env, POSTPLAN_API_URL: `http://127.0.0.1:${server.port}`, POSTPLAN_API_KEY: KEY },
      stdout: "pipe",
      stderr: "pipe"
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, project: "findus", contentType: "image/svg+xml" });
    expect(await (await call("/projects/findus/logo")).text()).toBe(SVG);
  } finally {
    await server.stop(true);
  }
});
