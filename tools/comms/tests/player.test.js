import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { initializePlayer } from "../src/player.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 20; i++) await tick(); };
const HOUR = 60 * 60 * 1000;

// Cache Storage as the browser offers it, kept in memory and shared between
// player instances the way one browser's storage outlives a page.
function memoryCaches() {
  const stores = new Map();
  const key = (request) => new URL(typeof request === "string" ? request : request.url, "https://comms.test").href;
  return {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async keys() { return [...store.keys()].map((url) => ({ url })); },
        async match(request) { return store.get(key(request))?.clone(); },
        async put(request, response) { store.set(key(request), response); },
        async delete(request) { return store.delete(key(request)); }
      };
    }
  };
}

function savedResponse(body, savedAt) {
  return new Response(body, { headers: { "content-type": "video/mp4", "x-comms-saved-at": String(savedAt) } });
}

function player({ caches } = {}) {
  const elements = {}, requests = [], revoked = [], timers = new Map();
  let timerId = 0, urlId = 0;
  for (const id of ["recording", "player-status", "player-message", "player-progress", "player-retry", "player-play", "player-full", "window"]) {
    elements[id] = { hidden: true, disabled: true, listeners: {},
      addEventListener(event, handler) { this.listeners[event] = handler; },
      emit(event) { return this.listeners[event]?.(event); },
      removeAttribute(name) { delete this[name]; }
    };
  }
  const video = elements.recording;
  Object.assign(video, {
    dataset: { src: "/media/test.mp4", size: "4", type: "video/mp4" },
    buffered: { length: 0 }, paused: true, readyState: 0, currentTime: 0, duration: 60, controls: false,
    pause() { this.paused = true; this.emit("pause"); },
    load() { this.error = null; this.readyState = 0; this.emit("loadstart"); },
    play() { this.paused = false; this.emit("playing"); return Promise.resolve(); }
  });
  runInNewContext(`(${initializePlayer.toString()})();`, {
    document: { getElementById: (id) => elements[id] }, window: elements.window,
    URL: { createObjectURL: () => `blob:${++urlId}`, revokeObjectURL: (url) => revoked.push(url) },
    Blob, AbortController, Response,
    ...(caches ? { caches } : {}),
    fetch: (path, options) => new Promise((resolve, reject) => {
      const request = { path, options, resolve, reject };
      requests.push(request);
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }),
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id) => timers.delete(id)
  });
  return { video, elements, requests, revoked,
    text: () => elements["player-message"].textContent,
    timeout: () => { for (const fn of [...timers.values()]) fn(); }
  };
}

test("progress counts bytes and never enables playback before download completion", async () => {
  const p = player();
  p.elements["player-full"].emit("click");
  expect(p.requests.length).toBe(1);
  expect(p.video.src).toBeUndefined();
  expect(p.elements["player-play"].disabled).toBe(true);
  let body;
  const stream = new ReadableStream({ start(controller) { body = controller; } });
  p.requests[0].resolve(new Response(stream));
  body.enqueue(new Uint8Array([1, 2]));
  await tick();
  expect(p.elements["player-progress"].value).toBe(2);
  expect(p.elements["player-progress"].max).toBe(4);
  expect(p.text()).toContain("50%");
  p.video.emit("suspend"); p.video.emit("loadedmetadata");
  expect(p.video.controls).toBe(false);
  expect(p.video.src).toBeUndefined();
  body.enqueue(new Uint8Array([3, 4]));
  await tick();
  expect(p.video.src).toBeUndefined(); // byte count alone does not prove EOF
  body.close(); await tick();
  expect(p.video.src).toBe("blob:1");
  expect(p.elements["player-play"].disabled).toBe(true);
  p.video.readyState = 4; p.video.emit("canplay");
  expect(p.elements["player-play"].disabled).toBe(false);
  expect(p.video.controls).toBe(true);
  expect(p.text()).toContain("Fully downloaded");
  p.elements["player-play"].emit("click");
  expect(p.video.paused).toBe(false);
  expect(p.requests.length).toBe(1);
});

test("truncated downloads fail and retry starts a new transfer", async () => {
  const p = player();
  p.elements["player-full"].emit("click");
  p.requests[0].resolve(new Response("bad")); await tick();
  expect(p.video.src).toBeUndefined();
  expect(p.elements["player-retry"].hidden).toBe(false);
  expect(p.elements["player-play"].disabled).toBe(true);
  p.elements["player-retry"].emit("click");
  expect(p.requests.length).toBe(2);
  p.requests[1].resolve(new Response("good")); await tick();
  expect(p.video.src).toBe("blob:1");
});

test("HTTP errors and stalled transfers never become playable", async () => {
  const p = player();
  p.elements["player-full"].emit("click");
  p.requests[0].resolve(new Response("no", { status: 500 })); await tick();
  expect(p.elements["player-retry"].hidden).toBe(false);
  expect(p.video.src).toBeUndefined();
  p.elements["player-retry"].emit("click"); p.timeout(); await tick();
  expect(p.requests[1].options.signal.aborted).toBe(true);
  expect(p.text()).toContain("stopped responding");
  expect(p.elements["player-play"].disabled).toBe(true);
});

test("leaving aborts downloads; returning restarts and discards stale responses", async () => {
  const p = player();
  p.elements["player-full"].emit("click");
  p.elements.window.emit("pagehide");
  expect(p.requests[0].options.signal.aborted).toBe(true);
  p.elements.window.emit("pageshow");
  p.elements["player-full"].emit("click");
  expect(p.requests.length).toBe(2);
  p.requests[1].resolve(new Response("good")); await tick();
  expect(p.video.src).toBe("blob:1");
  p.elements.window.emit("pagehide");
  expect(p.revoked).toEqual(["blob:1"]);
  expect(p.video.src).toBeUndefined();
});

