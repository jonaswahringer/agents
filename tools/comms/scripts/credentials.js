// The comms URL and API key, from the environment or the Postplan HTML CLI's
// saved config in ~/.postplan, shared by the publish scripts.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

async function savedConfig(name) {
  try {
    return JSON.parse(await readFile(join(homedir(), ".postplan", name), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

export async function apiEndpoint(path) {
  const [config, credentials] = await Promise.all([savedConfig("config.json"), savedConfig("credentials.json")]);
  const base = (Bun.env.POSTPLAN_API_URL || config.apiUrl || "").replace(/\/+$/, "");
  const key = Bun.env.POSTPLAN_API_KEY || credentials.apiKey;
  if (!base || !key) throw new Error("Set up Postplan credentials first, or set POSTPLAN_API_URL and POSTPLAN_API_KEY.");
  const url = new URL(`${base}${path}`);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("Use HTTPS, or HTTP on localhost, for authenticated uploads.");
  }
  return { url, key };
}
