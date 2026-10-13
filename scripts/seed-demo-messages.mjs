// Files one demo message per module into the message queue.
//
// WRITTEN FOR A DELIBERATE, ONE-OFF DEMO SEED. Min asked for this against the
// NAS specifically, to populate Administration -> Message Queue before looking
// at the new Module and Locked columns. It is not part of a release, nothing
// calls it on a timer, and it is not a fixture any test depends on.
//
// THIS WRITES TO THE LIVE DATABASE. CLAUDE.md's standing rule is that nothing
// touches the real DB; this script exists because that rule was explicitly
// waived for this task, and it is built so the waiver stays narrow:
//
//   - It refuses to run without `--yes`, so it cannot fire by accident.
//   - `--dry-run` prints exactly what it would insert and writes nothing.
//   - Every row it writes carries `source: 'Seed data'`, so the rows it made
//     are identifiable and removable later. Real messages are never tagged that
//     way, and `--undo` deletes precisely that set and nothing else.
//   - It INSERTs through plain SQL rather than through `createMessage`, because
//     the use-case is TypeScript behind a path alias and this has to be a plain
//     `.mjs` runnable with bare node, like `backup-nas-db.mjs` beside it. The
//     module slugs below are therefore checked against MESSAGE_MODULES by hand
//     -- keep them in step with src/lib/messages/schema.ts.
//
// Usage:
//   node scripts/seed-demo-messages.mjs --dry-run
//   node scripts/seed-demo-messages.mjs --yes
//   node scripts/seed-demo-messages.mjs --yes --undo
//   node scripts/seed-demo-messages.mjs --yes --data "\\\\NAS_DS223\\app\\myhomebase\\data"

import { existsSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/** The live data folder on the NAS. Same default as `backup-nas-db.mjs`. */
const DEFAULT_DATA_DIR = "\\\\NAS_DS223\\app\\myhomebase\\data";
const DB_NAME = "myhomebase.db";

/**
 * The tag every seeded row carries in `source`.
 *
 * This is the whole safety story for cleanup. `--undo` deletes by this exact
 * string, so a real message -- whose source is 'Investments monitor', 'CLI' or
 * a job's own name -- can never be caught by it.
 */
const SEED_SOURCE = "Seed data";

/**
 * One message per module, plus one for `system`.
 *
 * Slugs must exist in MESSAGE_MODULES (src/lib/messages/schema.ts). They are
 * spelled out rather than imported because this is a plain .mjs script; if a
 * module is added there and not here, this seeds nothing for it, which is
 * harmless. The reverse -- a slug here that the enum does not list -- would
 * write a row the app reads as 'system'. Both are checked below before any
 * insert, against the list as it stood at migration 0142.
 */
const KNOWN_MODULES = [
  "investments",
  "journal",
  "csv-analysis",
  "expense",
  "attendance",
  "music-library",
  "games",
  "picture-gallery",
  "tools",
  "household",
  "system",
];

/**
 * `locked` marks a few rows so the Locked column and the purge immunity have
 * something to show without anyone having to click Lock first.
 */
const SEED_MESSAGES = [
  {
    module: "investments",
    title: "NVDA crossed your target",
    body: "Unrealized gain on the position reached $9,840. The monitor disarmed itself after firing.",
    locked: true,
  },
  {
    module: "investments",
    title: "AAPL added to the watch list",
    body: "Watching for a close below $180.",
    locked: false,
  },
  {
    module: "journal",
    title: "14 entries written this month",
    body: "Your longest streak so far is 9 days, ending 8 October.",
    locked: false,
  },
  {
    module: "csv-analysis",
    title: "Import finished with 3 skipped rows",
    body: "quarterly-costs.csv: 1,204 rows imported, 3 skipped for an unparseable date.",
    locked: false,
  },
  {
    module: "expense",
    title: "Groceries is 18% over its monthly average",
    body: "$642 so far against a twelve-month average of $544.",
    locked: false,
  },
  {
    module: "attendance",
    title: "Roster unmarked for Thursday",
    body: "No attendance was taken for the 9 October session.",
    locked: false,
  },
  {
    module: "music-library",
    title: "Library scan found 37 new tracks",
    body: "All 37 were tagged. 2 files had no embedded artwork.",
    locked: false,
  },
  {
    module: "games",
    title: "New high score on Pac-Man",
    body: "18,420 points, beating the previous board leader by 2,300.",
    locked: false,
  },
  {
    module: "picture-gallery",
    title: "Archive index rebuilt",
    body: "11,882 photos indexed. The archive itself was not modified -- it is mounted read-only.",
    locked: true,
  },
  {
    module: "tools",
    title: "Exchange rates refreshed",
    body: "USD, EUR and GBP updated from the daily feed.",
    locked: false,
  },
  {
    module: "household",
    title: "HSA receipt needs a category",
    body: "One receipt uploaded on 5 October is still uncategorised.",
    locked: false,
  },
  {
    module: "system",
    title: "Nightly backup completed",
    body: "Database and WAL copied. 4.6 MB written.",
    locked: false,
  },
];

function parseArgs(argv) {
  const args = { dryRun: false, yes: false, undo: false, dataDir: DEFAULT_DATA_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--yes") args.yes = true;
    else if (argv[i] === "--undo") args.undo = true;
    else if (argv[i] === "--data") {
      args.dataDir = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.dataDir) fail("--data was given with no path.");

  // A write to the live database must be asked for twice: once by running this
  // at all, once by saying so. A dry run is exempt -- it writes nothing.
  if (!args.yes && !args.dryRun) {
    fail(
      "Refusing to write without --yes.\n" +
        "  This writes to the LIVE database. Try --dry-run first to see what it would do.",
    );
  }

  const dbPath = path.join(args.dataDir, DB_NAME);
  if (!existsSync(dbPath)) {
    fail(`No database at ${dbPath}\n  Check the share is mounted and --data is right.`);
  }

  // Checked before opening anything: a bad slug here would write rows the app
  // silently reads as 'system', which is the kind of quiet wrongness that is
  // hard to spot on a screen and annoying to undo.
  const unknown = SEED_MESSAGES.filter((m) => !KNOWN_MODULES.includes(m.module));
  if (unknown.length > 0) {
    fail(`Unknown module slug(s): ${unknown.map((m) => m.module).join(", ")}`);
  }

  console.log(`\n  Database: ${dbPath}`);
  console.log(`  Tag:      source = '${SEED_SOURCE}'\n`);

  const db = new Database(dbPath);

  try {
    // The app runs in WAL mode. Opening read-write here is fine, but the rows
    // must be committed rather than left for a checkpoint that may not come
    // before the next backup -- better-sqlite3's transactions are synchronous
    // and commit on return, so this is handled by using one below.
    const columns = db.prepare("PRAGMA table_info(sys_messages)").all();
    const names = columns.map((c) => c.name);
    if (names.length === 0) fail("sys_messages does not exist in this database.");

    // The reason this check is worth its lines: migration 0142 adds these two
    // columns, and seeding before it has run would either throw here or (worse,
    // if this script were sloppier) write rows the new code cannot read.
    const missing = ["module", "is_locked"].filter((c) => !names.includes(c));
    if (missing.length > 0) {
      fail(
        `sys_messages is missing: ${missing.join(", ")}\n` +
          "  Migration 0142 has not been applied to this database yet. Run it first.",
      );
    }

    if (args.undo) {
      const countRow = db
        .prepare("SELECT COUNT(*) AS n FROM sys_messages WHERE source = ?")
        .get(SEED_SOURCE);

      if (args.dryRun) {
        console.log(`  DRY RUN -- would delete ${countRow.n} row(s) tagged '${SEED_SOURCE}'.\n`);
        return;
      }

      // Deletes the seeded rows even if they were locked: the lock protects the
      // app's own delete paths, and this is the script that made them. It is
      // still scoped by the tag, so nothing else can be caught.
      const result = db.prepare("DELETE FROM sys_messages WHERE source = ?").run(SEED_SOURCE);
      console.log(`  Deleted ${result.changes} seeded message(s).\n`);
      return;
    }

    if (args.dryRun) {
      console.log(`  DRY RUN -- would insert ${SEED_MESSAGES.length} message(s):\n`);
      for (const m of SEED_MESSAGES) {
        console.log(`    [${m.module}]${m.locked ? " (locked)" : ""} ${m.title}`);
      }
      console.log("\n  Nothing was written.\n");
      return;
    }

    const insert = db.prepare(
      `INSERT INTO sys_messages (title, body, source, module, is_locked)
       VALUES (?, ?, ?, ?, ?)`,
    );

    // One transaction: either the whole demo set lands or none of it does, so a
    // failure halfway does not leave a half-populated screen to puzzle over.
    const insertAll = db.transaction((rows) => {
      for (const m of rows) {
        insert.run(m.title, m.body, SEED_SOURCE, m.module, m.locked ? 1 : 0);
      }
    });

    insertAll(SEED_MESSAGES);

    const locked = SEED_MESSAGES.filter((m) => m.locked).length;
    console.log(`  Inserted ${SEED_MESSAGES.length} message(s), ${locked} of them locked.`);
    console.log(`  Remove them again with:  --yes --undo\n`);
  } finally {
    db.close();
  }
}

main();
