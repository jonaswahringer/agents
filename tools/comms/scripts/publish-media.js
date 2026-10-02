// Publishes a recording using the same credentials as the Postplan HTML CLI.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

async function savedConfig(name) {
  try {
    return JSON.parse(await readFile(join(homedir(), ".postplan", name), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

try {
  const [path, ...extra] = process.argv.slice(2);
  if (!path || extra.length) throw new Error("Usage: bun run scripts/publish-media.js /path/to/recording.mp4");
  const [config, credentials] = await Promise.all([savedConfig("config.json"), savedConfig("credentials.json")]);
  const base = (Bun.env.POSTPLAN_API_URL || config.apiUrl || "").replace(/\/+$/, "");
  const key = Bun.env.POSTPLAN_API_KEY || credentials.apiKey;
  if (!base || !key) throw new Error("Set up Postplan credentials first, or set POSTPLAN_API_URL and POSTPLAN_API_KEY.");
  const url = new URL(`${base}/api/media`);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("Use HTTPS, or HTTP on localhost, for authenticated uploads.");
  }
  const file = Bun.file(resolve(path));
  if (!(await file.exists()) || !file.size) throw new Error("Recording is missing or empty.");
  url.searchParams.set("filename", basename(path));
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/octet-stream" },
    body: file,
    redirect: "error"
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || `Upload failed with HTTP ${response.status}.`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
