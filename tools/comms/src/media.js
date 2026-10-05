import { lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { getConfig, requireBinding } from "./config.js";
import { getHomeUrl, getRequestBaseUrl } from "./public-url.js";
import { renderMediaPage } from "./render.js";
import { consumeRateLimit } from "./rate-limit.js";
import { randomToken } from "./crypto.js";
import { findGroup } from "./uploads.js";

const MEDIA_TYPES = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime"
};
const STORED_NAME = /^[a-f0-9]{32}\.(mp4|m4v|webm|mov)$/;
// A recording's bytes never change under its generated name, so a browser may
// keep what it has buffered for an hour and replay it without the network.
// A deleted recording can therefore still play for up to an hour on a device
// that had it.
const MEDIA_CACHE_CONTROL = "private, max-age=3600";

// Media has its own directory. Requests can only address generated filenames,
// never arbitrary paths on the host. Uploads stream into a temporary file and
// become visible only when both the bytes and metadata have been written.
export class MediaFiles {
  constructor(root) {
    this.root = resolve(root);
  }

  async put(filename, body, { maxBytes, accountId }) {
    if (!filename || filename.length > 200 || /[\x00-\x1f\x7f/\\]/.test(filename)) {
      throw problem(400, "Provide a filename without a directory or control characters.");
    }
    const extension = extname(filename).toLowerCase();
    const contentType = MEDIA_TYPES[extension];
    if (!contentType) throw problem(415, "Supported recording formats: MP4, M4V, WebM, MOV.");
    if (!body) throw problem(400, "Recording is empty.");

    await mkdir(this.root, { recursive: true });
    const name = `${crypto.randomUUID().replaceAll("-", "")}${extension}`;
    const path = join(this.root, name);
    const temporary = `${path}.tmp`;
    const metadataPath = `${path}.json`;
    const handle = await open(temporary, "wx", 0o600);
    let size = 0;
    try {
      try {
        for await (const chunk of body) {
          size += chunk.byteLength;
          if (size > maxBytes) throw problem(413, `Recording exceeds ${maxBytes} bytes.`);
          await handle.writeFile(chunk);
        }
      } finally {
        await handle.close();
      }
      if (!size) throw problem(400, "Recording is empty.");
      const metadata = { filename, contentType, size, accountId, createdAt: new Date().toISOString() };
      await writeFile(`${metadataPath}.tmp`, JSON.stringify(metadata), { flag: "wx", mode: 0o600 });
      await rename(temporary, path);
      await rename(`${metadataPath}.tmp`, metadataPath);
      return { name, ...metadata };
    } catch (error) {
      await Promise.all([temporary, path, `${metadataPath}.tmp`, metadataPath].map((p) => rm(p, { force: true })));
      throw error;
    }
  }

