// The adapters stand in for D1 and R2, so what is tested here is the shape of
// what they hand back, not just that they store things.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileBucket, noAssets, SqliteD1 } from "../src/adapters.js";

async function leftoverTempFiles(root) {
  const found = [];
  async function walk(path) {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(join(path, entry.name));
      else if (entry.name.endsWith(".tmp")) found.push(entry.name);
    }
  }
  await walk(root);
  return found;
}

let directory;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "postplan-adapters-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function newDatabase() {
  const db = new SqliteD1(join(directory, "test.sqlite"));
  db.db.exec(`
    CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE parts (id INTEGER PRIMARY KEY, widget_id INTEGER NOT NULL REFERENCES widgets(id));
  `);
  return db;
}

describe("SqliteD1", () => {
  test("first() returns the row, or the named column, or null", async () => {
    const db = newDatabase();
    await db.prepare("INSERT INTO widgets (name, count) VALUES (?, ?)").bind("hammer", 3).run();

    expect(await db.prepare("SELECT * FROM widgets WHERE name = ?").bind("hammer").first()).toEqual({
      id: 1,
      name: "hammer",
      count: 3
    });
    expect(
      await db.prepare("SELECT count FROM widgets WHERE name = ?").bind("hammer").first("count")
    ).toBe(3);
    expect(await db.prepare("SELECT * FROM widgets WHERE name = ?").bind("nothing").first()).toBeNull();
    expect(
      await db.prepare("SELECT * FROM widgets WHERE name = ?").bind("nothing").first("count")
    ).toBeNull();
    db.close();
  });

  test("first() raises rather than inventing a null for an unknown column", async () => {
    const db = newDatabase();
    await db.prepare("INSERT INTO widgets (name) VALUES (?)").bind("hammer").run();
    await expect(
      db.prepare("SELECT name FROM widgets").first("nope")
    ).rejects.toThrow(/D1_COLUMN_NOTFOUND/);
    db.close();
  });

  test("bind() rejects undefined instead of storing NULL", async () => {
    const db = newDatabase();
    expect(() => db.prepare("INSERT INTO widgets (name) VALUES (?)").bind(undefined)).toThrow(
      /D1_TYPE_ERROR/
    );
    expect(() => db.prepare("INSERT INTO widgets (name) VALUES (?)").bind(null)).not.toThrow();
    db.close();
  });

  test("all() returns a D1 result with results, success and meta", async () => {
    const db = newDatabase();
    await db.prepare("INSERT INTO widgets (name) VALUES (?), (?)").bind("a", "b").run();

    const result = await db.prepare("SELECT name FROM widgets ORDER BY name").all();
    expect(result.success).toBe(true);
    expect(result.results).toEqual([{ name: "a" }, { name: "b" }]);
    expect(result.meta.rows_read).toBe(2);
    expect(result.meta.changes).toBe(0);
    expect(result.meta.changed_db).toBe(false);
    db.close();
  });

  test("run() reports changes, so a no-op update is distinguishable", async () => {
    const db = newDatabase();
    const inserted = await db.prepare("INSERT INTO widgets (name) VALUES (?)").bind("a").run();
    expect(inserted.meta.changes).toBe(1);
    expect(inserted.meta.last_row_id).toBe(1);
    expect(inserted.results).toEqual([]);

    const hit = await db.prepare("UPDATE widgets SET count = 1 WHERE name = ?").bind("a").run();
    expect(hit.meta.changes).toBe(1);

    const miss = await db.prepare("UPDATE widgets SET count = 1 WHERE name = ?").bind("z").run();
    expect(miss.meta.changes).toBe(0);
    expect(miss.meta.changed_db).toBe(false);
    db.close();
  });

  test("a RETURNING clause comes back in results, from run() and from batch()", async () => {
    const db = newDatabase();
    await db.prepare("INSERT INTO widgets (name, count) VALUES (?, 0)").bind("a").run();

    const direct = await db
      .prepare("UPDATE widgets SET count = count + 1 WHERE name = ? RETURNING count")
      .bind("a")
      .run();
    expect(direct.results).toEqual([{ count: 1 }]);

    const [batched] = await db.batch([
      db.prepare("UPDATE widgets SET count = count + 1 WHERE name = ? RETURNING count").bind("a")
    ]);
    expect(batched.results).toEqual([{ count: 2 }]);
    db.close();
  });

  test("batch() is one transaction and rolls back as a whole", async () => {
    const db = newDatabase();
    await expect(
      db.batch([
        db.prepare("INSERT INTO widgets (name) VALUES (?)").bind("kept"),
        db.prepare("INSERT INTO widgets (id, name) VALUES (1, ?)").bind("clashes")
      ])
    ).rejects.toThrow();

    const count = await db.prepare("SELECT COUNT(*) AS n FROM widgets").first("n");
    expect(count).toBe(0);
    db.close();
  });

  test("batch() rejects anything that is not a prepared statement", async () => {
    const db = newDatabase();
    await expect(db.batch(["SELECT 1"])).rejects.toThrow(TypeError);
    db.close();
  });

  test("raw() returns arrays, with column names on request", async () => {
    const db = newDatabase();
    await db.prepare("INSERT INTO widgets (name, count) VALUES (?, ?)").bind("a", 2).run();

    expect(await db.prepare("SELECT name, count FROM widgets").raw()).toEqual([["a", 2]]);
    expect(await db.prepare("SELECT name, count FROM widgets").raw({ columnNames: true })).toEqual([
      ["name", "count"],
      ["a", 2]
    ]);
    db.close();
  });

  test("exec() runs several statements and counts them", async () => {
    const db = newDatabase();
    const result = await db.exec(
      "INSERT INTO widgets (name) VALUES ('x'); INSERT INTO widgets (name) VALUES ('y');"
    );
    expect(result.count).toBe(2);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM widgets").first("n")).toBe(2);
    db.close();
  });

  test("foreign keys are enforced, as they are on D1", async () => {
    const db = newDatabase();
    await expect(
      db.prepare("INSERT INTO parts (widget_id) VALUES (?)").bind(999).run()
    ).rejects.toThrow();
    db.close();
  });
});

