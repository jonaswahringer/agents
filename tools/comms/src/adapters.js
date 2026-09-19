// D1 and R2 stand-ins, so the Cloudflare worker in src/ runs unchanged on Bun.
// D1 becomes bun:sqlite, R2 becomes a directory on disk.
//
// The shapes follow Cloudflare's documented APIs, because src/ is upstream code
// that expects them: D1 hands back { success, meta, results }, R2 hands back an
// R2Object (or null) whose body can be read exactly once. Anything the local
// version cannot honestly provide throws instead of pretending.
import { Database } from "bun:sqlite";
import { mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

// ---------------------------------------------------------------- D1 -------

class D1PreparedStatement {
  constructor(database, sql, params = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }

  // D1 rejects undefined rather than storing it as NULL, and so does this.
  bind(...params) {
    for (const [index, param] of params.entries()) {
      if (param === undefined) {
        throw new TypeError(`D1_TYPE_ERROR: parameter ${index + 1} is undefined; use null.`);
      }
    }
    return new D1PreparedStatement(this.database, this.sql, params);
  }

  // D1 runs the whole query and hands back the first row, so this does too.
  // Every query in src/ is LIMIT 1 or a RETURNING clause, and stepping a
  // RETURNING statement only part way would leave its writes half applied.
  async first(column) {
    const { results } = this.database.execute(this.sql, this.params);
    const row = results[0] ?? null;
    if (column === undefined) return row;
    if (!row) return null;
    // D1 raises D1_COLUMN_NOTFOUND rather than quietly handing back null.
    if (!(column in row)) {
      throw new Error(`D1_COLUMN_NOTFOUND: column "${column}" is not in the result.`);
    }
    return row[column];
  }

  async all() {
    return this.database.execute(this.sql, this.params);
  }

  async run() {
    return this.database.execute(this.sql, this.params);
  }

  async raw(options = {}) {
    return this.database.executeRaw(this.sql, this.params, options);
  }
}

export class SqliteD1 {
  constructor(path) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  prepare(sql) {
    return new D1PreparedStatement(this, sql);
  }

  // D1 runs a batch inside one transaction and returns one result per statement,
  // each with its own rows. Statements with a RETURNING clause depend on that.
  async batch(statements) {
    for (const statement of statements) {
      if (!(statement instanceof D1PreparedStatement)) {
        throw new TypeError("D1 batch takes prepared statements.");
      }
    }
    const run = this.db.transaction(() =>
      statements.map((statement) => this.execute(statement.sql, statement.params))
    );
    return run();
  }

  // D1's exec is for migrations and setup: many statements, no parameters.
  async exec(sql) {
    const started = performance.now();
    this.db.exec(sql);
    return { count: countStatements(sql), duration: performance.now() - started };
  }

  close() {
    this.db.close();
  }

  // Runs a statement to completion and reports it the way D1 does. Running to
  // completion matters: a RETURNING clause emits its rows as the write happens,
  // so stepping only the first row would leave the write half applied.
  execute(sql, params) {
    const before = this.#totalChanges();
    const started = performance.now();
    const results = this.#statement(sql).all(...params);
    const duration = performance.now() - started;

    const wrote = this.#totalChanges() !== before;
    const counters = wrote
      ? this.db.query("SELECT changes() AS changes, last_insert_rowid() AS rowid").get()
      : null;
    const changes = Number(counters?.changes ?? 0);

    // Best effort D1 meta: these come from SQLite itself. size_after, served_by
    // and the rest of D1's telemetry have no local meaning and are left out
    // rather than faked.
    return {
      success: true,
      meta: {
        duration,
        changes,
        last_row_id: Number(counters?.rowid ?? 0),
        changed_db: wrote,
        rows_read: results.length,
        rows_written: changes
      },
      results
    };
  }

  executeRaw(sql, params, options = {}) {
    const statement = this.#statement(sql);
    const rows = statement.values(...params);
    return options.columnNames ? [statement.columnNames, ...rows] : rows;
  }

  #totalChanges() {
    return Number(this.db.query("SELECT total_changes() AS total").get()?.total ?? 0);
  }

  // bun:sqlite caches prepared statements per SQL string, which is what we want
  // for the fixed set of queries in src/.
  #statement(sql) {
    return this.db.query(sql);
  }
}

