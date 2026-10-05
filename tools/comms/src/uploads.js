import { requireBinding } from "./config.js";

// This read-only index shares the deployment's network access boundary with
// published documents. Account management and write APIs keep their own auth.
export function registerUploadsPage(app) {
  app.get("/dashboard", async (c) => {
    const result = await c.env.DB.prepare(`
      SELECT d.id, d.title, d.updated_at, v.version_number, v.file_size
      FROM drafts d
      JOIN draft_versions v ON v.id = d.current_version_id
      WHERE d.deleted_at IS NULL AND d.disabled_at IS NULL
      ORDER BY d.updated_at DESC
    `).all();
    const media = await requireBinding("MEDIA", c.env.MEDIA).list();
    const uploads = [
      ...result.results.map((draft) => ({
        title: draft.title,
        path: `/d/${encodeURIComponent(draft.id)}`,
        kind: `HTML report · Version ${draft.version_number}`,
        date: draft.updated_at,
        size: draft.file_size
      })),
      ...media.map((item) => ({
        title: item.filename,
        path: `/m/${encodeURIComponent(item.name)}`,
        kind: "Video",
        date: item.createdAt,
        size: item.size
      }))
    ].sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.path.localeCompare(b.path));
    c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    return c.html(renderUploads(uploads));
  });
}

function renderUploads(uploads) {
  const rows = uploads.map((upload) => {
    const date = new Date(upload.date);
    const timestamp = Number.isNaN(date.getTime()) ? "" : date.toISOString();
    return `<li>
      <a href="${escapeHtml(upload.path)}">${escapeHtml(upload.title)}</a>
      <p>${escapeHtml(upload.kind)} · ${formatSize(upload.size)}${timestamp ? ` · <time datetime="${timestamp}">${timestamp.slice(0, 10)} ${timestamp.slice(11, 16)} UTC</time>` : ""}</p>
    </li>`;
  }).join("");
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Uploads · Comms</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; background: #f8fafc; color: #111827; }
    body { margin: 0; }
    main { max-width: 800px; margin: 48px auto; padding: 0 20px; }
    h1 { font-size: 36px; margin-bottom: 8px; }
    p { color: #475569; line-height: 1.5; }
    ul { list-style: none; padding: 0; margin-top: 32px; }
    li { border-top: 1px solid #cbd5e1; padding: 16px 0; }
    a { display: inline-block; padding: 8px 0; color: #1d4ed8; font-size: 19px; overflow-wrap: anywhere; }
    a:focus-visible { outline: 3px solid #2563eb; outline-offset: 4px; }
    li p { margin: 4px 0; font-size: 14px; }
    time { white-space: nowrap; }
    @media (prefers-color-scheme: dark) {
      :root { background: #0f172a; color: #f1f5f9; }
      p { color: #cbd5e1; } a { color: #93c5fd; } li { border-color: #334155; }
    }
  </style>
</head><body><main>
  <h1>Uploads</h1>
  <p>${uploads.length} ${uploads.length === 1 ? "upload" : "uploads"} · Reports and videos, newest first.</p>
  ${uploads.length ? `<ul>${rows}</ul>` : "<p>No uploads yet.</p>"}
</main></body></html>`;
}

function formatSize(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
