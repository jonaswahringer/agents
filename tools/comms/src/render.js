import { initializePlayer } from "./player.js";
import { escapeHtml, formatSize, ICONS, meta, page, timeAgo } from "./ui.js";

export function renderNotFound() {
  return page({
    title: "Not found · Comms",
    styles: `.missing { text-align: center; padding-top: 12vh; } .missing > svg { width: 44px; height: 44px; color: var(--subtle); }
      .missing h1 { font-size: 24px; margin-top: 14px; } .missing .btn { margin-top: 22px; }`,
    body: `<main class="wrap missing">
      ${ICONS.research}
      <h1>Not found</h1>
      <p class="sub">This upload was deleted, or the link is wrong.</p>
      <a class="btn" href="/dashboard">${ICONS.back}Uploads</a>
    </main>`
  });
}

// back: where "‹ name" returns to, the upload's dashboard group when it has one.
export function renderMediaPage({ filename, mediaPath, downloadPath, nonce, size, contentType, createdAt, back }) {
  const backTile = back.logo ? `<span class="tile logo"><img src="${escapeHtml(back.logo)}" alt=""></span>` : "";
  return page({
    title: `${filename} · Comms`,
    styles: PLAYER_STYLES,
    nonce,
    script: `(${initializePlayer.toString()})();`,
    body: `<main class="wrap player">
      <a class="back" href="${escapeHtml(back.href)}">${ICONS.back}${backTile}<span>${escapeHtml(back.name)}</span></a>
      <h1>${escapeHtml(filename)}</h1>
      <p class="sub">${meta(["Video", formatSize(size), createdAt && `Uploaded ${timeAgo(createdAt)}`])}</p>
      <div class="stage">
        <video playsinline preload="auto" id="recording" aria-label="${escapeHtml(filename)}" data-src="${escapeHtml(mediaPath)}" data-size="${size}" data-type="${escapeHtml(contentType)}"></video>
      </div>
      <section id="player-status" class="panel" aria-label="Playback">
        <p id="player-message" role="status" aria-live="polite" aria-atomic="true"></p>
        <progress id="player-progress" aria-label="Video buffering progress" max="100" value="0"></progress>
        <div class="actions">
          <button id="player-play" class="btn primary" type="button" disabled>${ICONS.play}Play</button>
          <button id="player-full" class="btn" type="button">${ICONS.download}Download fully before playing</button>
          <button id="player-retry" class="btn" type="button" hidden>${ICONS.retry}Retry playback</button>
          <a class="btn quiet" href="${escapeHtml(downloadPath)}" download>Download recording</a>
        </div>
      </section>
      <noscript><p class="sub">JavaScript is required for buffering. Use the download link to watch the recording.</p></noscript>
    </main>`
  });
}

const PLAYER_STYLES = `
  .back { display: inline-flex; align-items: center; gap: 6px; height: 34px; margin: 0 0 12px -8px; padding: 0 12px 0 6px;
    border-radius: 10px; color: var(--muted); font-size: 14px; font-weight: 560; }
  .back:hover { background: var(--hover); color: var(--text); }
  .back > svg { width: 18px; height: 18px; }
  .back .tile { width: 20px; height: 20px; border-radius: 6px; }
  .player h1 { font-size: clamp(21px, 4.6vw, 28px); }
  .stage { margin: 18px 0 14px; border-radius: 18px; overflow: hidden; background: #000;
    box-shadow: 0 1px 2px rgba(0, 0, 0, .1), 0 12px 32px rgba(15, 23, 42, .14); }
  .stage video { display: block; width: 100%; min-height: 200px; max-height: 72vh; max-height: 72svh; background: #000; }
  .panel { display: grid; gap: 12px; padding: 16px; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); box-shadow: var(--shadow); }
  .panel p { margin: 0; font-size: 14px; color: var(--text); min-height: 20px; }
  .panel progress { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 6px; border: 0;
    border-radius: 99px; background: var(--sunken); overflow: hidden; }
  .panel progress::-webkit-progress-bar { background: var(--sunken); border-radius: 99px; }
  .panel progress::-webkit-progress-value { background: linear-gradient(90deg, #3b82f6, #7c3aed); border-radius: 99px; transition: width .3s ease; }
  .panel progress::-moz-progress-bar { background: linear-gradient(90deg, #3b82f6, #7c3aed); border-radius: 99px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  @media (max-width: 520px) {
    .actions .btn { flex: 1 1 100%; }
    .stage { border-radius: 14px; }
  }
`;