  async get(name) {
    if (!STORED_NAME.test(name)) return null;
    const path = join(this.root, name);
    try {
      const [info, metadataInfo] = await Promise.all([lstat(path), lstat(`${path}.json`)]);
      if (!info.isFile() || !metadataInfo.isFile()) return null;
      const metadata = JSON.parse(await readFile(`${path}.json`, "utf8"));
      if (typeof metadata.filename !== "string" || typeof metadata.accountId !== "string") return null;
      return {
        ...metadata,
        name,
        size: info.size,
        contentType: MEDIA_TYPES[extname(name)],
        file: Bun.file(path)
      };
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async list() {
    let names;
    try {
      names = await readdir(this.root);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const media = [];
    for (const name of names) {
      if (!STORED_NAME.test(name)) continue;
      const item = await this.get(name);
      if (item) media.push(item);
    }
    return media;
  }

  async delete(name) {
    if (!STORED_NAME.test(name)) return;
    await rm(join(this.root, `${name}.json`), { force: true });
    await rm(join(this.root, name), { force: true });
  }
}

export function registerMediaRoutes(app, requireAuth) {
  app.post("/api/media", requireAuth, async (c) => {
    const config = getConfig(c.env);
    const auth = c.get("auth");
    const limit = await consumeRateLimit(c.env.DB, {
      keyPrefix: "upload-media",
      identity: auth.id,
      ...config.uploadKeyRateLimit
    });
    if (!limit.allowed) {
      c.header("Retry-After", String(limit.retryAfter));
      return c.json({ ok: false, error: "Upload rate limit exceeded." }, 429);
    }
    const length = Number(c.req.header("content-length"));
    if (length > config.maxMediaBytes) throw problem(413, `Recording exceeds ${config.maxMediaBytes} bytes.`);
    const media = await requireBinding("MEDIA", c.env.MEDIA).put(c.req.query("filename"), c.req.raw.body, {
      maxBytes: config.maxMediaBytes,
      accountId: auth.account_id
    });
    const base = getHomeUrl({ publicBaseUrl: config.publicBaseUrl, requestBaseUrl: getRequestBaseUrl(c.req.raw) });
    return c.json({
      ok: true,
      filename: media.filename,
      size: media.size,
      mediaId: media.name,
      publicUrl: `${base}/m/${media.name}`,
      mediaUrl: `${base}/media/${media.name}`,
      downloadUrl: `${base}/media/${media.name}?download=1`
    }, 201);
  });

  app.delete("/api/media/:name", requireAuth, async (c) => {
    const store = requireBinding("MEDIA", c.env.MEDIA);
    const media = await store.get(c.req.param("name"));
    if (!media || media.accountId !== c.get("auth").account_id) return c.notFound();
    await store.delete(media.name);
    return c.json({ ok: true });
  });

  app.get("/m/:name", async (c) => {
    const media = await requireBinding("MEDIA", c.env.MEDIA).get(c.req.param("name"));
    if (!media) return c.notFound();
    const nonce = randomToken();
    const group = await findGroup(c.env, `/m/${encodeURIComponent(media.name)}`);
    const logo = group && (await c.env.LOGOS?.get(group.slug));
    c.header("Cache-Control", "no-store");
    c.header("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; media-src 'self' blob:; base-uri 'none'; form-action 'none'`);
    return c.html(renderMediaPage({
      nonce,
      createdAt: media.createdAt,
      back: group
        ? {
            href: `/dashboard?open=${group.slug}#project-${group.slug}`,
            name: group.name,
            logo: logo ? `/projects/${group.slug}/logo?v=${encodeURIComponent(logo.version)}` : null
          }
        : { href: "/dashboard", name: "Uploads" },
      size: media.size,
      contentType: media.contentType,
      filename: media.filename,
      mediaPath: `/media/${media.name}`,
      downloadPath: `/media/${media.name}?download=1`
    }));
  });

  app.on(["GET", "HEAD"], "/media/:name", async (c) => {
    const media = await requireBinding("MEDIA", c.env.MEDIA).get(c.req.param("name"));
    if (!media) return c.notFound();
    const etag = `"${media.name}-${media.size}"`;
    const headers = new Headers({
      "Content-Type": media.contentType,
      "Content-Length": String(media.size),
      "Accept-Ranges": "bytes",
      "ETag": etag,
      "Cache-Control": MEDIA_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff"
    });
    if (c.req.query("download") === "1") {
      const fallback = media.filename.replace(/[^a-zA-Z0-9._ -]/g, "_");
      const encoded = encodeURIComponent(media.filename).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      headers.set("Content-Disposition", `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`);
    }
    if (c.req.method === "HEAD") return new Response(null, { headers });
    const ifNoneMatch = c.req.header("if-none-match");
    if (ifNoneMatch && ifNoneMatch.split(",").some((tag) => [etag, "*"].includes(tag.trim()))) {
      headers.delete("Content-Length");
      return new Response(null, { status: 304, headers });
    }

    const rangeHeader = c.req.header("range");
    const ifRange = c.req.header("if-range");
    if (rangeHeader && (!ifRange || ifRange === etag)) {
      const range = parseRange(rangeHeader, media.size);
      if (!range) {
        headers.set("Content-Range", `bytes */${media.size}`);
        headers.set("Content-Length", "0");
        return new Response(null, { status: 416, headers });
      }
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${media.size}`);
      headers.set("Content-Length", String(range.end - range.start + 1));
      return new Response(media.file.slice(range.start, range.end + 1), { status: 206, headers });
    }
    return new Response(media.file, { headers });
  });
}

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || !size) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

function problem(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
