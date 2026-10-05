// Sets the logo the uploads dashboard shows for a project, using the same
// credentials as the Postplan HTML CLI. Publishing again replaces it.
import { resolve } from "node:path";
import { apiEndpoint } from "./credentials.js";

try {
  const [project, path, ...extra] = process.argv.slice(2);
  if (!project || !path || extra.length) throw new Error("Usage: bun run publish-logo <project-slug> /path/to/logo.svg");
  const { url, key } = await apiEndpoint(`/api/projects/${encodeURIComponent(project)}/logo`);
  const file = Bun.file(resolve(path));
  if (!(await file.exists()) || !file.size) throw new Error("Logo is missing or empty.");
  const response = await fetch(url, {
    method: "PUT",
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