test("streamed playback unlocks only after 30% of the duration is continuously playable", () => {
  const p = player();
  expect(p.requests.length).toBe(0);
  expect(p.video.src).toBe("/media/test.mp4");
  expect(p.video.controls).toBe(false);
  p.video.readyState = 3;
  p.video.buffered = { length: 1, start: () => 0, end: () => 17 };
  p.video.emit("progress");
  expect(p.elements["player-play"].disabled).toBe(true);
  p.video.buffered.end = () => 18;
  p.video.emit("progress");
  expect(p.elements["player-play"].disabled).toBe(false);
  expect(p.video.controls).toBe(true);
  expect(p.text()).toContain("30% buffered");
  p.elements["player-play"].emit("click");
  expect(p.video.paused).toBe(false);
});

test("playback unlocks below 30% once the browser stops preloading with enough to start", () => {
  const p = player();
  p.video.buffered = { length: 1, start: () => 0, end: () => 17 };
  p.video.readyState = 4; p.video.networkState = 2;
  p.video.emit("progress");
  expect(p.elements["player-play"].disabled).toBe(true);
  p.video.networkState = 1; p.video.readyState = 2;
  p.video.emit("suspend");
  expect(p.elements["player-play"].disabled).toBe(true);
  p.video.readyState = 4;
  p.video.emit("suspend");
  expect(p.elements["player-play"].disabled).toBe(false);
  expect(p.text()).toContain("28% buffered. The browser loads the rest while playing.");
});

test("metadata alone and disconnected buffered ranges cannot unlock playback", () => {
  const p = player();
  p.video.readyState = 1;
  p.video.emit("loadedmetadata");
  expect(p.elements["player-play"].disabled).toBe(true);
  p.video.readyState = 3;
  p.video.buffered = { length: 2, start: (i) => i ? 40 : 0, end: (i) => i ? 60 : 10 };
  p.video.emit("progress");
  expect(p.elements["player-play"].disabled).toBe(true);
  expect(p.elements["player-progress"].value).toBeCloseTo(100 / 6);
});

test("a full download is kept for an hour and replayed on return without the network", async () => {
  const caches = memoryCaches();
  const first = player({ caches });
  await settle();
  expect(first.video.src).toBe("/media/test.mp4");
  first.elements["player-full"].emit("click");
  first.requests[0].resolve(new Response("good")); await settle();
  const saved = caches.stores.get("comms-recordings").get("https://comms.test/media/test.mp4");
  expect(Number(saved.headers.get("x-comms-saved-at"))).toBeGreaterThan(Date.now() - 1000);
  first.video.readyState = 4; first.video.emit("canplay");
  expect(first.text()).toContain("kept on this device until");

  const again = player({ caches });
  await settle();
  expect(again.requests.length).toBe(0);
  expect(again.video.src).toBe("blob:1");
  expect(again.elements["player-full"].disabled).toBe(true);
  expect(again.text()).toContain("Saved on this device until");
  again.video.readyState = 4; again.video.emit("canplay");
  expect(again.elements["player-play"].disabled).toBe(false);

  // Leaving releases the in-memory copy; coming back finds the saved one.
  again.elements.window.emit("pagehide");
  expect(again.revoked).toEqual(["blob:1"]);
  again.elements.window.emit("pageshow"); await settle();
  expect(again.video.src).toBe("blob:2");
  expect(again.requests.length).toBe(0);
});

test("copies older than an hour or of the wrong size are dropped and the video streams", async () => {
  const caches = memoryCaches();
  const store = await caches.open("comms-recordings");
  await store.put("/media/test.mp4", savedResponse("good", Date.now() - HOUR - 1));
  await store.put("/media/other.mp4", savedResponse("good", Date.now() - HOUR - 1));
  await store.put("/media/kept.mp4", savedResponse("good", Date.now()));
  const p = player({ caches });
  await settle();
  expect(p.video.src).toBe("/media/test.mp4");
  expect([...caches.stores.get("comms-recordings").keys()]).toEqual(["https://comms.test/media/kept.mp4"]);

  await store.put("/media/test.mp4", savedResponse("short-or-long", Date.now()));
  const q = player({ caches });
  await settle();
  expect(q.video.src).toBe("/media/test.mp4");
  expect(await store.match("/media/test.mp4")).toBeUndefined();
});

test("choosing a full download while the saved-copy check runs wins", async () => {
  const caches = memoryCaches();
  await (await caches.open("comms-recordings")).put("/media/test.mp4", savedResponse("good", Date.now()));
  const p = player({ caches });
  p.elements["player-full"].emit("click");
  await settle();
  expect(p.requests.length).toBe(1);
  expect(p.video.src).toBeUndefined();
});

test("storage that refuses the copy still plays the download", async () => {
  const caches = memoryCaches();
  const open = caches.open.bind(caches);
  caches.open = async (name) => ({ ...(await open(name)), put: async () => { throw new Error("QuotaExceededError"); } });
  const p = player({ caches });
  await settle();
  p.elements["player-full"].emit("click");
  p.requests[0].resolve(new Response("good")); await settle();
  p.video.readyState = 4; p.video.emit("canplay");
  expect(p.text()).toBe("Fully downloaded. Tap Play to watch.");
  expect(p.elements["player-play"].disabled).toBe(false);
});
