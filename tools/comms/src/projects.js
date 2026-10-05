import { lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getConfig, requireBinding } from "./config.js";
import { getHomeUrl, getRequestBaseUrl } from "./public-url.js";
import { consumeRateLimit } from "./rate-limit.js";

// Uploads carry no project field: the stock postplan CLI cannot send one, and a
// recording keeps only its filename. So the project is read from the name.
// "Smart Reminder · launch video v13" names it before the separator, and
// "smart-reminder-launch-v13-wide.mp4" names it once the variant and
// version suffixes are gone. Both become the slug "smart-reminder".
const SEPARATOR = /\s+[·•|—–-]\s+|:\s+/;
const VARIANT = /^(?:v\d+|\d+s|\d+fps|\d+p|\d+k|wide|square|vertical|portrait|landscape|web|final|draft|hd)$/;
const GENERIC = new Set(["promo", "launch", "trailer", "teaser", "demo", "video", "videos", "recording", "clip"]);

export const PROJECT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function projectOf(name) {
  const text = String(name ?? "").replace(/\.(mp4|m4v|webm|mov|html?)$/i, "").trim();
  const separator = SEPARATOR.exec(text);
  const head = separator ? text.slice(0, separator.index).trim() : text;
  const tokens = slugify(head).split("-").filter(Boolean);
  const kept = tokens.length;
  while (tokens.length > 1 && (VARIANT.test(tokens.at(-1)) || GENERIC.has(tokens.at(-1)))) tokens.pop();
  if (!tokens.length) return null;
  // The label is the name as a person typed it, kept only when nothing had to
  // be stripped to find it.
  return { slug: tokens.join("-"), label: tokens.length === kept ? head : null };
}

// Groups uploads by project, newest activity first. An upload whose name gives
// no project stands alone under its own path. A group takes its name from its
// newest report title, which a person typed, and otherwise from the slug.
export function groupUploads(uploads) {
  const groups = new Map();
  for (const upload of uploads) {
    const project = projectOf(upload.title);
    const key = project?.slug ?? `upload:${upload.path}`;
    if (!groups.has(key)) groups.set(key, { slug: project?.slug ?? null, items: [] });
    groups.get(key).items.push({ ...upload, label: project?.label ?? null });
  }
  return [...groups.values()]
    .map(({ slug, items }) => {
      items.sort(newestFirst);
      const named = items.find((item) => item.kind === "report" && item.label);
      return {
        slug,
        name: named?.label ?? (slug ? titleCase(slug) : items[0].title),
        items: items.map(({ label, ...item }) => item),
        latest: items[0].date || ""
      };
    })
    .sort((a, b) => b.latest.localeCompare(a.latest) || a.name.localeCompare(b.name));
}

function newestFirst(a, b) {
  return (b.date || "").localeCompare(a.date || "") || a.path.localeCompare(b.path);
}

function titleCase(slug) {
  return slug.split("-").map((token) => token[0].toUpperCase() + token.slice(1)).join(" ");
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const MAX_LOGO_BYTES = 256 * 1024;
const LOGO_TYPES = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp"
};
const STORED_LOGO = /^([a-z0-9]+(?:-[a-z0-9]+)*)(\.(?:svg|png|jpg|webp))$/;

// One logo per project slug, stored as <slug>.<ext>. The type comes from the
// file's own bytes, not from the request, and a replacement removes any logo
// of another type.
export class ProjectLogos {
  constructor(root) {
    this.root = resolve(root);
  }

  async put(slug, bytes) {
    if (!PROJECT_SLUG.test(slug) || slug.length > 64) {
      throw problem(400, "Project must be a lowercase slug such as smart-reminder.");
    }
    if (!bytes.byteLength) throw problem(400, "Logo is empty.");
    if (bytes.byteLength > MAX_LOGO_BYTES) throw problem(413, `Logo exceeds ${MAX_LOGO_BYTES} bytes.`);
    const extension = logoExtension(bytes);
    if (!extension) throw problem(415, "Supported logo formats: SVG, PNG, JPEG, WebP.");

    await mkdir(this.root, { recursive: true });
    const path = join(this.root, `${slug}${extension}`);
    await writeFile(`${path}.tmp`, bytes, { mode: 0o600 });
    await rename(`${path}.tmp`, path);
    await Promise.all(
      Object.keys(LOGO_TYPES)
        .filter((other) => other !== extension)
        .map((other) => rm(join(this.root, `${slug}${other}`), { force: true }))
    );
    return { slug, contentType: LOGO_TYPES[extension], size: bytes.byteLength };
  }

