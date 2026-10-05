import { getConfig, requireBinding } from "./config.js";
import { clientIp } from "./client-ip.js";
import { randomToken } from "./crypto.js";
import { isoNow } from "./db.js";
import { groupUploads, PROJECT_SLUG } from "./projects.js";

// This index shares the deployment's network access boundary with published
// documents: whoever can open it can also delete from it. Uploads, logos and
// API keys keep their own auth.
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
        kind: "report",
        id: draft.id,
        title: draft.title,
        path: `/d/${encodeURIComponent(draft.id)}`,
        detail: `HTML report · Version ${draft.version_number}`,
        versions: Number(draft.version_number),
        date: draft.updated_at,
        size: draft.file_size
      })),
      ...media.map((item) => ({
        kind: "video",
        id: item.name,
        title: item.filename,
        path: `/m/${encodeURIComponent(item.name)}`,
        detail: "Video",
        date: item.createdAt,
        size: item.size
      }))
    ];
    const logos = await requireBinding("LOGOS", c.env.LOGOS).list();
    const open = c.req.query("open");
    const nonce = randomToken();
    c.header(
      "Content-Security-Policy",
      `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`
    );
    // A published document runs its own script on this origin. Without this,
    // one could open the dashboard in a window and press its delete buttons.
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    return c.html(
      renderUploads({
        uploads,
        groups: groupUploads(uploads),
        logos,
        open: PROJECT_SLUG.test(open ?? "") ? open : null,
        nonce
      })
    );
  });

  app.post("/dashboard/reports/:id/delete", async (c) => {
    if (!sameOrigin(c)) return c.text("Delete from the dashboard itself.", 403);
    const now = isoNow();
    const result = await c.env.DB.prepare(
      "UPDATE drafts SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL"
    )
      .bind(now, now, c.req.param("id"))
      .run();
    if (!result.meta.changes) return c.notFound();
    logDeletion(c, `report ${c.req.param("id")}`);
    return backToDashboard(c);
  });

  app.post("/dashboard/videos/:name/delete", async (c) => {
    if (!sameOrigin(c)) return c.text("Delete from the dashboard itself.", 403);
    const store = requireBinding("MEDIA", c.env.MEDIA);
    const media = await store.get(c.req.param("name"));
    if (!media) return c.notFound();
    await store.delete(media.name);
    logDeletion(c, `video ${media.name} (${JSON.stringify(media.filename)})`);
    return backToDashboard(c);
  });
}

// Other ports on the same tailnet hostname (dev servers, for one) are other
// origins that a browser would still let post a form here. Only this page may.
function sameOrigin(c) {
  const origin = c.req.header("origin");
  if (!origin) return c.req.header("sec-fetch-site") === "same-origin";
  return origin === getConfig(c.env).publicBaseUrl || origin === new URL(c.req.url).origin;
}

function backToDashboard(c) {
  const open = c.req.query("open");
  return c.redirect(PROJECT_SLUG.test(open ?? "") ? `/dashboard?open=${open}#project-${open}` : "/dashboard", 303);
}

// Dashboard deletes carry no API key, so this line is the only record of them.
function logDeletion(c, what) {
  console.log(`${new Date().toISOString()} dashboard deleted ${what} for ${clientIp(c.req.raw) || "unknown client"}`);
}

