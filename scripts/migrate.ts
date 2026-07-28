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

// One-time rename of every pre-prefix table to its module-prefixed name
// (sys_ = platform, rei_ = real estate, stk_ = stocks & ETFs). CSV Analysis
// tables already carry the csv_ prefix, so they are absent here. This is a
// reconciliation step rather than a numbered migration because the migration
// files themselves now create the prefixed names, and the schema_migrations
// tracker (renamed below) cannot record its own rename mid-run. It is idempotent:
// each table is renamed only when the old name still exists and the new one does not.
const LEGACY_TABLE_RENAMES: ReadonlyArray<readonly [oldName: string, newName: string]> = [
  ["schema_migrations", "sys_schema_migrations"],
  ["modules", "sys_modules"],
  ["app_settings", "sys_app_settings"],
  ["module_settings", "sys_module_settings"],
  ["users", "sys_users"],
  ["user_module_access", "sys_user_module_access"],
  ["sessions", "sys_sessions"],
  ["investment_accounts", "stk_investment_accounts"],
  ["account_performance_records", "stk_account_performance_records"],
  ["stock_positions", "stk_stock_positions"],
  ["stock_transactions", "stk_stock_transactions"],
  ["stock_watch_lists", "stk_stock_watch_lists"],
  ["stock_watch_list_items", "stk_stock_watch_list_items"],
  ["stock_volatility_cache", "stk_stock_volatility_cache"],
  ["stock_correlation_cache", "stk_stock_correlation_cache"],
  ["stock_sharpe_cache", "stk_stock_sharpe_cache"],
];

function tableExists(db: Database.Database, name: string): boolean {
  return (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined
  );
}

// Must run before the schema_migrations table is created/read so the applied-migration
// history survives the rename to sys_schema_migrations.
function reconcileLegacyTableNames(db: Database.Database): void {
  const applyRenames = db.transaction(() => {
    for (const [oldName, newName] of LEGACY_TABLE_RENAMES) {
      const hasOld = tableExists(db, oldName);
      const hasNew = tableExists(db, newName);

      if (hasOld && hasNew) {
        // Both present means a prior run half-completed; skipping would hide that,
        // so surface it loudly rather than silently leaving an orphaned table.
        console.warn(
          `Skipping rename ${oldName} -> ${newName}: both tables exist. ` +
            `Resolve manually (the legacy "${oldName}" was left in place).`,
        );
        continue;
      }
      if (!hasOld) continue; // already renamed (or never existed) — nothing to do

      db.exec(`ALTER TABLE "${oldName}" RENAME TO "${newName}"`);
      console.log(`Renamed table ${oldName} -> ${newName}`);
    }
  });
  applyRenames();
}

function main(): void {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  backupIfExists();

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // Bring any pre-prefix schema up to the module-prefixed names (incl. the tracker
  // itself) before touching schema_migrations, so applied history is preserved.
  reconcileLegacyTableNames(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sys_schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    (db.prepare("SELECT filename FROM sys_schema_migrations").all() as { filename: string }[]).map(
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
    db.prepare("INSERT INTO sys_schema_migrations (filename) VALUES (?)").run(filename);
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
