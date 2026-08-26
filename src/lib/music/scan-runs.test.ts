import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteMusicRepository } from "./repository";

// Only 0052 -- it creates mus_scan_runs, which is all these tests touch.
function memoryMusicRepo(): { repo: SqliteMusicRepository; db: Database.Database } {
  const db = new Database(":memory:");
  db.exec(readFileSync(path.join(process.cwd(), "migrations", "0052_create_music_library.sql"), "utf8"));
  return { repo: new SqliteMusicRepository(db), db };
}

/** A run row with `updated_at` set `secondsAgo` in the past. */
function insertRunning(db: Database.Database, secondsAgo: number, lastError = ""): number {
  const result = db
    .prepare(
      `INSERT INTO mus_scan_runs (root_folder, status, files_total, files_seen, last_error, current_path, started_at, updated_at)
       VALUES ('INSTRUMENTAL', 'running', 690, 25, ?, 'INSTRUMENTAL/Yanni/Chasing Shadows.mp3',
               datetime('now', ?), datetime('now', ?))`,
    )
    .run(lastError, `-${secondsAgo} seconds`, `-${secondsAgo} seconds`);
  return Number(result.lastInsertRowid);
}

describe("failAbandonedScanRuns", () => {
  it("closes a running row whose writer has gone silent", () => {
    const { repo, db } = memoryMusicRepo();
    const id = insertRunning(db, 600);

    expect(repo.failAbandonedScanRuns()).toBe(1);

    const run = repo.getScanRun(id);
    expect(run?.status).toBe("failed");
    expect(run?.finishedAt).toBeDefined();
    // The frozen numbers survive -- the row is the record of how far it got.
    expect(run?.filesSeen).toBe(25);
    expect(run?.lastError).toContain("stopped reporting");
    // Cleared so the UI stops implying it is mid-file.
    expect(run?.currentPath).toBe("");
    // And it no longer masquerades as the active scan.
    expect(repo.getActiveScanRun()).toBeUndefined();
  });

  it("leaves a scan that reported recently alone", () => {
    const { repo, db } = memoryMusicRepo();
    const id = insertRunning(db, 5);

    expect(repo.failAbandonedScanRuns()).toBe(0);
    expect(repo.getScanRun(id)?.status).toBe("running");
    expect(repo.getActiveScanRun()?.id).toBe(id);
  });

  it("keeps a real error rather than overwriting it with the generic one", () => {
    const { repo, db } = memoryMusicRepo();
    const id = insertRunning(db, 600, "The music folder is not reachable.");

    repo.failAbandonedScanRuns();

    expect(repo.getScanRun(id)?.lastError).toBe("The music folder is not reachable.");
  });

  it("does not touch rows that already finished", () => {
    const { repo, db } = memoryMusicRepo();
    const id = insertRunning(db, 600);
    repo.finishScanRun(id, "completed");

    expect(repo.failAbandonedScanRuns()).toBe(0);
    expect(repo.getScanRun(id)?.status).toBe("completed");
  });

  it("honours a caller-supplied staleness window", () => {
    const { repo, db } = memoryMusicRepo();
    insertRunning(db, 60);

    // Silent for 60s: not stale at the 120s default, stale at a 30s window.
    expect(repo.failAbandonedScanRuns()).toBe(0);
    expect(repo.failAbandonedScanRuns(30)).toBe(1);
  });
});
