// The whole worker, run in process against a throwaway database and bucket.
// This is where the two deliberate changes from upstream are pinned down: an
// API key is required to upload, and a served draft may run its own inline
// script but nothing else.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { FileBucket, noAssets, SqliteD1 } from "../src/adapters.js";
import { createApp } from "../src/api.js";

const API_KEY = "test-bootstrap-key";
const PUBLIC_BASE_URL = "https://postplan.test";
const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

let directory;
let db;
let env;
let app;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "postplan-api-"));
  db = new SqliteD1(join(directory, "postplan.sqlite"));
  for (const name of (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort()) {
    await db.exec(await Bun.file(join(migrationsDir, name)).text());
  }
  env = {
    ASSETS: noAssets,
    DB: db,
    DRAFTS: new FileBucket(join(directory, "drafts")),
    POSTPLAN_BOOTSTRAP_API_KEY: API_KEY,
    POSTPLAN_PUBLIC_BASE_URL: PUBLIC_BASE_URL
  };
  app = createApp();
});

afterEach(async () => {
  db.close();
  await rm(directory, { recursive: true, force: true });
});

function call(path, init = {}) {
  return app.fetch(new Request(`http://127.0.0.1:3775${path}`, init), env, {
    waitUntil() {},
    passThroughOnException() {}
  });
}

function upload(body, key = API_KEY) {
  return call("/api/uploads", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {})
    },
    body: JSON.stringify(body)
  });
}