function renderUploads({ uploads, groups, logos, open, nonce }) {
  const projects = groups.filter((group) => group.items.length > 1).length;
  const list = groups
    .map((group) => (group.items.length > 1 ? renderGroup(group, logos, open) : renderSingle(group, logos)))
    .join("");
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Uploads · Comms</title>
  <style>
    :root {
      color-scheme: light dark; font-family: system-ui, sans-serif; background: #f8fafc; color: #111827;
      --muted: #475569; --line: #e2e8f0; --surface: #ffffff; --hover: #f1f5f9; --link: #1d4ed8;
      --danger: #b91c1c; --danger-bg: #fee2e2;
    }
    body { margin: 0; }
    main { max-width: 800px; margin: 48px auto; padding: 0 20px; }
    h1 { font-size: 36px; margin: 0 0 8px; }
    .lede { color: var(--muted); line-height: 1.5; margin: 0 0 28px; }
    ul { list-style: none; margin: 0; padding: 0; }
    .groups > li { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; margin-bottom: 10px; overflow: hidden; }
    summary, .row { display: flex; align-items: center; gap: 14px; padding: 10px 8px 10px 14px; }
    summary { cursor: pointer; list-style: none; min-height: 48px; }
    summary::-webkit-details-marker { display: none; }
    summary:hover { background: var(--hover); }
    summary:focus-visible, a:focus-visible, button:focus-visible { outline: 3px solid #2563eb; outline-offset: -3px; }
    .items li { display: flex; align-items: center; gap: 12px; padding: 6px 8px 6px 14px; border-top: 1px solid var(--line); }
    .tile { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; overflow: hidden; }
    .tile img { width: 100%; height: 100%; object-fit: contain; }
    .tile svg { width: 22px; height: 22px; }
    .items .tile { width: 30px; height: 30px; border-radius: 8px; }
    .items .tile svg { width: 17px; height: 17px; }
    .tile.logo { background: #fff; box-shadow: inset 0 0 0 1px var(--line); }
    .tile.video { background: #ede9fe; color: #6d28d9; }
    .tile.research { background: #fef3c7; color: #b45309; }
    .tile.digest { background: #ccfbf1; color: #0f766e; }
    .tile.report { background: #dbeafe; color: #1d4ed8; }
    .tile.project { background: #e2e8f0; color: #334155; }
    .text { flex: 1; min-width: 0; }
    .name { display: block; font-size: 17px; font-weight: 600; overflow-wrap: anywhere; }
    a { color: var(--link); font-size: 16px; overflow-wrap: anywhere; text-underline-offset: 2px; }
    .row a { font-size: 17px; }
    .meta { display: block; margin: 2px 0 0; color: var(--muted); font-size: 14px; line-height: 1.4; }
    time { white-space: nowrap; }
    .chevron { flex: none; width: 20px; height: 20px; margin: 0 8px; color: var(--muted); transition: transform .15s ease; }
    details[open] .chevron { transform: rotate(90deg); }
    form { flex: none; margin: 0; }
    .delete { display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: 8px; background: none; color: var(--muted); cursor: pointer; }
    .delete svg { width: 18px; height: 18px; }
    .delete:hover { color: var(--danger); background: var(--danger-bg); }
    @media (prefers-color-scheme: dark) {
      :root {
        background: #0f172a; color: #f1f5f9;
        --muted: #cbd5e1; --line: #334155; --surface: #111c33; --hover: #1e293b; --link: #93c5fd;
        --danger: #fca5a5; --danger-bg: #450a0a;
      }
      .tile.video { background: #2e1065; color: #c4b5fd; }
      .tile.research { background: #451a03; color: #fcd34d; }
      .tile.digest { background: #042f2e; color: #5eead4; }
      .tile.report { background: #172554; color: #93c5fd; }
      .tile.project { background: #1e293b; color: #cbd5e1; }
    }
  </style>
</head><body><main>
  <h1>Uploads</h1>
  <p class="lede">${count(uploads.length, "upload")}${projects ? ` in ${count(projects, "project")}` : ""} · Newest first.</p>
  ${uploads.length ? `<ul class="groups">${list}</ul>` : "<p>No uploads yet.</p>"}
</main>
<script nonce="${nonce}">
  document.addEventListener("submit", (event) => {
    if (!confirm(event.target.dataset.confirm)) event.preventDefault();
  });
</script>
</body></html>`;
}

function renderGroup(group, logos, open) {
  const reports = group.items.filter((item) => item.kind === "report").length;
  const videos = group.items.length - reports;
  const counts = [reports && count(reports, "report"), videos && count(videos, "video")].filter(Boolean).join(" · ");
  const id = group.slug ? ` id="project-${group.slug}"` : "";
  return `<li><details${id}${group.slug && group.slug === open ? " open" : ""}>
    <summary>
      ${groupTile(group, logos)}
      <span class="text"><span class="name">${escapeHtml(group.name)}</span>
      <span class="meta">${counts} · Updated ${timestamp(group.latest)}</span></span>
      <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
    </summary>
    <ul class="items">${group.items.map((item) => `<li>
      <span class="tile ${itemIcon(item)}">${ICONS[itemIcon(item)]}</span>
      ${itemText(item)}
      ${deleteForm(item, group.slug)}
    </li>`).join("")}</ul>
  </details></li>`;
}

function renderSingle(group, logos) {
  const [item] = group.items;
  return `<li><div class="row">
    ${groupTile(group, logos)}
    ${itemText(item)}
    ${deleteForm(item, null)}
  </div></li>`;
}

function groupTile(group, logos) {
  if (group.slug && logos.has(group.slug)) {
    const src = `/projects/${group.slug}/logo?v=${encodeURIComponent(logos.get(group.slug))}`;
    return `<span class="tile logo"><img src="${src}" alt=""></span>`;
  }
  const icons = new Set(group.items.map(itemIcon));
  const icon = icons.size === 1 ? [...icons][0] : "project";
  return `<span class="tile ${icon}">${ICONS[icon]}</span>`;
}

function itemText(item) {
  return `<span class="text">
    <a href="${escapeHtml(item.path)}">${escapeHtml(item.title)}</a>
    <span class="meta">${escapeHtml(item.detail)} · ${formatSize(item.size)}${item.date ? ` · ${timestamp(item.date)}` : ""}</span>
  </span>`;
}

function deleteForm(item, slug) {
  const action = `/dashboard/${item.kind === "report" ? "reports" : "videos"}/${encodeURIComponent(item.id)}/delete${slug ? `?open=${slug}` : ""}`;
  const message =
    item.kind === "report"
      ? `Delete “${item.title}”${item.versions > 1 ? ` and all ${item.versions} versions` : ""}? Its link will stop working.`
      : `Delete “${item.title}”? The video file is removed and cannot be restored.`;
  return `<form method="post" action="${escapeHtml(action)}" data-confirm="${escapeHtml(message)}">
    <button class="delete" type="submit" title="Delete" aria-label="Delete ${escapeHtml(item.title)}">${ICONS.trash}</button>
  </form>`;
}

function itemIcon(item) {
  if (item.kind === "video") return "video";
  if (/\b(research|findings|investigation|analysis|study|survey)\b/i.test(item.title)) return "research";
  if (/\b(digest|newsletter|changelog|weekly|daily)\b/i.test(item.title)) return "digest";
  return "report";
}

const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICONS = {
  video: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>'),
  research: svg('<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>'),
  digest: svg('<path d="M5 4h11a2 2 0 0 1 2 2v13a1 1 0 0 0 2 0V9"/><path d="M5 4v14a2 2 0 0 0 2 2h13"/><path d="M8 8h6M8 12h6M8 16h4"/>'),
  report: svg('<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  project: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>')
};

function count(value, noun) {
  return `${value} ${value === 1 ? noun : `${noun}s`}`;
}

function timestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const iso = date.toISOString();
  return `<time datetime="${iso}">${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC</time>`;
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
