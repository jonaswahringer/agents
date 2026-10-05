import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { initializeMediaDiagnostics } from "../src/media-diagnostics.js";

function setup(response) {
  const nodes = {};
  const requests = [];
  let clock = 0;
  for (const id of ["video", "status", "results", "stream", "download", "local", "copy"]) {
    nodes[id] = { value: "", disabled: id === "local", listeners: {},
      addEventListener(event, fn) { this.listeners[event] = fn; },
      emit(event) { return this.listeners[event]?.(); }
    };
  }
  Object.assign(nodes.video, {
    dataset: { path: "/media/test.mp4", size: "4" }, buffered: { length: 0 }, currentTime: 0,
    pause() {}, load() {}, removeAttribute() {},
    play() { return Promise.resolve(); }
  });
  runInNewContext(`(${initializeMediaDiagnostics.toString()})();`, {
    document: { getElementById: (id) => nodes[id] },
    performance: { now: () => clock += 100 },
    navigator: { userAgent: "test", clipboard: { writeText: async () => {} } },
    URL: { createObjectURL: () => "blob:downloaded", revokeObjectURL() {} },
    Blob, AbortController, setTimeout, clearTimeout,
    fetch: async (...args) => { requests.push(args); return response; }
  });
  return { nodes, requests };
}

test("measures a complete download and switches playback to the local copy", async () => {
  const { nodes, requests } = setup(new Response("test", { headers: { "Content-Type": "video/mp4" } }));
  await nodes.stream.emit("click");
  expect(nodes.video.src).toBe("/media/test.mp4");
  await nodes.download.emit("click");
  expect(requests[0][0]).toBe("/media/test.mp4");
  expect(requests[0][1].cache).toBe("no-store");
  expect(nodes.results.value).toContain("Headers received; HTTP 200");
  expect(nodes.results.value).toContain("Download complete: 4 bytes");
  expect(nodes.local.disabled).toBe(false);
  await nodes.local.emit("click");
  expect(nodes.video.src).toBe("blob:downloaded");
  expect(nodes.results.value).toContain("[downloaded] Play requested");
});

test("an incomplete download is not presented as ready for playback", async () => {
  const { nodes } = setup(new Response("bad"));
  await nodes.download.emit("click");
  expect(nodes.local.disabled).toBe(true);
  expect(nodes.download.disabled).toBe(false);
  expect(nodes.results.value).toContain("Incomplete download");
  expect(nodes.results.value).not.toContain("Download complete");
});
