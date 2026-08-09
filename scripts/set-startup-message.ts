// Sets the home screen's one-shot startup message in a *deployed* database.
//
// This is the deploy-side entry point, bundled to plain CJS for the NAS the same
// way scripts/migrate.ts is — the NAS has no tsx and no path-alias resolution, so
// this file imports by relative path rather than via `@/`.
//
// Usage (from a deployment folder, where ./data/myhomebase.db lives):
//   node set-startup-message.cjs                # standard "new deployment" wording
//   node set-startup-message.cjs "Custom text"  # any message
//   node set-startup-message.cjs --clear        # blank it
//
// It deliberately opens the database *locally*, next to the running app. Never
// point it at a network share: SQLite locking over SMB/NFS is unreliable and the
// app holds the file open in WAL mode.

import path from "node:path";
import Database from "better-sqlite3";
import { SqliteSettingsRepository } from "../src/lib/settings/repository";
import {
  clearStartupMessage,
  formatDeploymentMessage,
  setStartupMessage,
} from "../src/lib/settings/settings";

const dbPath = process.env.MYHOMEBASE_DB ?? path.join(process.cwd(), "data", "myhomebase.db");

// Everything, including opening the database, is inside the try: a deploy must not
// be reported as failed because the banner couldn't be set. The new build is
// already live and serving, so this warns loudly and still exits 0.
let db: Database.Database | undefined;
try {
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  const repo = new SqliteSettingsRepository(db);
  const [first] = process.argv.slice(2);

  if (first === "--clear") {
    clearStartupMessage(repo);
    console.log(`Startup message cleared in ${dbPath}`);
  } else {
    const message = first ?? formatDeploymentMessage(new Date());
    setStartupMessage(repo, message);
    console.log(`Startup message set in ${dbPath}: ${message}`);
  }
} catch (error) {
  console.warn(
    `WARNING: could not set the startup message (${error instanceof Error ? error.message : error}).`,
  );
  console.warn(`  database: ${dbPath}`);
  console.warn("  The deployment itself is unaffected.");
} finally {
  db?.close();
}
