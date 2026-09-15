import type Database from "better-sqlite3";
import type {
  MagicScanRunRepository,
  PhotoIndexRepository,
  PhotoMagicListRepository,
} from "./ports";
import type {
  IndexedPhoto,
  MagicScanRun,
  PhotoFileFacts,
  PhotoMagicCriteria,
  PhotoMagicList,
  PhotoMagicListSummary,
  ScanRunProgress,
} from "./types";

// The only file in this module that knows SQL. Tables are `pho_magic_list`,
// `pho_magic_list_photos`, `pho_photo_index` and `pho_magic_scan_run` -- the `pho_`
// prefix is Picture Gallery's. See migrations/0093_create_photo_magic_lists.md.
//
// NOT exported from index.ts, for the reason music-magic's barrel spells out: that
// barrel is imported by client components for types and presets, and this file pulls in
// better-sqlite3. Re-exporting it would put a native addon in the browser bundle's
// module graph, which Turbopack fails the build on. `wiring.ts` imports it by path.

// ---------------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------------

interface MagicListRow {
  id: number;
  name: string;
  description: string;
  from_date: string | null;
  to_date: string | null;
  min_bytes: number | null;
  max_bytes: number | null;
  min_width: number | null;
  min_height: number | null;
  max_width: number | null;
  max_height: number | null;
  max_photos: number;
  last_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MagicListSummaryRow extends MagicListRow {
  photo_count: number;
}

interface IndexedPhotoRow {
  relative_path: string;
  bytes: number;
  width: number | null;
  height: number | null;
  taken_at_date: string | null;
  taken_at_source: string;
}

interface ScanRunRow {
  id: number;
  from_date: string;
  to_date: string;
  status: string;
  files_total: number;
  files_seen: number;
  files_indexed: number;
  files_cached: number;
  files_failed: number;
  current_path: string;
  last_error: string;
  started_at: string;
  finished_at: string | null;
  updated_at: string;
}

/** NULL is "no restriction on this end" throughout -- see migrations/0093. */
function criteriaOf(row: MagicListRow): PhotoMagicCriteria {
  return {
    fromDate: row.from_date ?? undefined,
    toDate: row.to_date ?? undefined,
    minBytes: row.min_bytes ?? undefined,
    maxBytes: row.max_bytes ?? undefined,
    minWidth: row.min_width ?? undefined,
    minHeight: row.min_height ?? undefined,
    maxWidth: row.max_width ?? undefined,
    maxHeight: row.max_height ?? undefined,
    maxPhotos: row.max_photos,
  };
}

function toList(row: MagicListRow): PhotoMagicList {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    criteria: criteriaOf(row),
    lastGeneratedAt: row.last_generated_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toIndexedPhoto(row: IndexedPhotoRow): IndexedPhoto {
  return {
    relativePath: row.relative_path,
    bytes: row.bytes,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    takenAtDate: row.taken_at_date ?? undefined,
    takenAtSource: row.taken_at_source as IndexedPhoto["takenAtSource"],
  };
}

function toScanRun(row: ScanRunRow): MagicScanRun {
  return {
    id: row.id,
    fromDate: row.from_date,
    toDate: row.to_date,
    status: row.status as MagicScanRun["status"],
    filesTotal: row.files_total,
    filesSeen: row.files_seen,
    filesIndexed: row.files_indexed,
    filesCached: row.files_cached,
    filesFailed: row.files_failed,
    currentPath: row.current_path,
    lastError: row.last_error,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

/**
 * The WHERE clause for one criteria set, and its bound parameters.
 *
 * Built rather than written out because every bound is optional, and a fixed clause
 * with `(? IS NULL OR bytes >= ?)` for each one would defeat the partial index -- the
 * planner cannot use an index for a predicate whose applicability is itself a
 * parameter. Only the clauses that apply are emitted.
 *
 * THE ABSENT-BOUND RULE lives in `matchesCriteria`; this is its SQL twin and the two
 * must agree. `criteria.test.ts` is what holds them together: the generator's tests run
 * the same criteria through both.
 */
function candidateWhere(criteria: PhotoMagicCriteria): {
  sql: string;
  params: (string | number)[];
} {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (criteria.fromDate !== undefined || criteria.toDate !== undefined) {
    // A photograph with no date cannot satisfy a range -- excluded, matching
    // `matchesCriteria`, not admitted as a maybe.
    clauses.push("taken_at_date IS NOT NULL");
    if (criteria.fromDate !== undefined) {
      // String comparison: `YYYY-MM-DD` sorts chronologically, so this is exact and
      // has no timezone to shift an evening photo onto the next day.
      clauses.push("taken_at_date >= ?");
      params.push(criteria.fromDate);
    }
    if (criteria.toDate !== undefined) {
      clauses.push("taken_at_date <= ?");
      params.push(criteria.toDate);
    }
  }

  if (criteria.minBytes !== undefined) {
    clauses.push("bytes >= ?");
    params.push(criteria.minBytes);
  }
  if (criteria.maxBytes !== undefined) {
    clauses.push("bytes <= ?");
    params.push(criteria.maxBytes);
  }

  const boundsResolution =
    criteria.minWidth !== undefined ||
    criteria.minHeight !== undefined ||
    criteria.maxWidth !== undefined ||
    criteria.maxHeight !== undefined;

  if (boundsResolution) {
    // Unknown dimensions are excluded by ANY resolution bound. Stated once here rather
    // than relying on each comparison to reject NULL, so the rule is visible.
    clauses.push("width IS NOT NULL AND height IS NOT NULL");
    if (criteria.minWidth !== undefined) {
      clauses.push("width >= ?");
      params.push(criteria.minWidth);
    }
    if (criteria.minHeight !== undefined) {
      clauses.push("height >= ?");
      params.push(criteria.minHeight);
    }
    if (criteria.maxWidth !== undefined) {
      clauses.push("width <= ?");
      params.push(criteria.maxWidth);
    }
    if (criteria.maxHeight !== undefined) {
      clauses.push("height <= ?");
      params.push(criteria.maxHeight);
    }
  }

  return {
    sql: clauses.length === 0 ? "1 = 1" : clauses.join(" AND "),
    params,
  };
}

// ---------------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------------

export class SqlitePhotoIndexRepository implements PhotoIndexRepository {
  constructor(private db: Database.Database) {}

  listCandidates(criteria: PhotoMagicCriteria): IndexedPhoto[] {
    const { sql, params } = candidateWhere(criteria);
    // No LIMIT: the draw must see every candidate, or the "random" list would be
    // random only within whatever window SQL returned. See `PhotoIndexRepository`.
    const rows = this.db
      .prepare(
        `SELECT relative_path, bytes, width, height, taken_at_date, taken_at_source
           FROM pho_photo_index
          WHERE ${sql}`,
      )
      .all(...params) as IndexedPhotoRow[];
    return rows.map(toIndexedPhoto);
  }

  countCandidates(criteria: PhotoMagicCriteria): number {
    const { sql, params } = candidateWhere(criteria);
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM pho_photo_index WHERE ${sql}`)
      .get(...params) as { n: number };
    return row.n;
  }

  countUnknownSizeInRange(criteria: PhotoMagicCriteria): number {
    // The date range ONLY, plus the unknown-dimension test. Applying the resolution
    // bounds too would answer zero by construction -- the question is precisely "how
    // many in-range photographs did the resolution filter throw away".
    const clauses: string[] = ["(width IS NULL OR height IS NULL)"];
    const params: (string | number)[] = [];

    if (criteria.fromDate !== undefined || criteria.toDate !== undefined) {
      clauses.push("taken_at_date IS NOT NULL");
      if (criteria.fromDate !== undefined) {
        clauses.push("taken_at_date >= ?");
        params.push(criteria.fromDate);
      }
      if (criteria.toDate !== undefined) {
        clauses.push("taken_at_date <= ?");
        params.push(criteria.toDate);
      }
    }

    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM pho_photo_index WHERE ${clauses.join(" AND ")}`)
      .get(...params) as { n: number };
    return row.n;
  }

  getFileFacts(relativePath: string): PhotoFileFacts | undefined {
    // Three columns, deliberately -- this runs once per file in a scan and the whole
    // point is to be cheaper than opening the photograph.
    const row = this.db
      .prepare(
        `SELECT relative_path, bytes, file_mtime FROM pho_photo_index WHERE relative_path = ?`,
      )
      .get(relativePath) as
      | { relative_path: string; bytes: number; file_mtime: string }
      | undefined;
    if (row === undefined) return undefined;
    return { relativePath: row.relative_path, bytes: row.bytes, mtime: row.file_mtime };
  }

  upsertPhoto(photo: IndexedPhoto & { mtime: string }): void {
    // ON CONFLICT rather than DELETE-then-INSERT: the path is the identity and a
    // re-scan overwrites in place, which keeps the row's id stable and does half the
    // writes.
    this.db
      .prepare(
        `INSERT INTO pho_photo_index
           (relative_path, bytes, width, height, taken_at_date, taken_at_source, file_mtime, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT (relative_path) DO UPDATE SET
           bytes = excluded.bytes,
           width = excluded.width,
           height = excluded.height,
           taken_at_date = excluded.taken_at_date,
           taken_at_source = excluded.taken_at_source,
           file_mtime = excluded.file_mtime,
           indexed_at = excluded.indexed_at`,
      )
      .run(
        photo.relativePath,
        photo.bytes,
        photo.width ?? null,
        photo.height ?? null,
        photo.takenAtDate ?? null,
        photo.takenAtSource,
        photo.mtime,
      );
  }

  countIndexed(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM pho_photo_index`).get() as {
      n: number;
    };
    return row.n;
  }

  clearIndex(): void {
    this.db.prepare(`DELETE FROM pho_photo_index`).run();
  }
}

// ---------------------------------------------------------------------------------
// Saved lists
// ---------------------------------------------------------------------------------

export class SqlitePhotoMagicListRepository implements PhotoMagicListRepository {
  constructor(private db: Database.Database) {}

  createList(list: {
    name: string;
    description: string;
    criteria: PhotoMagicCriteria;
  }): number {
    const c = list.criteria;
    const result = this.db
      .prepare(
        `INSERT INTO pho_magic_list
           (name, description, from_date, to_date, min_bytes, max_bytes,
            min_width, min_height, max_width, max_height, max_photos)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        list.name,
        list.description,
        c.fromDate ?? null,
        c.toDate ?? null,
        c.minBytes ?? null,
        c.maxBytes ?? null,
        c.minWidth ?? null,
        c.minHeight ?? null,
        c.maxWidth ?? null,
        c.maxHeight ?? null,
        c.maxPhotos,
      );
    return Number(result.lastInsertRowid);
  }

  updateList(
    id: number,
    list: { name: string; description: string; criteria: PhotoMagicCriteria },
  ): void {
    const c = list.criteria;
    // `updated_at` is left to the trigger rather than set here, unlike the scan-run
    // table which has none.
    this.db
      .prepare(
        `UPDATE pho_magic_list
            SET name = ?, description = ?, from_date = ?, to_date = ?,
                min_bytes = ?, max_bytes = ?, min_width = ?, min_height = ?,
                max_width = ?, max_height = ?, max_photos = ?
          WHERE id = ?`,
      )
      .run(
        list.name,
        list.description,
        c.fromDate ?? null,
        c.toDate ?? null,
        c.minBytes ?? null,
        c.maxBytes ?? null,
        c.minWidth ?? null,
        c.minHeight ?? null,
        c.maxWidth ?? null,
        c.maxHeight ?? null,
        c.maxPhotos,
        id,
      );
  }

  deleteList(id: number): void {
    // No ON DELETE CASCADE -- the project's convention is no DB-level foreign keys, so
    // the repository maintains the link. Both statements in one transaction, or a
    // failure between them would orphan the photo rows.
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM pho_magic_list_photos WHERE magic_list_id = ?`).run(id);
      this.db.prepare(`DELETE FROM pho_magic_list WHERE id = ?`).run(id);
    })();
  }

  getList(id: number): PhotoMagicList | undefined {
    const row = this.db.prepare(`SELECT * FROM pho_magic_list WHERE id = ?`).get(id) as
      | MagicListRow
      | undefined;
    return row === undefined ? undefined : toList(row);
  }

  listLists(): PhotoMagicListSummary[] {
    // The count comes from SQL rather than from loading every set: the picker shows
    // every list at once.
    const rows = this.db
      .prepare(
        `SELECT l.*,
                (SELECT COUNT(*) FROM pho_magic_list_photos p WHERE p.magic_list_id = l.id)
                  AS photo_count
           FROM pho_magic_list l
          ORDER BY l.updated_at DESC, l.id DESC`,
      )
      .all() as MagicListSummaryRow[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      maxPhotos: row.max_photos,
      photoCount: row.photo_count,
      lastGeneratedAt: row.last_generated_at ?? undefined,
      updatedAt: row.updated_at,
    }));
  }

  saveGeneratedPhotos(id: number, relativePaths: readonly string[]): void {
    // Wholesale replacement in ONE transaction: a re-roll has no relationship to the
    // previous draw, so there is no diff worth computing, and a half-written set would
    // be a list nobody asked for.
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM pho_magic_list_photos WHERE magic_list_id = ?`).run(id);
      const insert = this.db.prepare(
        `INSERT INTO pho_magic_list_photos (magic_list_id, relative_path, position)
         VALUES (?, ?, ?)`,
      );
      relativePaths.forEach((path, position) => insert.run(id, path, position));
      this.db
        .prepare(`UPDATE pho_magic_list SET last_generated_at = datetime('now') WHERE id = ?`)
        .run(id);
    })();
  }

  listGeneratedPhotos(id: number): IndexedPhoto[] {
    // A LEFT JOIN, not an inner one. The saved set is what the reader kept; its facts
    // are a cache that may have been cleared. Joining strictly would make "clear the
    // index" silently empty every saved list -- which is exactly why this table stores
    // a path rather than an index row id.
    const rows = this.db
      .prepare(
        `SELECT p.relative_path,
                COALESCE(i.bytes, 0)                AS bytes,
                i.width                             AS width,
                i.height                            AS height,
                i.taken_at_date                     AS taken_at_date,
                COALESCE(i.taken_at_source, 'none') AS taken_at_source
           FROM pho_magic_list_photos p
           LEFT JOIN pho_photo_index i ON i.relative_path = p.relative_path
          WHERE p.magic_list_id = ?
          ORDER BY p.position, p.id`,
      )
      .all(id) as IndexedPhotoRow[];
    return rows.map(toIndexedPhoto);
  }
}