  async get(slug) {
    if (!PROJECT_SLUG.test(slug)) return null;
    for (const [extension, contentType] of Object.entries(LOGO_TYPES)) {
      const path = join(this.root, `${slug}${extension}`);
      try {
        const info = await lstat(path);
        if (!info.isFile()) continue;
        return { slug, contentType, size: info.size, version: info.mtimeMs.toFixed(0), file: Bun.file(path) };
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return null;
  }

  // Slug to a version string that changes when the logo is replaced.
  async list() {
    let names;
    try {
      names = await readdir(this.root);
    } catch (error) {
      if (error.code === "ENOENT") return new Map();
      throw error;
    }
    const logos = new Map();
    for (const name of names) {
      const match = STORED_LOGO.exec(name);
      if (!match) continue;
      const logo = await this.get(match[1]);
      if (logo) logos.set(logo.slug, logo.version);
    }
    return logos;
  }

  async delete(slug) {
    if (!(await this.get(slug))) return false;
    await Promise.all(Object.keys(LOGO_TYPES).map((extension) => rm(join(this.root, `${slug}${extension}`), { force: true })));
    return true;
  }
}

function logoExtension(bytes) {
  const view = new Uint8Array(bytes);
  const starts = (...signature) => signature.every((byte, index) => view[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return ".png";
  if (starts(0xff, 0xd8, 0xff)) return ".jpg";
  if (starts(0x52, 0x49, 0x46, 0x46) && new TextDecoder().decode(view.subarray(8, 12)) === "WEBP") return ".webp";
  if (/<svg[\s>]/i.test(new TextDecoder().decode(view))) return ".svg";
  return null;
}

export function registerProjectRoutes(app, requireAuth) {
  app.put("/api/projects/:slug/logo", requireAuth, async (c) => {
    const config = getConfig(c.env);
    const limit = await consumeRateLimit(c.env.DB, {
      keyPrefix: "upload-logo",
      identity: c.get("auth").id,
      ...config.uploadKeyRateLimit
    });
    if (!limit.allowed) {
      c.header("Retry-After", String(limit.retryAfter));
      return c.json({ ok: false, error: "Upload rate limit exceeded." }, 429);
    }
    if (Number(c.req.header("content-length")) > MAX_LOGO_BYTES) {
      throw problem(413, `Logo exceeds ${MAX_LOGO_BYTES} bytes.`);
    }
    const logo = await requireBinding("LOGOS", c.env.LOGOS).put(c.req.param("slug"), await c.req.arrayBuffer());
    const base = getHomeUrl({ publicBaseUrl: config.publicBaseUrl, requestBaseUrl: getRequestBaseUrl(c.req.raw) });
    return c.json({ ok: true, project: logo.slug, contentType: logo.contentType, size: logo.size, logoUrl: `${base}/projects/${logo.slug}/logo` });
  });

  app.delete("/api/projects/:slug/logo", requireAuth, async (c) => {
    if (!(await requireBinding("LOGOS", c.env.LOGOS).delete(c.req.param("slug")))) {
      return c.json({ ok: false, error: "Logo not found." }, 404);
    }
    return c.json({ ok: true });
  });

  app.get("/projects/:slug/logo", async (c) => {
    const logo = await requireBinding("LOGOS", c.env.LOGOS).get(c.req.param("slug"));
    if (!logo) return c.notFound();
    // An SVG opened directly is a document that could run script; sandbox it.
    // Inside the dashboard's <img> it never could.
    return new Response(logo.file, {
      headers: {
        "Content-Type": logo.contentType,
        "Content-Length": String(logo.size),
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  });
}

function problem(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
