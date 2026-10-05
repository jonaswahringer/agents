// Publishes a recording using the same credentials as the Postplan HTML CLI.
import { basename, resolve } from "node:path";
import { apiEndpoint } from "./credentials.js";

try {
  const [path, ...extra] = process.argv.slice(2);
  if (!path || extra.length) throw new Error("Usage: bun run scripts/publish-media.js /path/to/recording.mp4");
  const { url, key } = await apiEndpoint("/api/media");
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
