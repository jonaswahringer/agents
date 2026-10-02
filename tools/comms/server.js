// comms: Postplan on Bun. The upstream worker in src/ is unchanged;
// src/adapters.js supplies the bindings Cloudflare would otherwise provide.
import { mkdir } from "node:fs/promises";
import { createApp } from "./src/api.js";
import { FileBucket, noAssets, SqliteD1 } from "./src/adapters.js";
import { deleteExpiredRateLimits } from "./src/rate-limit.js";
import { MediaFiles } from "./src/media.js";
import { getConfig } from "./src/config.js";

// launchd writes stdout and stderr straight to the log with nothing added, so
// anything worth finding later has to date itself.
const log = (message) => console.log(`${new Date().toISOString()} ${message}`);
const fail = (message) => {
  console.error(`${new Date().toISOString()} ${message}`);
  process.exit(1);
};

const dataDir = Bun.env.POSTPLAN_DATA_DIR ?? "./data";
const port = Number(Bun.env.PORT ?? 3775);

if (!Bun.env.POSTPLAN_BOOTSTRAP_API_KEY) {
  fail("POSTPLAN_BOOTSTRAP_API_KEY is required. See README.md.");
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  fail(`PORT must be a port number, got "${Bun.env.PORT}".`);
}

await mkdir(dataDir, { recursive: true });

const db = new SqliteD1(`${dataDir}/postplan.sqlite`);

// Without this the first request fails with an opaque "no such table"; under
// launchd's KeepAlive that would be an invisible restart loop.
const schema = await db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'drafts'")
  .first();
if (!schema) {
  fail(`No schema in ${dataDir}/postplan.sqlite. Run: bun run migrate`);
}

const env = {
  ...Bun.env,
  ASSETS: noAssets,
  DB: db,
  DRAFTS: new FileBucket(`${dataDir}/drafts`),
  MEDIA: new MediaFiles(`${dataDir}/media`)
};

const app = createApp();

// The worker ran this on a cron trigger; here it is a plain interval.
const sweep = setInterval(() => {
  deleteExpiredRateLimits(db).catch((error) =>
    console.error(`${new Date().toISOString()} rate limit sweep failed: ${error.message}`)
  );
}, 60 * 60 * 1000);

const hostname = Bun.env.HOST ?? "127.0.0.1";
let server;
try {
  server = Bun.serve({
    port,
    hostname,
    maxRequestBodySize: Math.max(getConfig(env).maxMediaBytes, getConfig(env).uploadBodyBytes),
    idleTimeout: 60,
    fetch: (request) => app.fetch(request, env, { waitUntil() {}, passThroughOnException() {} })
  });
} catch (error) {
  // A bare EADDRINUSE trace repeated by KeepAlive says nothing useful. Name the
  // port and who holds it instead.
  if (error.code === "EADDRINUSE") {
    fail(`${hostname}:${port} is already in use. Find the holder with: lsof -nP -iTCP:${port} -sTCP:LISTEN`);
  }
  fail(`Could not listen on ${hostname}:${port}: ${error.message}`);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    log(`stopping on ${signal}`);
    clearInterval(sweep);
    await server.stop();
    db.close();
    process.exit(0);
  });
}

const publicBaseUrl = Bun.env.POSTPLAN_PUBLIC_BASE_URL;
log(
  `comms listening on http://${server.hostname}:${server.port}` +
    (publicBaseUrl ? `, published as ${publicBaseUrl}` : "")
);
