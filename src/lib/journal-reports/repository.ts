// Data access for Journal Reports. The only place that talks to jrn_reports and
// jrn_report_details, and it returns domain types rather than driver rows.

import type Database from "better-sqlite3";
import type { EntryLocation, JournalEntry } from "@/lib/journal";
import type { JournalReportRepository, ReportWriteData } from "./ports";
import type {
  JournalReport,
  JournalReportDetail,
  JournalReportSummary,
  ReportPartKind,
  ReportSortDirection,
  ReportSortField,
  ReportWhereMode,
} from "./types";
import type { CompiledWhere } from "./where";

interface ReportRow {
  id: number;
  name: string;
  description: string;
  where_mode: string;
  where_query: string;
  where_sql: string;
  sort_field: string;
  sort_direction: string;
  max_rows: number;
  is_builtin: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface DetailRow {
  id: number;
  report_id: number;
  part: string;
  html: string;
  sort_order: number;
}

interface EntryRow {
  id: number;
  entry_date: string;
  entry_time: string;
  title: string;
  content: string;
  place_name: string;
  weather_temp: number | null;
  weather_unit: string | null;
  weather_description: string | null;
  weather_code: number | null;
  is_pinned: number;
  is_locked: number;
  is_encrypted: number;
  title_encrypted: string;
  content_encrypted: string;
  password_hint: string;
  source: string;
  external_id: string;
  external_content: string;
  created_at: string;
  updated_at: string;
}

interface PairingRow {
  entry_id: number;
  name: string;
}

interface LocationRow {
  id: number;
  entry_id: number;
  latitude: number;
  longitude: number;
  location_name: string;
  sort_order: number;
  saved_location_id: number | null;
}

function reportToDomain(row: ReportRow): JournalReport {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    // The column is free text at the database level, so an unexpected value
    // reads as the safe mode rather than being trusted. A tampered row can't
    // promote itself to raw SQL this way.
    whereMode: (row.where_mode === "sql" ? "sql" : "filter") as ReportWhereMode,
    whereQuery: row.where_query,
    whereSql: row.where_sql,
    sortField: row.sort_field as ReportSortField,
    sortDirection: (row.sort_direction === "asc" ? "asc" : "desc") as ReportSortDirection,
    maxRows: row.max_rows,
    isBuiltin: row.is_builtin === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function detailToDomain(row: DetailRow): JournalReportDetail {
  return {
    id: row.id,
    reportId: row.report_id,
    part: row.part as ReportPartKind,
    html: row.html,
    sortOrder: row.sort_order,
  };
}

function locationToDomain(row: LocationRow): EntryLocation {
  return {
    id: row.id,
    entryId: row.entry_id,
    latitude: row.latitude,
    longitude: row.longitude,
    locationName: row.location_name,
    sortOrder: row.sort_order,
    savedLocationId: row.saved_location_id ?? undefined,
  };
}

function entryToDomain(
  row: EntryRow,
  categories: string[],
  tags: string[],
  locations: EntryLocation[],
): JournalEntry {
  return {
    id: row.id,
    date: row.entry_date,
    time: row.entry_time,
    title: row.title,
    content: row.content,
    placeName: row.place_name,
    weather:
      row.weather_temp === null
        ? undefined
        : {
            temp: row.weather_temp,
            unit: row.weather_unit ?? "",
            description: row.weather_description ?? "",
            code: row.weather_code ?? 0,
          },
    isPinned: row.is_pinned === 1,
    isLocked: row.is_locked === 1,
    isEncrypted: row.is_encrypted === 1,
    titleEncrypted: row.title_encrypted,
    contentEncrypted: row.content_encrypted,
    passwordHint: row.password_hint,
    categories,
    tags,
    locations,
    source: row.source,
    externalId: row.external_id,
    externalContent: row.external_content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const REPORT_COLUMNS = `id, name, description, where_mode, where_query, where_sql,
  sort_field, sort_direction, max_rows, is_builtin, sort_order, created_at, updated_at`;

export class SqliteJournalReportRepository implements JournalReportRepository {
  constructor(private readonly db: Database.Database) {}

  listReports(): JournalReportSummary[] {
    const rows = this.db
      .prepare(
        `SELECT ${REPORT_COLUMNS} FROM jrn_reports
         ORDER BY sort_order ASC, name ASC`,
      )
      .all() as ReportRow[];

    return rows.map((row) => {
      const report = reportToDomain(row);
      return {
        id: report.id,
        name: report.name,
        description: report.description,
        whereMode: report.whereMode,
        // The list row shows whichever selection is live, so a reader can see
        // what a report covers without opening the editor.
        whereText: report.whereMode === "sql" ? report.whereSql : report.whereQuery,
        isBuiltin: report.isBuiltin,
        sortOrder: report.sortOrder,
        updatedAt: report.updatedAt,
      };
    });
  }

  getReport(id: number): JournalReport | undefined {
    const row = this.db
      .prepare(`SELECT ${REPORT_COLUMNS} FROM jrn_reports WHERE id = ?`)
      .get(id) as ReportRow | undefined;
    return row ? reportToDomain(row) : undefined;
  }

  getReportDetails(id: number): JournalReportDetail[] {
    const rows = this.db
      .prepare(
        `SELECT id, report_id, part, html, sort_order FROM jrn_report_details
         WHERE report_id = ? ORDER BY sort_order ASC`,
      )
      .all(id) as DetailRow[];
    return rows.map(detailToDomain);
  }

  saveReport(input: ReportWriteData): JournalReport {
    // One transaction: a header written without its details would render as a
    // blank report, and a half-replaced template is worse than either version.
    const saved = this.db.transaction((): JournalReport => {
      const now = new Date().toISOString();
      let reportId: number;

      if (input.id === undefined) {
        // New reports sort after everything that exists, so a save doesn't
        // reshuffle the list the author is looking at.
        const next = this.db
          .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM jrn_reports")
          .get() as { next: number };

        const result = this.db
          .prepare(
            `INSERT INTO jrn_reports
               (name, description, where_mode, where_query, where_sql,
                sort_field, sort_direction, max_rows, is_builtin, sort_order,
                created_at, updated_at)
             VALUES (@name, @description, @whereMode, @whereQuery, @whereSql,
                @sortField, @sortDirection, @maxRows, 0, @sortOrder, @now, @now)`,
          )
          .run({
            name: input.name,
            description: input.description,
            whereMode: input.whereMode,
            whereQuery: input.whereQuery,
            whereSql: input.whereSql,
            sortField: input.sortField,
            sortDirection: input.sortDirection,
            maxRows: input.maxRows,
            sortOrder: next.next,
            now,
          });
        reportId = Number(result.lastInsertRowid);
      } else {
        reportId = input.id;
        // `is_builtin` and `sort_order` are deliberately not in the SET list: a
        // builtin stays a builtin through an edit, and saving the editor must
        // not move the report in the list.
        this.db
          .prepare(
            `UPDATE jrn_reports SET
               name = @name, description = @description,
               where_mode = @whereMode, where_query = @whereQuery, where_sql = @whereSql,
               sort_field = @sortField, sort_direction = @sortDirection,
               max_rows = @maxRows, updated_at = @now
             WHERE id = @id`,
          )
          .run({
            id: reportId,
            name: input.name,
            description: input.description,
            whereMode: input.whereMode,
            whereQuery: input.whereQuery,
            whereSql: input.whereSql,
            sortField: input.sortField,
            sortDirection: input.sortDirection,
            maxRows: input.maxRows,
            now,
          });
      }

      // Replace rather than upsert: the parts are a fixed set of three, so
      // delete-then-insert is simpler than reconciling and can't leave a stale
      // part behind.
      this.db.prepare("DELETE FROM jrn_report_details WHERE report_id = ?").run(reportId);

      const insertDetail = this.db.prepare(
        `INSERT INTO jrn_report_details (report_id, part, html, sort_order)
         VALUES (?, ?, ?, ?)`,
      );
      input.parts.forEach((part, index) => {
        insertDetail.run(reportId, part.part, part.html, index);
      });

      const row = this.db
        .prepare(`SELECT ${REPORT_COLUMNS} FROM jrn_reports WHERE id = ?`)
        .get(reportId) as ReportRow;
      return reportToDomain(row);
    })();

    return saved;
  }

  deleteReport(id: number): void {
    // The details go by ON DELETE CASCADE, but that depends on foreign keys
    // being on for the connection. Deleting them explicitly makes the cleanup
    // independent of that pragma.
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM jrn_report_details WHERE report_id = ?").run(id);
      this.db.prepare("DELETE FROM jrn_reports WHERE id = ?").run(id);
    })();
  }

  findReportEntries(where: CompiledWhere, orderBy: string, limit: number): JournalEntry[] {
    // `where.sql` and `orderBy` are literal SQL assembled in `lib` from
    // allowlists (buildFilterSql's FIELD_COLUMNS, SORT_COLUMNS) or from an
    // admin-only fragment already checked by assertReadOnlyFragment. Values
    // travel as named parameters in `where.params`.
    //
    // `__limit` is prefixed so it can't collide with a key buildFilterSql
    // generated — the same guard findEntries uses.
    const limitClause = limit > 0 ? "LIMIT @__limit" : "";
    const rows = this.db
      .prepare(
        `SELECT e.* FROM jrn_entries e
         WHERE ${where.sql}
         ORDER BY ${orderBy}
         ${limitClause}`,
      )
      .all({ ...where.params, ...(limit > 0 ? { __limit: limit } : {}) }) as EntryRow[];

    return this.hydrateEntries(rows);
  }

  countReportEntries(where: CompiledWhere): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM jrn_entries e WHERE ${where.sql}`)
      .get(where.params) as { count: number };
    return row.count;
  }

  /**
   * Fills in each entry's categories, tags and locations.
   *
   * Three queries for the whole page rather than three per entry — a report can
   * cover thousands of entries, and the per-entry shape would be thousands of
   * round trips. Row order is preserved, because the caller's ORDER BY is the
   * order the report prints in.
   */
  private hydrateEntries(rows: EntryRow[]): JournalEntry[] {
    if (rows.length === 0) return [];

    // Ids come from the database as integers, never from input, so an IN list
    // built from them carries nothing injectable. A parameter list would need
    // as many placeholders as rows, which SQLite caps.
    const idList = rows.map((row) => row.id).join(",");

    const categoriesByEntry = groupPairings(
      this.db
        .prepare(
          `SELECT entry_id, category_name AS name FROM jrn_entry_categories
           WHERE entry_id IN (${idList}) ORDER BY id ASC`,
        )
        .all() as PairingRow[],
    );

    const tagsByEntry = groupPairings(
      this.db
        .prepare(
          `SELECT entry_id, tag_name AS name FROM jrn_entry_tags
           WHERE entry_id IN (${idList}) ORDER BY id ASC`,
        )
        .all() as PairingRow[],
    );

    const locationsByEntry = new Map<number, EntryLocation[]>();
    const locationRows = this.db
      .prepare(
        `SELECT * FROM jrn_entry_locations
         WHERE entry_id IN (${idList}) ORDER BY entry_id ASC, sort_order ASC`,
      )
      .all() as LocationRow[];
    for (const row of locationRows) {
      const existing = locationsByEntry.get(row.entry_id) ?? [];
      existing.push(locationToDomain(row));
      locationsByEntry.set(row.entry_id, existing);
    }

    return rows.map((row) =>
      entryToDomain(
        row,
        categoriesByEntry.get(row.id) ?? [],
        tagsByEntry.get(row.id) ?? [],
        locationsByEntry.get(row.id) ?? [],
      ),
    );
  }
}

function groupPairings(rows: PairingRow[]): Map<number, string[]> {
  const grouped = new Map<number, string[]>();
  for (const row of rows) {
    const existing = grouped.get(row.entry_id) ?? [];
    existing.push(row.name);
    grouped.set(row.entry_id, existing);
  }
  return grouped;
}