function countStatements(sql) {
  return sql
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.split("\n").every((line) => line.trim().startsWith("--")))
    .length;
}

// ---------------------------------------------------------------- R2 -------

const META_DIR = ".r2-meta";

class LocalR2Object {
  constructor({ key, size, etag, uploaded, httpMetadata, customMetadata }) {
    this.key = key;
    this.version = etag;
    this.size = size;
    this.etag = etag;
    this.httpEtag = `"${etag}"`;
    this.uploaded = uploaded;
    // Left undefined when list() was not asked to include them, as R2 does.
    this.httpMetadata = httpMetadata;
    this.customMetadata = customMetadata;
  }

  writeHttpMetadata(headers) {
    if (!this.httpMetadata) return;
    const map = {
      contentType: "content-type",
      contentLanguage: "content-language",
      contentDisposition: "content-disposition",
      contentEncoding: "content-encoding",
      cacheControl: "cache-control"
    };
    for (const [property, header] of Object.entries(map)) {
      const value = this.httpMetadata[property];
      if (value) headers.set(header, value);
    }
    if (this.httpMetadata.cacheExpiry instanceof Date) {
      headers.set("expires", this.httpMetadata.cacheExpiry.toUTCString());
    }
  }
}

class LocalR2ObjectBody extends LocalR2Object {
  #file;
  #used = false;

  constructor(metadata, file) {
    super(metadata);
    this.#file = file;
  }

  get bodyUsed() {
    return this.#used;
  }

  get body() {
    this.#consume();
    return this.#file.stream();
  }

  arrayBuffer() {
    this.#consume();
    return this.#file.arrayBuffer();
  }

  bytes() {
    this.#consume();
    return this.#file.bytes();
  }

  text() {
    this.#consume();
    return this.#file.text();
  }

  async json() {
    return JSON.parse(await this.text());
  }

  blob() {
    this.#consume();
    return Promise.resolve(this.#file);
  }

  #consume() {
    if (this.#used) throw new TypeError("R2 object body has already been used.");
    this.#used = true;
  }
}

export class FileBucket {
  constructor(root) {
    this.root = resolve(root);
  }

  async put(key, value, options = {}) {
    rejectUnsupported(options, "put");
    const bytes = await toBytes(value);
    const path = this.#path(key);
    const uploaded = new Date();
    const etag = new Bun.CryptoHasher("md5").update(bytes).digest("hex");
    const metadata = {
      key,
      size: bytes.byteLength,
      etag,
      uploaded: uploaded.toISOString(),
      httpMetadata: normalizeHttpMetadata(options.httpMetadata),
      customMetadata: options.customMetadata ?? {}
    };

    await mkdir(dirname(path), { recursive: true });
    await writeThenRename(path, bytes);
    await this.#writeMetadata(key, metadata);

    return new LocalR2Object({ ...metadata, uploaded });
  }

  async get(key, options = {}) {
    rejectUnsupported(options, "get");
    const path = this.#path(key);
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    return new LocalR2ObjectBody(await this.#metadata(key, path), file);
  }

  async head(key) {
    const path = this.#path(key);
    if (!(await Bun.file(path).exists())) return null;
    return new LocalR2Object(await this.#metadata(key, path));
  }

  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      await removeIfPresent(this.#path(key));
      await removeIfPresent(this.#metadataPath(key));
    }
  }

  async list(options = {}) {
    const { prefix = "", delimiter, cursor, limit = 1000, include = [] } = options;
    const keys = (await this.#walk("")).filter((key) => key.startsWith(prefix)).sort();

    const objects = [];
    const delimitedPrefixes = new Set();
    let started = !cursor;
    let truncated = false;
    let lastKey = null;

    for (const key of keys) {
      if (!started) {
        if (key === cursor) started = true;
        continue;
      }
      if (delimiter) {
        const index = key.indexOf(delimiter, prefix.length);
        if (index !== -1) {
          delimitedPrefixes.add(key.slice(0, index + delimiter.length));
          continue;
        }
      }
      if (objects.length >= limit) {
        truncated = true;
        break;
      }
      // R2 omits httpMetadata and customMetadata from list results unless they
      // were asked for, so listing stays cheap.
      const metadata = await this.#metadata(key, this.#path(key));
      objects.push(
        new LocalR2Object({
          ...metadata,
          httpMetadata: include.includes("httpMetadata") ? metadata.httpMetadata : undefined,
          customMetadata: include.includes("customMetadata") ? metadata.customMetadata : undefined
        })
      );
      lastKey = key;
    }

    return truncated
      ? { objects, truncated: true, cursor: lastKey, delimitedPrefixes: [...delimitedPrefixes] }
      : { objects, truncated: false, delimitedPrefixes: [...delimitedPrefixes] };
  }

  #path(key) {
    return this.#resolveUnder(this.root, key);
  }

  #metadataPath(key) {
    return this.#resolveUnder(join(this.root, META_DIR), `${key}.json`);
  }

  // R2 keys are opaque strings; on a filesystem they become paths, so a key
  // must never climb out of the bucket directory.
  #resolveUnder(base, key) {
    if (typeof key !== "string" || !key) throw new TypeError("R2 key must be a non-empty string.");
    const path = resolve(base, key);
    const inside = relative(base, path);
    // "..foo" is a perfectly good key; only ".." itself and "../…" climb out.
    if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || inside.startsWith(sep)) {
      throw new TypeError(`Unsafe R2 key: ${key}`);
    }
    return path;
  }

