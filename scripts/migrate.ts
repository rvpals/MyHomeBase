import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dbPath = process.env.MYHOMEBASE_DB ?? path.join(process.cwd(), "data", "myhomebase.db");
const migrationsDir = path.join(process.cwd(), "migrations");

function backupIfExists(): void {
  if (!existsSync(dbPath)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${dbPath}.bak-${stamp}`;
  copyFileSync(dbPath, backupPath);
  console.log(`Backed up existing database to ${backupPath}`);
}

function main(): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  backupIfExists();

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    (db.prepare("SELECT filename FROM schema_migrations").all() as { filename: string }[]).map(
      (row) => row.filename,
    ),
  );

  const pending = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .filter((file) => !applied.has(file));

  if (pending.length === 0) {
    console.log("No pending migrations.");
    db.close();
    return;
  }

  const applyMigration = db.transaction((filename: string, sql: string) => {
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (filename) VALUES (?)").run(filename);
  });

  for (const filename of pending) {
    console.log(`Applying ${filename}...`);
    const sql = readFileSync(path.join(migrationsDir, filename), "utf8");
    applyMigration(filename, sql);
  }

  db.close();
  console.log(`Applied ${pending.length} migration(s) to ${dbPath}.`);
}

main();
