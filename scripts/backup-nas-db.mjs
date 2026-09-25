// Backs up the NAS production database over SMB — step 2 of the release.
//
// Exists because PowerShell is not always available to the release session, and
// step 2 is not a step worth skipping. `scripts/manual-release.ps1` still does
// this as part of the no-Claude release; this is the same operation as a plain
// Node script, so a release can take a backup with neither PowerShell nor a
// full manual-release run. Keep the two in step.
//
// It is NOT the same as the backup `scripts/migrate.ts` takes before a
// migration. That one copies the `.db` alone, which is the gap this closes:
// the app runs in WAL mode, so committed rows can still be sitting in
// `myhomebase.db-wal` and not yet in the `.db` file — a real release saw a
// 4.5 MB WAL. It also only runs when a release HAS a migration; a release
// without one gets no backup from that path at all.
//
// Usage:
//   npm run backup:nas
//   npm run backup:nas -- --dry-run
//   npm run backup:nas -- --data "\\\\NAS_DS223\\app\\myhomebase\\data"

import { copyFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

/** The live data folder on the NAS. Overridable with `--data` for a drill. */
const DEFAULT_DATA_DIR = "\\\\NAS_DS223\\app\\myhomebase\\data";

/**
 * The three files, in the order they are copied.
 *
 * The bare `.db` first and fatal: without it there is no backup. The `-wal` and
 * `-shm` sidecars are best-effort — they are legitimately absent once the app
 * has checkpointed and shut down cleanly, so a missing one is not an error.
 */
const SUFFIXES = ["", "-wal", "-shm"];

function parseArgs(argv) {
  const args = { dryRun: false, dataDir: DEFAULT_DATA_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--data") {
      args.dataDir = argv[i + 1] ?? args.dataDir;
      i += 1;
    }
  }
  return args;
}

/**
 * The stamp that names every file in one run.
 *
 * Local time to seconds, matching what `manual-release.ps1` writes with
 * `Get-Date -Format "yyyy-MM-ddTHH-mm-ss"` — deliberately NOT `toISOString()`,
 * which is UTC with milliseconds and a `Z`. Both formats are already present in
 * the data folder (migrate.ts writes the ISO one), and matching the PowerShell
 * script keeps a release's own backups sorting together and legible as local
 * time, which is how anyone reading that folder thinks about them.
 */
function localStamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `T${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`
  );
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function main() {
  const { dryRun, dataDir } = parseArgs(process.argv.slice(2));
  const stamp = localStamp();

  console.log(`-- NAS production database`);
  console.log(`   ${dataDir}`);
  if (dryRun) console.log("   [dry-run] nothing will be written");

  if (!existsSync(dataDir)) {
    console.error("   UNREACHABLE. Is the NAS on / the share mounted / the app installed?");
    process.exitCode = 1;
    return;
  }

  const primary = path.join(dataDir, "myhomebase.db");
  if (!existsSync(primary)) {
    console.error("   No myhomebase.db in that folder.");
    process.exitCode = 1;
    return;
  }

  const copied = [];
  for (const suffix of SUFFIXES) {
    const name = `myhomebase.db${suffix}`;
    const src = path.join(dataDir, name);
    const dst = path.join(dataDir, `${name}.bak-${stamp}`);
    if (!existsSync(src)) continue;

    if (dryRun) {
      console.log(`   [dry-run] copy ${name} -> ${name}.bak-${stamp}`);
      copied.push(name);
      continue;
    }

    try {
      copyFileSync(src, dst);
      console.log(`   copied  ${name}.bak-${stamp}  (${formatMb(statSync(dst).size)})`);
      copied.push(name);
    } catch (error) {
      // Same rule as manual-release.ps1: losing the database is fatal, losing a
      // sidecar is a warning. A -wal that vanished mid-copy means the app just
      // checkpointed, which is the good case, not a failed backup.
      if (suffix === "") {
        console.error(`   FAILED to copy the database: ${error.message}`);
        process.exitCode = 1;
        return;
      }
      console.warn(`   (skipped ${name} - ${error.message})`);
    }
  }

  if (!copied.includes("myhomebase.db")) {
    console.error("   Nothing was copied.");
    process.exitCode = 1;
    return;
  }

  console.log(`   OK: ${copied.join(", ")}`);
  if (!copied.includes("myhomebase.db-wal")) {
    console.log("   (no -wal present — the app had checkpointed, so the .db is complete)");
  }
}

main();
