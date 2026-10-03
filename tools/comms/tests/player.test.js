import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { initializePlayer } from "../src/player.js";

function player() {
  const elements = {};
  const timers = new Map();
  let timerId = 0;
  for (const id of ["recording", "player-status", "player-message", "player-progress", "player-retry", "window"]) {
    elements[id] = {
      hidden: true,
      listeners: {},
      addEventListener(event, handler) { this.listeners[event] = handler; },
      emit(event) { this.listeners[event]?.(); }
    };
  }
  const video = elements.recording;
  Object.assign(video, {
    paused: true, readyState: 0, currentTime: 0, duration: 60,
    load() { this.error = null; this.readyState = 0; this.emit("loadstart"); },
    play() { this.paused = false; this.emit("play"); return Promise.resolve(); }
  });
  runInNewContext(`(${initializePlayer.toString()})();`, {
    document: { getElementById: (id) => elements[id] },
    window: elements.window,
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id) => timers.delete(id)
  });
  return {
    video, elements,
    text: () => elements["player-message"].textContent,
    busy: () => !elements["player-progress"].hidden,
    timeout: () => { for (const fn of [...timers.values()]) fn(); }
  };
}

test("metadata-only loading waits for a tap without showing endless progress", () => {
  const p = player();
  expect(p.busy()).toBe(true);
  p.video.readyState = 1;
  p.video.emit("loadedmetadata");
  expect(p.text()).toBe("Tap play to watch.");
  expect(p.busy()).toBe(false);
  p.timeout();
  expect(p.elements["player-retry"].hidden).toBe(true);
});

test("a browser that defers preloading can still wait for a tap", () => {
  const p = player();
  p.video.emit("suspend");
  expect(p.text()).toBe("Tap play to watch.");
  expect(p.busy()).toBe(false);
});

test("buffering, seeking, recovery and ending update the visible state", () => {
  const p = player();
  p.video.play();
  p.video.emit("waiting");
  expect(p.text()).toBe("Buffering video…");
  expect(p.busy()).toBe(true);
  p.timeout();
  expect(p.elements["player-retry"].hidden).toBe(false);
  p.video.readyState = 3;
  p.video.emit("playing");
  expect(p.elements["player-status"].hidden).toBe(true);
  p.video.emit("seeking");
  expect(p.busy()).toBe(true);
  p.video.emit("seeked");
  expect(p.busy()).toBe(false);
  p.video.paused = true;
  p.video.emit("pause");
  expect(p.text()).toBe("Tap play to watch.");
  p.video.ended = true;
  p.video.emit("ended");
  expect(p.elements["player-status"].hidden).toBe(true);
});

test("retry recovers from a media error and resumes at the previous position", async () => {
  const p = player();
  p.video.currentTime = 24;
  p.video.error = { code: 2 };
  p.video.emit("error");
  p.video.emit("pause");
  expect(p.text()).toContain("could not play");
  expect(p.busy()).toBe(false);
  expect(p.elements["player-retry"].hidden).toBe(false);
  p.elements["player-retry"].emit("click");
  expect(p.busy()).toBe(true);
  expect(p.video.paused).toBe(false);
  p.video.currentTime = 0;
  p.video.emit("loadedmetadata");
  expect(p.video.currentTime).toBe(24);
  p.video.emit("playing");
  expect(p.elements["player-status"].hidden).toBe(true);
});

test("a blocked play request returns to the tap-to-play state", async () => {
  const p = player();
  p.video.play = () => Promise.reject(new Error("NotAllowedError"));
  p.elements["player-retry"].emit("click");
  await Promise.resolve();
  expect(p.text()).toBe("Tap play to watch.");
  expect(p.busy()).toBe(false);
});