  async #writeMetadata(key, metadata) {
    const path = this.#metadataPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeThenRename(path, JSON.stringify(metadata));
  }

  // Objects written before the sidecar existed, or restored from a backup of
  // data/ alone, still have to read back; their metadata is rebuilt from disk.
  // A sidecar that is missing, unreadable or corrupt is treated the same way:
  // an unparseable content type must not turn a published report into a 500.
  async #metadata(key, path) {
    const sidecar = Bun.file(this.#metadataPath(key));
    try {
      if (await sidecar.exists()) {
        const stored = await sidecar.json();
        return { ...stored, key, uploaded: new Date(stored.uploaded) };
      }
    } catch {
      // fall through and rebuild from the object itself
    }
    const file = Bun.file(path);
    const info = await stat(path);
    return {
      key,
      size: info.size,
      etag: new Bun.CryptoHasher("md5").update(await file.bytes()).digest("hex"),
      uploaded: info.mtime,
      httpMetadata: {},
      customMetadata: {}
    };
  }

  async #walk(relativePath) {
    const absolute = relativePath ? join(this.root, relativePath) : this.root;
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      return [];
    }
    const keys = [];
    for (const entry of entries) {
      if (!relativePath && entry.name === META_DIR) continue;
      const key = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) keys.push(...(await this.#walk(key)));
      else if (entry.isFile() && !entry.name.endsWith(".tmp")) keys.push(key);
    }
    return keys;
  }
}

// The worker's ASSETS binding serves files Wrangler would have bundled. There
// are none here, so every asset request is a 404 instead of a crash.
export const noAssets = {
  async fetch() {
    return new Response(null, { status: 404 });
  }
};

function normalizeHttpMetadata(value) {
  if (!value) return {};
  if (value instanceof Headers) {
    return {
      contentType: value.get("content-type") ?? undefined,
      contentLanguage: value.get("content-language") ?? undefined,
      contentDisposition: value.get("content-disposition") ?? undefined,
      contentEncoding: value.get("content-encoding") ?? undefined,
      cacheControl: value.get("cache-control") ?? undefined
    };
  }
  return value;
}

async function toBytes(value) {
  if (value === null || value === undefined) return new Uint8Array();
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(await new Response(value).arrayBuffer());
}

// Writes to a uniquely named temp file and renames it into place, so a reader
// never sees a half-written file and two writers never share a temp name. If
// the write fails — a full disk is the realistic case — the temp file is
// removed rather than left behind for nobody to collect.
async function writeThenRename(path, contents) {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents);
    await rename(temporary, path);
  } catch (error) {
    await removeIfPresent(temporary).catch(() => {});
    throw error;
  }
}

function rejectUnsupported(options, method) {
  for (const option of ["range", "onlyIf"]) {
    if (options?.[option] !== undefined) {
      throw new Error(`R2 ${method}() option "${option}" is not implemented by the local bucket.`);
    }
  }
}

async function removeIfPresent(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
