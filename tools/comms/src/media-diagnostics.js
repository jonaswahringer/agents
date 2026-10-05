import { randomToken } from "./crypto.js";
import { requireBinding } from "./config.js";

// Opt-in measurements stay in this page. No telemetry is sent or stored.
export function registerMediaDiagnostics(app) {
  app.get("/diagnostics/media/:name", async (c) => {
    const media = await requireBinding("MEDIA", c.env.MEDIA).get(c.req.param("name"));
    if (!media) return c.notFound();
    const nonce = randomToken();
    c.header("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    return c.html(`<!doctype html><html lang="en"><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Video connection test · Comms</title>
      <style>
        :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
        body { max-width: 760px; margin: 24px auto; padding: 0 16px; }
        video { width: 100%; max-height: 45vh; background: black; }
        button, a { display: inline-block; padding: 12px; margin: 8px 4px 8px 0; font: inherit; }
        textarea { width: 100%; box-sizing: border-box; height: 260px; font: 13px monospace; }
        p { line-height: 1.5; }
      </style></head><body>
      <h1>Video connection test</h1>
      <p>Try streamed playback, then download the file and play the downloaded copy. Results stay on this page.</p>
      <video id="video" controls playsinline preload="none" data-path="/media/${media.name}" data-size="${media.size}"></video>
      <p><button id="stream">1. Play streamed video</button>
      <button id="download">2. Download test file (${(media.size / 1e6).toFixed(2)} MB)</button>
      <button id="local" disabled>3. Play downloaded copy</button></p>
      <p id="status" role="status">Ready to test.</p>
      <a href="/media/${media.name}">Open directly in Safari</a>
      <p><button id="copy">Copy results</button></p>
      <textarea id="results" readonly aria-label="Test results"></textarea>
      <script nonce="${nonce}">(${initializeMediaDiagnostics.toString()})();</script>
    </body></html>`);
  });
}

export function initializeMediaDiagnostics() {
  const el = (id) => document.getElementById(id);
  const video = el("video"), status = el("status"), results = el("results");
  const stream = el("stream"), download = el("download"), local = el("local");
  const path = video.dataset.path;
  let objectUrl, mode = "idle", started = performance.now();
  function log(message) {
    results.value += `${((performance.now() - started) / 1000).toFixed(2)}s [${mode}] ${message}\n`;
    results.scrollTop = results.scrollHeight;
  }
  log(`Browser: ${navigator.userAgent}; file: ${path}; ${video.dataset.size} bytes`);
  for (const event of ["loadstart", "loadedmetadata", "loadeddata", "canplay", "playing", "waiting", "stalled", "suspend", "seeking", "seeked", "pause", "ended", "error"]) {
    video.addEventListener(event, () => {
      log(`${event}; ready=${video.readyState}; network=${video.networkState}; position=${video.currentTime.toFixed(2)}; buffered=${video.buffered.length ? video.buffered.end(video.buffered.length - 1).toFixed(2) : 0}${video.error ? `; error=${video.error.code}` : ""}`);
      if (event === "playing") status.textContent = `Playing ${mode} video.`;
      if (event === "waiting") status.textContent = `Waiting for ${mode} video.`;
      if (event === "error") status.textContent = "Playback failed. Copy the results below.";
    });
  }
  function play(source, label) {
    video.pause(); mode = label; started = performance.now();
    log("Play requested"); status.textContent = `Starting ${label} video…`;
    video.src = source;
    video.play().catch((error) => {
      log(`play() rejected: ${error.name}`);
      status.textContent = "Tap the video's native play button to continue.";
    });
  }
  stream.addEventListener("click", () => play(path, "streamed"));
  local.addEventListener("click", () => play(objectUrl, "downloaded"));
  download.addEventListener("click", async () => {
    video.pause(); video.removeAttribute("src"); video.load();
    stream.disabled = download.disabled = local.disabled = true;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null; mode = "download"; started = performance.now();
    log("Download requested; playback stopped to avoid competing transfers");
    status.textContent = "Downloading…";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(path, { cache: "no-store", signal: controller.signal });
      log(`Headers received; HTTP ${response.status}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader(), chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!size) log("First bytes received");
        chunks.push(value); size += value.byteLength;
        status.textContent = `Downloaded ${(size / 1e6).toFixed(2)} of ${(Number(video.dataset.size) / 1e6).toFixed(2)} MB`;
      }
      if (size !== Number(video.dataset.size)) throw new Error("Incomplete download");
      const elapsed = (performance.now() - started) / 1000;
      log(`Download complete: ${size} bytes in ${elapsed.toFixed(2)}s; ${(size * 8 / 1e6 / Math.max(elapsed, .001)).toFixed(2)} Mbps`);
      objectUrl = URL.createObjectURL(new Blob(chunks, { type: response.headers.get("Content-Type") || "video/mp4" }));
      local.disabled = false;
      status.textContent = `Downloaded in ${elapsed.toFixed(2)} seconds. Now tap “Play downloaded copy”.`;
    } catch (error) {
      log(`Download failed: ${error.name}: ${error.message}`);
      status.textContent = "Download failed or exceeded 60 seconds. Copy the results below.";
    } finally {
      clearTimeout(timeout); stream.disabled = download.disabled = false;
    }
  });
  el("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(results.value);
      status.textContent = "Results copied. Paste them into the chat.";
    } catch {
      results.focus(); results.select();
      status.textContent = "Select and copy the results, then paste them into the chat.";
    }
  });
}
