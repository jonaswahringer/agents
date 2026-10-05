import { initializePlayer } from "./player.js";

export function renderHome({ publicBaseUrl }) {
  return htmlPage({
    title: "Postplan",
    body: `
      <main class="home">
        <h1>Postplan</h1>
        <p>A Cloudflare Worker for publishing static HTML drafts.</p>
        <pre>POST /api/uploads</pre>
        <p><a href="/dashboard">My drafts</a> · <a href="/settings/api-keys">API keys</a></p>
        <p>Health: <a href="/healthz">/healthz</a></p>
        <p>Public base URL: ${escapeHtml(publicBaseUrl || "not configured")}</p>
      </main>
    `
  });
}

export function renderNotFound() {
  return htmlPage({
    title: "Draft not found",
    body: `
      <main class="home">
        <h1>Draft not found</h1>
        <p>The requested draft is unavailable.</p>
      </main>
    `
  });
}

export function renderMediaPage({ filename, mediaPath, downloadPath, nonce, size, contentType }) {
  return htmlPage({
    title: filename,
    body: `<main class="home player">
      <h1>${escapeHtml(filename)}</h1>
      <video playsinline preload="auto" id="recording" aria-label="${escapeHtml(filename)}" data-src="${escapeHtml(mediaPath)}" data-size="${size}" data-type="${escapeHtml(contentType)}"></video>
      <div id="player-status" class="player-status">
        <p id="player-message" role="status" aria-live="polite" aria-atomic="true"></p>
        <progress id="player-progress" aria-label="Video buffering progress" max="100" value="0"></progress>
        <button id="player-play" type="button" disabled>Play</button>
        <button id="player-full" type="button">Download fully before playing</button>
        <button id="player-retry" type="button" hidden>Retry playback</button>
      </div>
      <p><a class="download" href="${escapeHtml(downloadPath)}" download>Download recording</a></p>
      <noscript><p>JavaScript is required for buffering. Use the download link to watch the recording.</p></noscript>
    </main>
    <script nonce="${escapeHtml(nonce)}">(${initializePlayer.toString()})();</script>`
  });
}

function htmlPage({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.ico">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      margin: 0;
      background: #f8fafc;
      color: #111827;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .home {
      max-width: 760px;
      margin: 64px auto;
      padding: 0 20px;
    }

    h1 {
      margin: 0 0 12px;
      font-size: 40px;
      line-height: 1.1;
    }

    p {
      color: #374151;
      font-size: 17px;
      line-height: 1.6;
    }

    pre {
      overflow-x: auto;
      padding: 14px;
      border: 1px solid #d1d5db;
      background: #ffffff;
      border-radius: 6px;
    }

    .player { margin: 24px auto; padding: 0 max(16px, env(safe-area-inset-left)) 24px max(16px, env(safe-area-inset-right)); }
    .player h1 { font-size: clamp(20px, 4vw, 30px); overflow-wrap: anywhere; }
    .player video { display: block; width: 100%; min-height: 180px; max-height: 70vh; max-height: 70svh; background: #000; border-radius: 10px; }
    .player-status { padding: 12px 0; }
    .player-status p { margin: 0 0 8px; }
    .player progress { width: 100%; height: 8px; accent-color: #1d4ed8; }
    .player button, .download { min-height: 44px; box-sizing: border-box; padding: 12px 16px; font: inherit; border-radius: 8px; }
    .player button { border: 0; background: #1d4ed8; color: white; cursor: pointer; margin-top: 8px; }
    .player button:disabled { opacity: .5; cursor: default; }
    .download { display: inline-flex; align-items: center; color: #1d4ed8; background: #e2e8f0; }
    .player :focus-visible { outline: 3px solid #2563eb; outline-offset: 3px; }
    @media (prefers-color-scheme: dark) {
      body:has(.player) { background: #0f172a; color: #f1f5f9; }
      .player p { color: #cbd5e1; }
      .player button:disabled { opacity: .5; cursor: default; }
    .download { background: #1e293b; color: #93c5fd; }
    }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