describe("FileBucket", () => {
  const html = "<!doctype html><title>Report</title><p>hello";

  test("put() returns an R2Object and get() returns its body once", async () => {
    const bucket = new FileBucket(join(directory, "bucket"));
    const put = await bucket.put("drafts/a/versions/1.html", html, {
      httpMetadata: { contentType: "text/html; charset=utf-8", cacheControl: "no-store" }
    });
    expect(put.key).toBe("drafts/a/versions/1.html");
    expect(put.size).toBe(html.length);
    expect(put.etag).toMatch(/^[0-9a-f]{32}$/);
    expect(put.httpEtag).toBe(`"${put.etag}"`);
    expect(put.uploaded).toBeInstanceOf(Date);

    const object = await bucket.get("drafts/a/versions/1.html");
    expect(object.size).toBe(html.length);
    expect(object.etag).toBe(put.etag);
    expect(object.httpMetadata.contentType).toBe("text/html; charset=utf-8");
    expect(object.bodyUsed).toBe(false);
    expect(await new Response(object.body).text()).toBe(html);
    expect(object.bodyUsed).toBe(true);
    expect(() => object.body).toThrow(TypeError);
  });

  test("the body reads as text, bytes and an ArrayBuffer", async () => {
    const bucket = new FileBucket(join(directory, "bucket"));
    await bucket.put("k.html", html);

    expect(await (await bucket.get("k.html")).text()).toBe(html);
    expect((await (await bucket.get("k.html")).arrayBuffer()).byteLength).toBe(html.length);
    expect(await (await bucket.get("k.html")).bytes()).toEqual(new TextEncoder().encode(html));
  });

  test("get() and head() return null for a missing key", async () => {
    const bucket = new FileBucket(join(directory, "bucket"));
    expect(await bucket.get("nope.html")).toBeNull();
    expect(await bucket.head("nope.html")).toBeNull();
  });

  test("head() returns metadata without a body", async () => {
    const bucket = new FileBucket(join(directory, "bucket"));
    await bucket.put("k.html", html, { httpMetadata: { cacheControl: "no-store" } });

    const head = await bucket.head("k.html");
    expect(head.size).toBe(html.length);
    expect(head.httpMetadata.cacheControl).toBe("no-store");
    expect(head.body).toBeUndefined();
  });

  test("writeHttpMetadata() fills response headers", async () => {
    const bucket = new FileBucket(join(directory, "bucket"));
    await bucket.put("k.html", html, { httpMetadata: { contentType: "text/html" } });

    const headers = new Headers();
    (await bucket.head("k.html")).writeHttpMetadata(headers);
    expect(headers.get("content-type")).toBe("text/html");
  });

  test("delete() removes one key or many, and ignores missing ones", async () => {
    const bucket = new FileBucket(join(directory, "bucket"));
    await bucket.put("a.html", html);
    await bucket.put("b.html", html);

    await bucket.delete("a.html");
    expect(await bucket.get("a.html")).toBeNull();

    await bucket.delete(["b.html", "never-existed.html"]);
    expect(await bucket.get("b.html")).toBeNull();
  });

  test("list() honours prefix, limit, cursor and delimiter", async () => {
    const bucket = new FileBucket(join(directory, "bucket"));
    await bucket.put("drafts/one/versions/1.html", html);
    await bucket.put("drafts/two/versions/1.html", html);
    await bucket.put("other/1.html", html);

    const all = await bucket.list({ prefix: "drafts/" });
    expect(all.objects.map((object) => object.key)).toEqual([
      "drafts/one/versions/1.html",
      "drafts/two/versions/1.html"
    ]);
    expect(all.truncated).toBe(false);

    const first = await bucket.list({ prefix: "drafts/", limit: 1 });
    expect(first.truncated).toBe(true);
    expect(first.objects).toHaveLength(1);

    const next = await bucket.list({ prefix: "drafts/", cursor: first.cursor });
    expect(next.objects.map((object) => object.key)).toEqual(["drafts/two/versions/1.html"]);

    const rolled = await bucket.list({ prefix: "drafts/", delimiter: "/" });
    expect(rolled.objects).toHaveLength(0);
    expect(rolled.delimitedPrefixes).toEqual(["drafts/one/", "drafts/two/"]);
  });

  test("list() only includes metadata when asked, as R2 does", async () => {
    const bucket = new FileBucket(join(directory, "bucket"));
    await bucket.put("k.html", html, { httpMetadata: { contentType: "text/html" } });

    const lean = await bucket.list({});
    expect(lean.objects[0].httpMetadata).toBeUndefined();
    expect(lean.objects[0].size).toBe(html.length);

    const full = await bucket.list({ include: ["httpMetadata", "customMetadata"] });
    expect(full.objects[0].httpMetadata.contentType).toBe("text/html");
    expect(full.objects[0].customMetadata).toEqual({});
  });

  test("a key cannot climb out of the bucket directory", async () => {
    const bucket = new FileBucket(join(directory, "bucket"));
    for (const key of ["../escaped.html", "..", "../../etc/passwd", "a/../../escaped.html"]) {
      await expect(bucket.put(key, html)).rejects.toThrow(/Unsafe R2 key/);
      await expect(bucket.get(key)).rejects.toThrow(/Unsafe R2 key/);
    }
  });

  test("a key may legitimately start with dots", async () => {
    const bucket = new FileBucket(join(directory, "bucket"));
    for (const key of ["..foo.html", ".hidden.html", "a/..b.html"]) {
      await bucket.put(key, html);
      expect(await (await bucket.get(key)).text()).toBe(html);
    }
  });

  test("unimplemented R2 options fail loudly instead of being ignored", async () => {
    const bucket = new FileBucket(join(directory, "bucket"));
    await bucket.put("k.html", html);
    await expect(bucket.get("k.html", { range: { offset: 0, length: 2 } })).rejects.toThrow(
      /not implemented/
    );
    await expect(bucket.put("k.html", html, { onlyIf: { etagMatches: "x" } })).rejects.toThrow(
      /not implemented/
    );
  });

  test("two writers to one key do not collide", async () => {
    const bucket = new FileBucket(join(directory, "bucket"));
    const a = "a".repeat(5000);
    const b = "b".repeat(5000);
    await Promise.all([bucket.put("k.html", a), bucket.put("k.html", b)]);

    const text = await (await bucket.get("k.html")).text();
    expect([a, b]).toContain(text);
    expect(await leftoverTempFiles(join(directory, "bucket"))).toEqual([]);
  });

  test("a put that cannot complete leaves no temp file behind", async () => {
    const root = join(directory, "bucket");
    const bucket = new FileBucket(root);
    // A directory where the object should go makes the rename fail, which is
    // the same shape of failure a full disk produces.
    await mkdir(join(root, "k.html"), { recursive: true });

    await expect(bucket.put("k.html", html)).rejects.toThrow();
    expect(await leftoverTempFiles(root)).toEqual([]);
  });

  test("a corrupt metadata sidecar falls back instead of failing the read", async () => {
    const root = join(directory, "bucket");
    const bucket = new FileBucket(root);
    await bucket.put("k.html", html, { httpMetadata: { contentType: "text/html" } });
    await Bun.write(join(root, ".r2-meta", "k.html.json"), "{ truncated");

    const object = await bucket.get("k.html");
    expect(await object.text()).toBe(html);
    expect(object.size).toBe(html.length);
    expect(object.httpMetadata).toEqual({});
  });

  test("an object written without a metadata sidecar still reads back", async () => {
    const root = join(directory, "bucket");
    const bucket = new FileBucket(root);
    await Bun.write(join(root, "legacy.html"), html);

    const object = await bucket.get("legacy.html");
    expect(await object.text()).toBe(html);
    expect(object.size).toBe(html.length);
    expect(object.httpMetadata).toEqual({});
  });
});

test("the ASSETS stand-in 404s instead of crashing", async () => {
  const response = await noAssets.fetch(new Request("http://localhost/favicon.ico"));
  expect(response.status).toBe(404);
});
