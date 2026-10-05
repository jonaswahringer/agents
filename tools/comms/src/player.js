export function initializePlayer() {
  const video = document.getElementById("recording");
  const message = document.getElementById("player-message");
  const progress = document.getElementById("player-progress");
  const retry = document.getElementById("player-retry");
  const play = document.getElementById("player-play");
  const full = document.getElementById("player-full");
  const source = video.dataset.src;
  const expected = Number(video.dataset.size);
  // A full download stays in this browser's Cache Storage for an hour, so
  // coming back to the recording plays it without downloading it again.
  const SAVED = "comms-recordings", KEEP = 60 * 60 * 1000;
  let mode = "stream", controller, timer, objectUrl, generation = 0, hidden = false;
  let unlocked = false, keptUntil = null;

  function downloadedText() {
    return keptUntil
      ? `Fully downloaded and kept on this device until ${clock(keptUntil)}. Tap Play to watch.`
      : "Fully downloaded. Tap Play to watch.";
  }
  function lock() { video.controls = false; play.disabled = true; unlocked = false; }
  function available(text) {
    unlocked = true; video.controls = true; play.disabled = false;
    message.textContent = text;
  }
  function updateBuffer() {
    if (mode !== "stream") return;
    if (video.error) return failed("Video loading failed. Retry, or download fully.");
    // Count only a continuous playable range starting at the beginning.
    let end = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) > end + 0.1) break;
      end = Math.max(end, video.buffered.end(i));
    }
    const fraction = Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(1, end / video.duration) : 0;
    progress.max = 100; progress.value = fraction * 100; progress.hidden = false;
    const percent = Math.floor(fraction * 100);
    if (fraction >= .3 && video.readyState >= 3) {
      available(`${percent}% buffered. You can play now, or wait for 100%.`);
    } else if (video.networkState === 1 && video.readyState >= 3) {
      // NETWORK_IDLE: the browser stopped preloading on its own (desktop Chrome
      // does short of 30% for a paused video) and has enough to start.
      available(`${percent}% buffered. The browser loads the rest while playing. You can play now.`);
    } else if (!unlocked) {
      message.textContent = `${percent}% buffered. Playback unlocks at 30%. You can also download fully.`;
    }
  }
  function failed(text) {
    lock(); message.textContent = text; retry.hidden = false; full.disabled = false;
  }
  function cancel() {
    generation++; keptUntil = null;
    clearTimeout(timer); controller?.abort(); controller = null;
    video.pause(); video.removeAttribute("src"); video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  function startStream() {
    mode = "reset"; cancel(); mode = "stream"; lock();
    retry.hidden = true; full.disabled = false;
    progress.max = 100; progress.value = 0; progress.hidden = false;
    message.textContent = "Buffering video. Playback unlocks at 30%, or choose Download fully.";
    video.preload = "auto"; video.src = source; video.load();
  }
  function clock(time) {
    return new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  // Removes copies older than an hour and returns this recording's, if any.
  async function savedCopy() {
    const cache = await caches.open(SAVED);
    let found = null;
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      const savedAt = Number(response?.headers.get("x-comms-saved-at"));
      if (!(Date.now() - savedAt < KEEP)) await cache.delete(request);
      else if (request.url.endsWith(source)) found = { response, until: savedAt + KEEP };
    }
    if (!found) return null;
    const blob = await found.response.blob();
    if (blob.size !== expected || !blob.size) { await cache.delete(source); return null; }
    return { blob, until: found.until };
  }
  // Best effort: without storage the download still plays, it just is not kept.
  async function saveCopy(blob) {
    if (typeof caches === "undefined") return null;
    try {
      const savedAt = Date.now();
      await (await caches.open(SAVED)).put(source, new Response(blob, {
        headers: { "content-type": blob.type, "x-comms-saved-at": String(savedAt) }
      }));
      return savedAt + KEEP;
    } catch { return null; }
  }
  function playSaved({ blob, until }) {
    mode = "reset"; cancel(); mode = "downloaded"; lock();
    keptUntil = until;
    retry.hidden = true; full.disabled = true;
    progress.max = 100; progress.value = 100; progress.hidden = false;
    message.textContent = `Saved on this device until ${clock(until)}. Preparing playback…`;
    objectUrl = URL.createObjectURL(blob);
    video.src = objectUrl; video.load();
  }
  function start() {
    if (typeof caches === "undefined") return startStream();
    const run = generation;
    message.textContent = "Checking for a copy saved on this device…";
    savedCopy().then(
      (saved) => { if (run === generation) saved ? playSaved(saved) : startStream(); },
      () => { if (run === generation) startStream(); }
    );
  }
  async function downloadFully() {
    mode = "reset"; cancel(); mode = "download"; lock();
    const run = generation;
    controller = new AbortController();
    const signal = controller.signal;
    retry.hidden = true; full.disabled = true;
    progress.max = expected; progress.value = 0; progress.hidden = false;
    message.textContent = "Downloading the full video: 0%";
    let timedOut = false;
    const watchdog = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { timedOut = true; controller?.abort(); }, 45000);
    };
    watchdog();
    try {
      const response = await fetch(source, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader(), chunks = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (run !== generation) { await reader.cancel(); return; }
        if (done) break;
        received += value.byteLength;
        if (received > expected) throw new Error("Unexpected file size");
        chunks.push(value); watchdog();
        progress.value = received;
        message.textContent = `Downloading the full video: ${Math.floor(received / expected * 100)}% (${(received / 1e6).toFixed(1)} / ${(expected / 1e6).toFixed(1)} MB)`;
      }
      if (received !== expected || !received) throw new Error("Incomplete download");
      clearTimeout(timer);
      const blob = new Blob(chunks, { type: video.dataset.type });
      objectUrl = URL.createObjectURL(blob);
      mode = "downloaded";
      message.textContent = "100% downloaded. Preparing playback…";
      video.src = objectUrl; video.load();
      const until = await saveCopy(blob);
      if (run !== generation) return;
      keptUntil = until;
      if (unlocked && video.paused) message.textContent = downloadedText();
    } catch (error) {
      if (run !== generation) return;
      mode = "failed";
      failed(timedOut ? "Download stopped responding. Retry to start again."
        : "Download failed. Retry to start again, or use the download link.");
    } finally {
      if (run === generation) clearTimeout(timer);
    }
  }
  for (const event of ["progress", "loadedmetadata", "loadeddata", "canplay", "suspend"]) {
    video.addEventListener(event, () => {
      if (mode === "downloaded" && video.readyState >= 3) {
        available(downloadedText());
      } else updateBuffer();
    });
  }
  video.addEventListener("waiting", () => {
    if (unlocked) message.textContent = "Playback is waiting for more data. Download fully to avoid network pauses.";
  });
  video.addEventListener("playing", () => {
    message.textContent = mode === "downloaded" ? "Playing the fully downloaded video." : "Playing. Buffering continues in the background.";
  });
  video.addEventListener("error", () => {
    if (mode === "stream" || mode === "downloaded") failed("Playback failed. Retry or use the download link.");
  });
  play.addEventListener("click", () => {
    if (!unlocked) return;
    video.play().catch(() => { message.textContent = "Tap the video's play control to start playback."; });
  });
  full.addEventListener("click", downloadFully);
  retry.addEventListener("click", downloadFully);
  window.addEventListener("pagehide", () => { hidden = true; mode = "reset"; cancel(); lock(); });
  window.addEventListener("pageshow", () => { if (hidden) { hidden = false; start(); } });
  start();
}
