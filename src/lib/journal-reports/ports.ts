// The interface the report use-cases need. The real implementation is in
// repository.ts and is wired at the composition root; tests wire in a fake.

import type { JournalEntry } from "@/lib/journal";
import type { CompiledWhere } from "./where";
import type {
  JournalReport,
  JournalReportDetail,
  JournalReportSummary,
  ReportSortDirection,
  ReportSortField,
} from "./types";

/** What a save writes. `id` absent = insert, present = update. */
export interface ReportWriteData {
  id?: number;
  name: string;
  description: string;
  whereMode: JournalReport["whereMode"];
  whereQuery: string;
  whereSql: string;
  sortField: ReportSortField;
  sortDirection: ReportSortDirection;
  maxRows: number;
  /** The three template parts. A part with empty HTML is still stored, so the
   *  editor's boxes keep their identity across a save. */
  parts: { part: JournalReportDetail["part"]; html: string }[];
}

export interface JournalReportRepository {
  listReports(): JournalReportSummary[];
  getReport(id: number): JournalReport | undefined;
  getReportDetails(id: number): JournalReportDetail[];
  /** Inserts or updates the header and replaces the detail rows. Returns the saved header. */
  saveReport(input: ReportWriteData): JournalReport;
  /** Removes the report and (by cascade) its details. */
  deleteReport(id: number): void;
  /**
   * The entries a compiled selection matches, ordered by `orderBy`.
   *
   * `orderBy` and `where.sql` are literal SQL built in `lib` from allowlists —
   * never raw input. `limit` of 0 means no limit.
   */
  findReportEntries(where: CompiledWhere, orderBy: string, limit: number): JournalEntry[];
  /** How many entries the selection matches, without hydrating any of them. */
  countReportEntries(where: CompiledWhere): number;
}
