// Applies every migration once, tracked in a schema_migrations table.
// Safe to run repeatedly: an applied migration is skipped, and a migration that
// fails part way is rolled back so the next run starts it again from scratch.
import { Database } from "bun:sqlite";
import { mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Resolved against this file, not the shell's working directory.
const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
const dataDir = Bun.env.POSTPLAN_DATA_DIR ?? "./data";
await mkdir(dataDir, { recursive: true });

const db = new Database(`${dataDir}/postplan.sqlite`, { create: true });
db.exec("PRAGMA foreign_keys = ON");
db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");

const applied = new Set(db.query("SELECT name FROM schema_migrations").all().map((row) => row.name));
const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();

let count = 0;
for (const name of files) {
  if (applied.has(name)) continue;
  const sql = await Bun.file(`${migrationsDir}/${name}`).text();
  db.transaction(() => {
    db.exec(sql);
    db.query("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
      name,
      new Date().toISOString()
    );
  })();
  console.log(`applied ${name}`);
  count += 1;
}

db.close();
console.log(count ? `${count} migration(s) applied.` : "Already up to date.");
