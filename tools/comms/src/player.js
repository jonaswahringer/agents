export function initializePlayer() {
  const video = document.getElementById("recording");
  const status = document.getElementById("player-status");
  const message = document.getElementById("player-message");
  const progress = document.getElementById("player-progress");
  const retry = document.getElementById("player-retry");
  let timer;
  let resumeTime = 0;

  function show(text, busy = false, canRetry = false) {
    clearTimeout(timer);
    status.hidden = !text;
    message.textContent = text;
    progress.hidden = !busy;
    retry.hidden = !canRetry;
    if (busy) {
      timer = setTimeout(() => {
        message.textContent = "This is taking longer than usual. You can wait or retry.";
        retry.hidden = false;
      }, 12000);
    }
  }

  function ready() {
    if (video.error) return failed();
    show(video.paused && !video.ended ? "Tap play to watch." : "");
  }

  function failed() {
    show("The recording could not play. Retry, or download it to open in a video player.", false, true);
  }

  video.addEventListener("loadstart", () => show("Loading video…", true));
  video.addEventListener("loadedmetadata", () => {
    if (resumeTime) {
      video.currentTime = Math.min(resumeTime, Number.isFinite(video.duration) ? video.duration : resumeTime);
      resumeTime = 0;
    }
    if (video.paused) ready();
  });
  video.addEventListener("play", () => {
    if (video.readyState < 3) show("Loading video…", true);
    else ready();
  });
  video.addEventListener("waiting", () => show("Buffering video…", true));
  video.addEventListener("seeking", () => show("Loading this part…", true));
  video.addEventListener("seeked", () => {
    if (video.paused || video.readyState >= 3) ready();
  });
  video.addEventListener("stalled", () => {
    if (video.readyState < 3 && !video.paused) show("Waiting for the connection…", true);
  });
  video.addEventListener("suspend", () => {
    if (video.paused && !video.error) ready();
  });
  for (const event of ["canplay", "playing", "pause", "ended"]) {
    video.addEventListener(event, ready);
  }
  video.addEventListener("error", failed);
  retry.addEventListener("click", () => {
    resumeTime = video.currentTime || 0;
    show("Loading video…", true);
    video.load();
    video.play().catch(() => {
      if (video.error) failed();
      else ready();
    });
  });
  window.addEventListener("pageshow", () => {
    if (video.error) failed();
    else if (video.readyState >= 1) ready();
  });
  window.addEventListener("pagehide", () => clearTimeout(timer));
  if (video.error) failed();
  else if (video.readyState >= 1) ready();
  else show("Loading video…", true);
}
