import { getConfig, requireBinding } from "./config.js";
import { clientIp } from "./client-ip.js";
import { randomToken } from "./crypto.js";
import { isoNow } from "./db.js";
import { groupUploads, PROJECT_SLUG } from "./projects.js";
import { escapeHtml, formatSize, ICONS, meta, page, timeAgo } from "./ui.js";

// This index shares the deployment's network access boundary with published
// documents: whoever can open it can also delete from it. Uploads, logos and
// API keys keep their own auth.
export function registerUploadsPage(app) {
  app.get("/dashboard", async (c) => {
    const uploads = await listUploads(c.env);
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

// Every live report and recording, across accounts, unordered.
export async function listUploads(env) {
  const result = await env.DB.prepare(`
    SELECT d.id, d.title, d.updated_at, v.version_number, v.file_size
    FROM drafts d
    JOIN draft_versions v ON v.id = d.current_version_id
    WHERE d.deleted_at IS NULL AND d.disabled_at IS NULL
  `).all();
  const media = await requireBinding("MEDIA", env.MEDIA).list();
  return [
    ...result.results.map((draft) => ({
      kind: "report",
      id: draft.id,
      title: draft.title,
      path: `/d/${encodeURIComponent(draft.id)}`,
      versions: Number(draft.version_number),
      date: draft.updated_at,
      size: draft.file_size
    })),
    ...media.map((item) => ({
      kind: "video",
      id: item.name,
      title: item.filename,
      path: `/m/${encodeURIComponent(item.name)}`,
      date: item.createdAt,
      size: item.size
    }))
  ];
}

// The dashboard group an upload belongs to, if it shares one with others.
export async function findGroup(env, path) {
  return groupUploads(await listUploads(env)).find(
    (group) => group.items.length > 1 && group.items.some((item) => item.path === path)
  ) ?? null;
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
  const now = Date.now();
  const projects = groups.filter((group) => group.items.length > 1).length;
  const reports = uploads.filter((upload) => upload.kind === "report").length;
  const cards = groups
    .map((group) => (group.items.length > 1 ? renderGroup(group, logos, open, now) : renderSingle(group, logos, now)))
    .join("");
  const body = `<main class="wrap">
    <div class="head">
      <h1>Uploads</h1>
      <p class="sub">${count(uploads.length, "upload")}${projects ? ` in ${count(projects, "project")}` : ""}</p>
    </div>
    ${uploads.length ? `
    <div class="toolbar" id="toolbar" hidden>
      <label class="search">${ICONS.search}<input id="filter" type="search" placeholder="Search uploads" autocomplete="off" aria-label="Search uploads"></label>
      <div class="segmented" role="group" aria-label="Show">
        <button type="button" data-show="all" aria-pressed="true">All</button>
        <button type="button" data-show="report" aria-pressed="false">Reports <span>${reports}</span></button>
        <button type="button" data-show="video" aria-pressed="false">Videos <span>${uploads.length - reports}</span></button>
      </div>
    </div>
    <ul class="cards">${cards}</ul>
    <p class="empty" id="no-match" hidden>No uploads match.</p>` : `
    <div class="empty-state">${ICONS.project}<p>No uploads yet.</p><p class="sub">Publish a report or video and it appears here.</p></div>`}
  </main>`;
  return page({ title: "Uploads · Comms", body, styles: DASHBOARD_STYLES, nonce, script: DASHBOARD_SCRIPT });
}

function renderGroup(group, logos, open, now) {
  const reports = group.items.filter((item) => item.kind === "report").length;
  const videos = group.items.length - reports;
  const counts = [reports && count(reports, "report"), videos && count(videos, "video")].filter(Boolean);
  const id = group.slug ? ` id="project-${group.slug}"` : "";
  return `<li class="card" data-name="${escapeHtml(group.name.toLowerCase())}"><details${id}${group.slug && group.slug === open ? " open" : ""}>
    <summary class="row">
      ${groupTile(group, logos)}
      <span class="text"><span class="title">${escapeHtml(group.name)}</span>
      ${meta([...counts, `Updated ${timeAgo(group.latest, now)}`])}</span>
      ${ICONS.chevron}
    </summary>
    <ul class="items">${group.items.map((item) => `<li class="row item" ${itemData(item)}>
      <span class="tile ${itemIcon(item)}" role="img" aria-label="${KIND_NAMES[itemIcon(item)]}">${ICONS[itemIcon(item)]}</span>
      ${itemText(item, now)}
      ${deleteForm(item, group.slug)}
    </li>`).join("")}</ul>
  </details></li>`;
}

function renderSingle(group, logos, now) {
  const [item] = group.items;
  return `<li class="card row single" data-name="" ${itemData(item)}>
    ${groupTile(group, logos)}
    ${itemText(item, now)}
    ${deleteForm(item, null)}
  </li>`;
}

function itemData(item) {
  return `data-kind="${item.kind}" data-title="${escapeHtml(item.title.toLowerCase())}"`;
}

function groupTile(group, logos) {
  if (group.slug && logos.has(group.slug)) {
    const src = `/projects/${group.slug}/logo?v=${encodeURIComponent(logos.get(group.slug))}`;
    return `<span class="tile logo"><img src="${src}" alt=""></span>`;
  }
  const icons = new Set(group.items.map(itemIcon));
  const icon = icons.size === 1 ? [...icons][0] : "project";
  return `<span class="tile ${icon}" role="img" aria-label="${KIND_NAMES[icon]}">${ICONS[icon]}</span>`;
}

function itemText(item, now) {
  return `<span class="text">
    <a class="title cover" href="${escapeHtml(item.path)}">${escapeHtml(item.title)}</a>
    ${meta([item.kind === "report" && `Version ${item.versions}`, formatSize(item.size), item.date && timeAgo(item.date, now)])}
  </span>`;
}

function deleteForm(item, slug) {
  const action = `/dashboard/${item.kind === "report" ? "reports" : "videos"}/${encodeURIComponent(item.id)}/delete${slug ? `?open=${slug}` : ""}`;
  const message =
    item.kind === "report"
      ? `Delete “${item.title}”${item.versions > 1 ? ` and all ${item.versions} versions` : ""}? Its link will stop working.`
      : `Delete “${item.title}”? The video file is removed and cannot be restored.`;
  return `<form class="delete" method="post" action="${escapeHtml(action)}" data-confirm="${escapeHtml(message)}">
    <button type="submit" title="Delete" aria-label="Delete ${escapeHtml(item.title)}">${ICONS.trash}</button>
  </form>`;
}

function itemIcon(item) {
  if (item.kind === "video") return "video";
  if (/\b(research|findings|investigation|analysis|study|survey)\b/i.test(item.title)) return "research";
  if (/\b(digest|newsletter|changelog|weekly|daily)\b/i.test(item.title)) return "digest";
  return "report";
}

const KIND_NAMES = { video: "Video", research: "Research report", digest: "Digest", report: "Report", project: "Project" };

function count(value, noun) {
  return `${value} ${value === 1 ? noun : `${noun}s`}`;
}

const DASHBOARD_STYLES = `
  .head { margin-bottom: 20px; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
  .search { flex: 1 1 240px; display: flex; align-items: center; gap: 8px; height: 42px; padding: 0 12px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 11px; color: var(--subtle); }
  .search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .search svg { width: 18px; height: 18px; flex: none; }
  .search input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; color: var(--text); font-size: 16px; }
  .search input::placeholder { color: var(--subtle); }
  .segmented { display: inline-flex; padding: 3px; gap: 2px; background: var(--sunken); border: 1px solid var(--border); border-radius: 11px; }
  .segmented button { height: 34px; padding: 0 12px; border: 0; border-radius: 8px; background: none; color: var(--muted); font-size: 14px; font-weight: 550; cursor: pointer; }
  .segmented button span { color: var(--subtle); font-weight: 500; margin-left: 2px; }
  .segmented button[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: var(--shadow), 0 0 0 1px var(--border); }

  .cards { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  .row { position: relative; display: flex; align-items: center; gap: 14px; padding: 12px 10px 12px 14px; min-height: 68px; }
  .row:hover { background: var(--hover); }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .title { font-weight: 600; font-size: 15.5px; letter-spacing: -.01em; overflow-wrap: anywhere; }
  .cover::after { content: ""; position: absolute; inset: 0; }
  .cover:focus-visible { outline: none; }
  .cover:focus-visible::after { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: inherit; }
  summary { list-style: none; cursor: pointer; }
  summary::-webkit-details-marker { display: none; }
  summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: var(--radius); }
  .chevron { flex: none; width: 18px; height: 18px; margin: 0 8px; color: var(--subtle); transition: transform .2s ease; }
  details[open] .chevron { transform: rotate(90deg); }
  details[open] > summary { border-bottom: 1px solid var(--border); }

  .items { list-style: none; margin: 0; padding: 4px 0; background: color-mix(in srgb, var(--surface) 60%, var(--bg)); }
  .item { min-height: 58px; padding: 8px 10px 8px 22px; }
  .item + .item::before { content: ""; position: absolute; top: 0; left: 66px; right: 12px; border-top: 1px solid var(--border); }
  .item .tile { width: 32px; height: 32px; border-radius: 9px; }
  .item .tile svg { width: 17px; height: 17px; }
  .item .title { font-weight: 520; font-size: 14.5px; }

  .delete { flex: none; position: relative; z-index: 1; margin: 0; }
  .delete button { display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 10px;
    background: none; color: var(--subtle); cursor: pointer; transition: opacity .15s, background .15s, color .15s; }
  .delete svg { width: 18px; height: 18px; }
  .delete button:hover { color: var(--danger); background: var(--danger-soft); }
  @media (hover: hover) {
    .row .delete button { opacity: 0; }
    .row:hover .delete button, .delete button:focus-visible { opacity: 1; }
  }
  .empty { color: var(--muted); text-align: center; padding: 32px 0; }
  .empty-state { text-align: center; padding: 72px 20px; color: var(--muted); }
  .empty-state svg { width: 40px; height: 40px; color: var(--subtle); }
  .empty-state p { margin: 10px 0 0; color: var(--text); font-weight: 600; }
  .empty-state .sub { font-weight: 400; color: var(--muted); }
  @media (max-width: 520px) {
    h1 { font-size: 26px; }
    .wrap { padding-top: 20px; }
    .segmented { width: 100%; }
    .segmented button { flex: 1; }
  }
`;

// Confirms deletes, and filters by text and kind. Without script the list is
// complete and deletes go through unconfirmed, so the toolbar starts hidden.
const DASHBOARD_SCRIPT = `
  document.addEventListener("submit", (event) => {
    if (!confirm(event.target.dataset.confirm)) event.preventDefault();
  });
  const toolbar = document.getElementById("toolbar");
  if (toolbar) {
    toolbar.hidden = false;
    const input = document.getElementById("filter");
    const buttons = [...toolbar.querySelectorAll("[data-show]")];
    let show = "all";
    const apply = () => {
      const query = input.value.trim().toLowerCase();
      let total = 0;
      for (const card of document.querySelectorAll(".cards > .card")) {
        const named = query && card.dataset.name.includes(query);
        const rows = card.matches("[data-title]") ? [card] : [...card.querySelectorAll("[data-title]")];
        let shown = 0;
        for (const row of rows) {
          const match = (show === "all" || row.dataset.kind === show) && (!query || named || row.dataset.title.includes(query));
          if (row !== card) row.hidden = !match;
          if (match) shown++;
        }
        card.hidden = !shown;
        total += shown;
        const details = card.querySelector("details");
        if (details && query && shown) details.open = true;
      }
      document.getElementById("no-match").hidden = total > 0;
    };
    input.addEventListener("input", apply);
    for (const button of buttons) {
      button.addEventListener("click", () => {
        show = button.dataset.show;
        for (const other of buttons) other.setAttribute("aria-pressed", String(other === button));
        apply();
      });
    }
  }
`;