const document = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Weekly report</title></head>
<body><h1>Weekly report</h1><script>document.title = document.title;</script></body></html>`;

test("healthz reports the database is reachable", async () => {
  const response = await call("/healthz");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});

test("the missing assets binding 404s rather than erroring", async () => {
  expect((await call("/favicon.ico")).status).toBe(404);
});

test("an anonymous upload is refused", async () => {
  const response = await upload({ html: document }, null);
  expect(response.status).toBe(401);
  expect((await response.json()).error).toBe("Missing or invalid API key.");
});

test("a wrong API key is refused", async () => {
  expect((await upload({ html: document }, "not-the-key")).status).toBe(401);
  expect((await upload({ html: document }, `${API_KEY}x`)).status).toBe(401);
  expect((await upload({ html: document }, API_KEY.slice(0, -1))).status).toBe(401);
});

test("the API key is required on every authenticated route", async () => {
  expect((await call("/api/me")).status).toBe(401);
  expect((await call("/api/drafts")).status).toBe(401);
  const authorized = await call("/api/me", { headers: { authorization: `Bearer ${API_KEY}` } });
  expect(authorized.status).toBe(200);
  expect((await authorized.json()).accountName).toBe("Bootstrap Account");
});

test("a valid key publishes a draft at a stable URL", async () => {
  const response = await upload({ html: document, filename: "report.html" });
  expect(response.status).toBe(201);

  const body = await response.json();
  expect(body.ok).toBe(true);
  expect(body.versionNumber).toBe(1);
  expect(body.title).toBe("Weekly report");
  expect(body.publicUrl).toBe(`${PUBLIC_BASE_URL}/d/${body.draftId}`);

  const served = await call(`/d/${body.draftId}`);
  expect(served.status).toBe(200);
  expect(await served.text()).toBe(document);
});

test("re-uploading to the same draft adds a version in place", async () => {
  const first = await (await upload({ html: document, filename: "report.html" })).json();

  const updated = document.replace("Weekly report</h1>", "Weekly report, revised</h1>");
  const second = await upload({ html: updated, draftId: first.draftId, filename: "report.html" });
  expect(second.status).toBe(200);

  const body = await second.json();
  expect(body.draftId).toBe(first.draftId);
  expect(body.versionNumber).toBe(2);

  expect(await (await call(`/d/${first.draftId}`)).text()).toBe(updated);
  expect(await (await call(`/d/${first.draftId}/v/1`)).text()).toBe(document);
  expect(await (await call(`/d/${first.draftId}/v/2`)).text()).toBe(updated);

  const drafts = await (
    await call("/api/drafts", { headers: { authorization: `Bearer ${API_KEY}` } })
  ).json();
  expect(drafts.drafts).toHaveLength(1);
  expect(drafts.drafts[0].versionCount).toBe(2);
  expect(drafts.drafts[0].latestVersionNumber).toBe(2);
});

test("uploading to someone else's or a missing draft is a 404", async () => {
  expect((await upload({ html: document, draftId: "doesnotexist" })).status).toBe(404);
});

test("a served draft carries the CSP this host runs on", async () => {
  const { draftId } = await (await upload({ html: document })).json();
  const served = await call(`/d/${draftId}`);

  expect(served.headers.get("content-security-policy")).toBe(
    [
      "default-src 'none'",
      "script-src 'unsafe-inline'",
      "style-src 'unsafe-inline'",
      "img-src https: data:",
      "connect-src 'none'",
      "base-uri 'none'",
      "form-action 'none'"
    ].join("; ")
  );
  expect(served.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(served.headers.get("x-content-type-options")).toBe("nosniff");
  expect(served.headers.get("cache-control")).toBe("no-store");
  expect(served.headers.get("x-postplan-draft-version")).toBe("1");
});

test("what the CSP cannot block is blocked at upload instead", async () => {
  const head = (markup) => `<!doctype html><html><head><title>t</title>${markup}</head><body></body></html>`;
  const body = (markup) => `<!doctype html><html><head><title>t</title></head><body>${markup}</body></html>`;

  const cases = {
    "external script": body('<script src="https://evil.test/x.js"></script>'),
    form: body('<form action="https://evil.test"><input name=a></form>'),
    iframe: body('<iframe src="https://evil.test"></iframe>'),
    object: body('<object data="https://evil.test"></object>'),
    "event handler": body('<img src="x.png" onerror="alert(1)">'),
    "javascript: url": body('<a href="javascript:alert(1)">x</a>'),
    "meta refresh": head('<meta http-equiv="refresh" content="0;url=https://evil.test">'),
    base: head('<base href="https://evil.test/">'),
    "external stylesheet": head('<link rel="stylesheet" href="https://evil.test/x.css">'),

    // Spellings that slipped past the policy until the first critic round:
    // an SVG script uses href, and a <template>'s children live in a separate
    // fragment that the walker did not visit.
    "svg script href": body('<svg><script href="https://evil.test/x.js"></script></svg>'),
    "svg script xlink:href": body('<svg><script xlink:href="https://evil.test/x.js"></script></svg>'),
    "script inside a template": body('<template><script src="https://evil.test/x.js"></script></template>'),
    "iframe inside a template": body('<template><iframe src="https://evil.test"></iframe></template>'),
    "form inside a template": body('<template><form action="https://evil.test"></form></template>'),
    "event handler inside a template": body('<template><div onclick="alert(1)"></div></template>'),
    "script inside a nested template": body(
      '<template><template><script src="https://evil.test/x.js"></script></template></template>'
    ),
    portal: body('<portal src="https://evil.test"></portal>'),
    frameset: '<!doctype html><html><head><title>t</title></head><frameset><frame src="https://evil.test"></frameset></html>'
  };

  for (const [name, html] of Object.entries(cases)) {
    const response = await upload({ html });
    expect(`${name}: ${response.status}`).toBe(`${name}: 422`);
    expect((await response.json()).errors.length).toBeGreaterThan(0);
  }
});

test("ordinary documents are not caught by the tightened policy", async () => {
  const allowed = {
    "inline script": "<script>document.title = document.title;</script>",
    "template of plain markup": '<template><div class="row"><span>ok</span></div></template>',
    "svg sprite with an internal reference": '<svg><use href="#icon"></use></svg>',
    "https image": '<img src="https://example.com/chart.png">',
    "data image": '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">'
  };

  for (const [name, markup] of Object.entries(allowed)) {
    const response = await upload({
      html: `<!doctype html><html><head><title>t</title></head><body>${markup}</body></html>`
    });
    expect(`${name}: ${response.status}`).toBe(`${name}: 201`);
  }
});

test("the client IP comes from the header Tailscale Serve actually sets", async () => {
  // Measured on this host: Serve replaces any client-supplied X-Forwarded-For
  // with the tailnet peer, but passes CF-Connecting-IP and X-Real-IP straight
  // through. So when X-Forwarded-For is present, nothing else may be consulted.
  const response = await call("/api/uploads", {
    method: "POST",
    headers: {
      authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
      "x-forwarded-for": "100.80.149.67",
      "cf-connecting-ip": "192.0.2.55",
      "x-real-ip": "203.0.113.9"
    },
    body: JSON.stringify({ html: document })
  });
  expect(response.status).toBe(201);

  const recorded = await db
    .prepare("SELECT source_ip FROM draft_versions ORDER BY created_at DESC LIMIT 1")
    .first("source_ip");
  expect(recorded).toBe("100.80.149.67");

  const buckets = await db.prepare("SELECT bucket_key FROM rate_limits").all();
  const keys = buckets.results.map((row) => row.bucket_key);
  expect(keys).toContain("upload-ip:100.80.149.67");
  expect(keys).not.toContain("upload-ip:192.0.2.55");
  expect(keys).not.toContain("upload-ip:203.0.113.9");
});

test("neither spoofable header can stand in for the peer address", async () => {
  for (const header of ["cf-connecting-ip", "x-real-ip"]) {
    const response = await call("/api/uploads", {
      method: "POST",
      headers: {
        authorization: `Bearer ${API_KEY}`,
        "content-type": "application/json",
        "x-forwarded-for": "100.80.149.67",
        [header]: "192.0.2.55"
      },
      body: JSON.stringify({ html: document })
    });
    expect(`${header}: ${response.status}`).toBe(`${header}: 201`);
    expect(
      await db
        .prepare("SELECT source_ip FROM draft_versions ORDER BY created_at DESC LIMIT 1")
        .first("source_ip")
    ).toBe("100.80.149.67");
  }
});

test("with no proxy in front, the Cloudflare header is still honoured", async () => {
  // Direct loopback access only: a caller who can reach 127.0.0.1 is already on
  // the machine, and on Cloudflare this header is set by the edge.
  const response = await call("/api/uploads", {
    method: "POST",
    headers: {
      authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
      "cf-connecting-ip": "192.0.2.55"
    },
    body: JSON.stringify({ html: document })
  });
  expect(response.status).toBe(201);
  expect(
    await db
      .prepare("SELECT source_ip FROM draft_versions ORDER BY created_at DESC LIMIT 1")
      .first("source_ip")
  ).toBe("192.0.2.55");
});

test("a proxy chain is read from its first entry", async () => {
  const response = await call("/api/uploads", {
    method: "POST",
    headers: {
      authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
      "x-forwarded-for": "100.80.149.67, 10.0.0.1"
    },
    body: JSON.stringify({ html: document })
  });
  expect(response.status).toBe(201);
  expect(
    await db
      .prepare("SELECT source_ip FROM draft_versions ORDER BY created_at DESC LIMIT 1")
      .first("source_ip")
  ).toBe("100.80.149.67");
});

test("an inline script is allowed through, which is why the key is required", async () => {
  const response = await upload({ html: document });
  expect(response.status).toBe(201);
  expect((await response.json()).warnings).toEqual([]);
});

test("a document over the size cap is refused", async () => {
  const big = `<!doctype html><title>big</title><p>${"x".repeat(520 * 1024)}`;
  const response = await upload({ html: big });
  expect(response.status).toBe(422);
  expect((await response.json()).errors[0]).toMatch(/maximum is 524288 bytes/);
});

test("a deleted draft stops being served", async () => {
  const { draftId } = await (await upload({ html: document })).json();
  const deleted = await call(`/api/drafts/${draftId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${API_KEY}` }
  });
  expect(deleted.status).toBe(200);
  expect((await call(`/d/${draftId}`)).status).toBe(404);
});

test("a disabled draft stops being served", async () => {
  const { draftId } = await (await upload({ html: document })).json();
  const disabled = await call(`/api/drafts/${draftId}/disable`, {
    method: "POST",
    headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ reason: "test" })
  });
  expect(disabled.status).toBe(200);
  expect((await call(`/d/${draftId}`)).status).toBe(404);
});

test("an unknown draft renders the not-found page, not an error", async () => {
  const response = await call("/d/nosuchdraft");
  expect(response.status).toBe(404);
  expect(response.headers.get("content-type")).toContain("text/html");
});

test("a minted key works and revoking it stops working", async () => {
  const minted = await (
    await call("/api/api-keys", {
      method: "POST",
      headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "CI" })
    })
  ).json();
  expect(minted.token).toStartWith("pp_");

  expect((await upload({ html: document }, minted.token)).status).toBe(201);

  const revoked = await call(`/api/api-keys/${minted.apiKey.id}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${API_KEY}` }
  });
  expect(revoked.status).toBe(200);
  expect((await upload({ html: document }, minted.token)).status).toBe(401);
});
