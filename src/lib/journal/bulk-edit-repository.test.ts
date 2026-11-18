// Repository-level tests for bulk edit's "ignore locked", against a real
// in-memory SQLite built from the journal's own migrations.
//
// The fake in bulk-edit.test.ts can only show the flag reaching the repository.
// Whether the row really ends up written *and still locked* — and whether a
// failed write leaves it locked — is the SQL's job, so it is tested here.
import path from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteJournalRepository } from "./repository";

const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

// Every migration that mentions a journal table, in numeric order. Picked by
// content rather than listed by hand: the journal's tables are reshaped by a
// dozen migrations spread across the history (0140/0141 even move the location
// library out and back), and a hand list drifts silently the next time one is
// added.
const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"))
  .filter((sql) => sql.includes("jrn_"));

let db: Database.Database;
let repo: SqliteJournalRepository;

function insertEntry(isLocked: boolean): number {
  const info = db
    .prepare(
      "INSERT INTO jrn_entries (entry_date, title, content, place_name, is_locked) VALUES (?, ?, ?, ?, ?)",
    )
    .run("2026-11-17", "t", "c", "Old place", isLocked ? 1 : 0);
  return Number(info.lastInsertRowid);
}

function readEntry(id: number): { place_name: string; is_locked: number } {
  return db.prepare("SELECT place_name, is_locked FROM jrn_entries WHERE id = ?").get(id) as {
    place_name: string;
    is_locked: number;
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  for (const sql of MIGRATIONS) db.exec(sql);
  repo = new SqliteJournalRepository(db);
});

describe("SqliteJournalRepository.bulkEditEntries — ignore locked", () => {
  it("skips a locked entry by default and leaves it untouched", () => {
    const open = insertEntry(false);
    const locked = insertEntry(true);

    const outcome = repo.bulkEditEntries([open, locked], { placeName: "Lisbon" });

    expect(outcome.updatedIds).toEqual([open]);
    expect(outcome.skippedLockedIds).toEqual([locked]);
    expect(outcome.relockedIds).toEqual([]);
    expect(readEntry(locked)).toEqual({ place_name: "Old place", is_locked: 1 });
  });

  it("writes a locked entry and leaves it locked again", () => {
    const open = insertEntry(false);
    const locked = insertEntry(true);

    const outcome = repo.bulkEditEntries(
      [open, locked],
      { placeName: "Lisbon", tags: { mode: "replace", names: ["Trip"] } },
      { ignoreLocked: true },
    );

    expect(outcome.updatedIds).toEqual([open, locked]);
    expect(outcome.skippedLockedIds).toEqual([]);
    expect(outcome.relockedIds).toEqual([locked]);
    expect(readEntry(locked)).toEqual({ place_name: "Lisbon", is_locked: 1 });
    // An unlocked entry is not locked by the pass.
    expect(readEntry(open)).toEqual({ place_name: "Lisbon", is_locked: 0 });
    expect(
      db.prepare("SELECT tag_name FROM jrn_entry_tags WHERE entry_id = ?").all(locked),
    ).toEqual([{ tag_name: "Trip" }]);
  });

  it("rolls the unlock back with the write when the write fails", () => {
    const locked = insertEntry(true);
    // Make the tag insert fail after the unlock has run.
    db.exec(`CREATE TRIGGER fail_tag BEFORE INSERT ON jrn_entry_tags
             BEGIN SELECT RAISE(ABORT, 'boom'); END;`);

    expect(() =>
      repo.bulkEditEntries(
        [locked],
        { placeName: "Lisbon", tags: { mode: "replace", names: ["Trip"] } },
        { ignoreLocked: true },
      ),
    ).toThrow(/boom/);
    expect(readEntry(locked)).toEqual({ place_name: "Old place", is_locked: 1 });
  });
});
