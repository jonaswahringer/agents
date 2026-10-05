import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { initializePlayer } from "../src/player.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function player() {
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
    Blob, AbortController,
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
