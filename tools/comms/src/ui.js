// The look shared by the pages comms renders itself: the uploads dashboard, the
// recording player and the not-found page. Published reports keep their own.
// Everything is inline, because these pages allow no outside fonts or styles.

const svg = (paths, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${paths}</svg>`;

export const ICONS = {
  video: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9.5 4.5 2.5-4.5 2.5z"/>'),
  research: svg('<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>'),
  digest: svg('<path d="M5 4h11a2 2 0 0 1 2 2v13a1 1 0 0 0 2 0V9"/><path d="M5 4v14a2 2 0 0 0 2 2h13"/><path d="M8 8h6M8 12h6M8 16h4"/>'),
  report: svg('<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  project: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>', ' class="chevron"'),
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  retry: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>')
};

// The Comms mark: a speech bubble on a blue-violet tile. Also the favicon.
const MARK_PATHS = `<defs><linearGradient id="comms-mark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
  <rect width="32" height="32" rx="9" fill="url(#comms-mark)"/>
  <path d="M9 11.5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-4.5L12 22.5v-3a3 3 0 0 1-3-3z" fill="#fff"/>`;
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${MARK_PATHS}</svg>`;
const MARK = `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true">${MARK_PATHS}</svg>`;

export function page({ title, body, styles = "", nonce = null, script = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <title>${escapeHtml(title)}</title>
  <style>${STYLES}${styles}</style>
</head>
<body>
  <header class="bar"><div class="bar-inner">
    <a class="brand" href="/dashboard">${MARK}<span>Comms</span></a>
  </div></header>
  ${body}
  ${script && nonce ? `<script nonce="${escapeHtml(nonce)}">${script}</script>` : ""}
</body>
</html>`;
}

// A line of facts separated by dots. Each fact carries its own leading dot and
// the line is shifted left under a clip, so a wrapped line never starts with one.
export function meta(parts, className = "meta") {
  return `<span class="${className}"><span>${parts.filter(Boolean).map((part) => `<span>${part}</span>`).join("")}</span></span>`;
}

export function formatSize(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// "3 h ago" for the last week, then the date; the exact UTC time is the tooltip.
// The pages are never cached, so "now" is when the reader loaded them.
export function timeAgo(value, now = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const iso = date.toISOString();
  const seconds = Math.max(0, (now - date.getTime()) / 1000);
  const text =
    seconds < 60 ? "just now"
    : seconds < 3600 ? `${Math.floor(seconds / 60)} min ago`
    : seconds < 86400 ? `${Math.floor(seconds / 3600)} h ago`
    : seconds < 7 * 86400 ? `${Math.floor(seconds / 86400)} d ago`
    : iso.slice(0, 10);
  return `<time datetime="${iso}" title="${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC">${text}</time>`;
}

export function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

const STYLES = `
  :root {
    color-scheme: light dark;
    --bg: #f4f5f7; --surface: #ffffff; --hover: #f7f8fa; --sunken: #eef0f3;
    --border: rgba(15, 23, 42, .09); --border-strong: rgba(15, 23, 42, .16);
    --text: #0f172a; --muted: #5b6474; --subtle: #9aa3b2;
    --accent: #2563eb; --accent-text: #fff; --accent-soft: rgba(37, 99, 235, .1);
    --danger: #dc2626; --danger-soft: rgba(220, 38, 38, .09);
    --shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 2px 8px rgba(15, 23, 42, .04);
    --radius: 14px;
    --video: #7c3aed; --video-bg: #f1ebff; --research: #b45309; --research-bg: #fff3dc;
    --digest: #0f766e; --digest-bg: #dcf7f2; --report: #2563eb; --report-bg: #e6efff;
    --project: #475569; --project-bg: #eceff3;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b0d12; --surface: #14171e; --hover: #1a1e27; --sunken: #0f1218;
      --border: rgba(255, 255, 255, .08); --border-strong: rgba(255, 255, 255, .16);
      --text: #e8eaf0; --muted: #a0a8b6; --subtle: #6b7383;
      --accent: #6e9bff; --accent-text: #0b0d12; --accent-soft: rgba(110, 155, 255, .14);
      --danger: #f87171; --danger-soft: rgba(248, 113, 113, .12);
      --shadow: 0 1px 2px rgba(0, 0, 0, .3);
      --video: #b9a2ff; --video-bg: #261c44; --research: #f5c26b; --research-bg: #3a2a10;
      --digest: #5eead4; --digest-bg: #0f302c; --report: #93b4ff; --report-bg: #182444;
      --project: #b4bcc8; --project-bg: #232833;
    }
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums;
  }
  [hidden] { display: none !important; }
  a { color: inherit; text-decoration: none; }
  button, input { font: inherit; color: inherit; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .bar {
    position: sticky; top: 0; z-index: 10; padding-top: env(safe-area-inset-top);
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    -webkit-backdrop-filter: saturate(180%) blur(14px); backdrop-filter: saturate(180%) blur(14px);
    border-bottom: 1px solid var(--border);
  }
  .bar-inner { max-width: 880px; margin: 0 auto; padding: 0 20px; height: 54px; display: flex; align-items: center; }
  .brand { display: inline-flex; align-items: center; gap: 9px; font-weight: 650; font-size: 16px; letter-spacing: -.01em; }
  .mark { width: 26px; height: 26px; display: block; }

  .wrap { max-width: 880px; margin: 0 auto; padding: 28px 20px 64px; padding-left: max(20px, env(safe-area-inset-left)); padding-right: max(20px, env(safe-area-inset-right)); }
  h1 { font-size: 30px; line-height: 1.15; letter-spacing: -.025em; font-weight: 700; margin: 0; overflow-wrap: anywhere; }
  .sub { margin: 6px 0 0; color: var(--muted); }
  .meta { display: block; overflow: hidden; color: var(--muted); font-size: 13px; line-height: 1.5; }
  .meta > span { display: flex; flex-wrap: wrap; margin-left: -14px; }
  .meta > span > span { white-space: nowrap; }
  .meta > span > span::before { content: "·"; display: inline-block; width: 14px; text-align: center; color: var(--subtle); }

  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 18px;
    border: 1px solid var(--border-strong); border-radius: 11px; background: var(--surface); color: var(--text);
    font-weight: 560; cursor: pointer; transition: background .15s, border-color .15s, opacity .15s;
  }
  .btn svg { width: 18px; height: 18px; flex: none; }
  .btn:hover { background: var(--hover); }
  .btn.primary { background: var(--accent); border-color: transparent; color: var(--accent-text); }
  .btn.primary:hover { background: color-mix(in srgb, var(--accent) 88%, #000); }
  .btn.quiet { border-color: transparent; background: transparent; color: var(--accent); padding: 0 10px; }
  .btn.quiet:hover { background: var(--accent-soft); }
  .btn:disabled { opacity: .45; cursor: default; }
  .btn:disabled:hover { background: var(--surface); }
  .btn.primary:disabled:hover { background: var(--accent); }

  .tile { flex: none; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; overflow: hidden; }
  .tile svg { width: 22px; height: 22px; }
  .tile img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .tile.logo { background: #fff; box-shadow: inset 0 0 0 1px var(--border); }
  .tile.video { background: var(--video-bg); color: var(--video); }
  .tile.research { background: var(--research-bg); color: var(--research); }
  .tile.digest { background: var(--digest-bg); color: var(--digest); }
  .tile.report { background: var(--report-bg); color: var(--report); }
  .tile.project { background: var(--project-bg); color: var(--project); }
`;
