// Records a deployment in a *deployed* database, with the build log that shipped with it.
//
// This is the deploy-side entry point, bundled to plain CJS for the NAS the same way
// scripts/migrate.ts and scripts/set-startup-message.ts are — the NAS has no tsx and no
// path-alias resolution, so this file imports by relative path rather than via `@/`.
//
// Usage (from a deployment folder, where ./data/myhomebase.db lives):
//   node record-deployment.cjs              # a deployment that applied no migrations
//   node record-deployment.cjs --migrated   # one that did
//
// It deliberately opens the database *locally*, next to the running app. Never point it at
// a network share: SQLite locking over SMB/NFS is unreliable and the app holds the file
// open in WAL mode. This is the same constraint that keeps set-startup-message.cjs and
// migrate.cjs on this side of the wire rather than in REBUILD_PUBLISH_NAS.bat, and it is
// the whole reason the build log travels as a file — see
// migrations/0078_create_deployments.md.
//
// `start.sh` runs this only on a triggered deploy, never on a crash-restart.

import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SqliteDeploymentRepository } from "../src/lib/deployments/repository";
import { parseBuildLog, recordDeployment } from "../src/lib/deployments/deployments";

/** The file `scripts/publish-nas.mjs` leaves in the package. */
export const BUILD_LOG_FILENAME = "build-log.json";

const dbPath = process.env.MYHOMEBASE_DB ?? path.join(process.cwd(), "data", "myhomebase.db");
const buildLogPath = path.join(process.cwd(), BUILD_LOG_FILENAME);
const migrated = process.argv.slice(2).includes("--migrated");

// Everything, including opening the database, is inside the try: a deploy must not be
// reported as failed because its bookkeeping row could not be written. The new build is
// already coming up and about to serve, so this warns loudly and still exits 0 — exactly
// the contract set-startup-message.cjs has, and for the same reason.
let db: Database.Database | undefined;
try {
  // A missing build log is normal, not an error: a package built before this feature, or
  // a folder copied across by hand. `parseBuildLog(null)` yields null and the row is still
  // written with its timestamp.
  let buildLogText: string | null = null;
  try {
    buildLogText = readFileSync(buildLogPath, "utf8");
  } catch {
    console.warn(`No ${BUILD_LOG_FILENAME} beside the app — recording the deployment without it.`);
  }

  const buildLog = parseBuildLog(buildLogText);
  if (buildLogText !== null && buildLog === null) {
    // Distinguished from "absent" on purpose: an unreadable log means the build wrote
    // something this version cannot parse, which is worth seeing in app.log.
    console.warn(`${buildLogPath} could not be read as a build log — recording without it.`);
  }

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  const repo = new SqliteDeploymentRepository(db);
  // Stamped here rather than in the build log: this is when the build actually went live,
  // which is the timestamp the About screen orders and reads by.
  const id = recordDeployment(repo, { buildLog, migrated, deployedAt: new Date() });

  const describedBuild = buildLog?.buildId ?? "unknown build";
  console.log(
    `Recorded deployment #${id} (${describedBuild}) in ${dbPath}` +
      `${migrated ? " — migrations applied" : ""}`,
  );
} catch (error) {
  console.warn(
    `WARNING: could not record the deployment (${error instanceof Error ? error.message : error}).`,
  );
  console.warn(`  database: ${dbPath}`);
  console.warn("  The deployment itself is unaffected.");
} finally {
  db?.close();
}
