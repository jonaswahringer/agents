export function initializePlayer() {
  const video = document.getElementById("recording");
  const message = document.getElementById("player-message");
  const progress = document.getElementById("player-progress");
  const retry = document.getElementById("player-retry");
  const play = document.getElementById("player-play");
  const full = document.getElementById("player-full");
  const source = video.dataset.src;
  const expected = Number(video.dataset.size);
  let mode = "stream", controller, timer, objectUrl, generation = 0, hidden = false;
  let unlocked = false;

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
    } else if (!unlocked) {
      message.textContent = `${percent}% buffered. Playback unlocks at 30%. You can also download fully.`;
    }
  }
  function failed(text) {
    lock(); message.textContent = text; retry.hidden = false; full.disabled = false;
  }
  function cancel() {
    generation++;
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
      const response = await fetch(source, { signal, cache: "no-store" });
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
      objectUrl = URL.createObjectURL(new Blob(chunks, { type: video.dataset.type }));
      mode = "downloaded";
      message.textContent = "100% downloaded. Preparing playback…";
      video.src = objectUrl; video.load();
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
        available("Fully downloaded. Tap Play to watch.");
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
  window.addEventListener("pageshow", () => { if (hidden) { hidden = false; startStream(); } });
  startStream();
}