// ---------------------------------------------------------------------------------
// Scan runs
// ---------------------------------------------------------------------------------

export class SqliteMagicScanRunRepository implements MagicScanRunRepository {
  constructor(private db: Database.Database) {}

  createRun(range: { fromDate: string; toDate: string }): number {
    const result = this.db
      .prepare(`INSERT INTO pho_magic_scan_run (from_date, to_date) VALUES (?, ?)`)
      .run(range.fromDate, range.toDate);
    return Number(result.lastInsertRowid);
  }

  setRunTotal(id: number, filesTotal: number): void {
    this.db
      .prepare(
        `UPDATE pho_magic_scan_run SET files_total = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(filesTotal, id);
  }

  updateProgress(id: number, progress: ScanRunProgress): void {
    // `updated_at` written explicitly -- this table deliberately has no trigger,
    // because the row is updated hundreds of times per scan. See migrations/0093.
    this.db
      .prepare(
        `UPDATE pho_magic_scan_run
            SET files_seen = ?, files_indexed = ?, files_cached = ?, files_failed = ?,
                current_path = ?, last_error = ?, updated_at = datetime('now')
          WHERE id = ?`,
      )
      .run(
        progress.filesSeen,
        progress.filesIndexed,
        progress.filesCached,
        progress.filesFailed,
        progress.currentPath,
        progress.lastError ?? "",
        id,
      );
  }

  finishRun(
    id: number,
    status: "completed" | "failed" | "cancelled",
    lastError?: string,
  ): void {
    this.db
      .prepare(
        `UPDATE pho_magic_scan_run
            SET status = ?, finished_at = datetime('now'), updated_at = datetime('now'),
                last_error = COALESCE(?, last_error)
          WHERE id = ?`,
      )
      .run(status, lastError ?? null, id);
  }

  getRun(id: number): MagicScanRun | undefined {
    const row = this.db.prepare(`SELECT * FROM pho_magic_scan_run WHERE id = ?`).get(id) as
      | ScanRunRow
      | undefined;
    return row === undefined ? undefined : toScanRun(row);
  }

  getActiveRun(): MagicScanRun | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM pho_magic_scan_run WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`,
      )
      .get() as ScanRunRow | undefined;
    return row === undefined ? undefined : toScanRun(row);
  }

  failAbandonedRuns(staleAfterSeconds = 120): number {
    // Compared in SQL so the clock is the database's, matching how `updated_at` was
    // written -- reading the row into JS and comparing against `new Date()` would mix
    // two clocks and misjudge a run on a machine whose zone is not UTC.
    const result = this.db
      .prepare(
        `UPDATE pho_magic_scan_run
            SET status = 'failed',
                finished_at = datetime('now'),
                updated_at = datetime('now'),
                last_error = 'The scan stopped without finishing.'
          WHERE status = 'running'
            AND updated_at < datetime('now', ?)`,
      )
      .run(`-${Math.max(1, Math.floor(staleAfterSeconds))} seconds`);
    return result.changes;
  }
}
