// The public surface of Journal Reports. Import from here, not from internals.

export type {
  JournalReport,
  JournalReportDetail,
  JournalReportSummary,
  JournalReportWithDetails,
  RenderedReport,
  ReportPartKind,
  ReportSortDirection,
  ReportSortField,
  ReportWhereMode,
} from "./types";
export {
  REPORT_PART_KINDS,
  REPORT_SORT_FIELDS,
  REPORT_WHERE_MODES,
} from "./types";

export type { JournalReportField, ReportFieldScope } from "./fields";
export {
  JOURNAL_REPORT_ENTRY_FIELDS,
  JOURNAL_REPORT_FIELDS,
  JOURNAL_REPORT_STAT_FIELDS,
  JOURNAL_REPORT_TABLE_FIELDS,
  isReportFieldToken,
  reportField,
  reportPlaceholder,
  unknownTokens,
} from "./fields";

export type { JournalReportRepository, ReportWriteData } from "./ports";

export {
  previewReportSchema,
  reportIdSchema,
  reportNameSchema,
  reportPartHtmlSchema,
  saveReportSchema,
  type PreviewReportInput,
  type SaveReportInput,
} from "./schema";

export { ReportSqlError, assertReadOnlyFragment, checkReadOnlyFragment } from "./sql-guard";

export { needsSanitizing, sanitizeReportHtml, type SanitizeResult } from "./sanitize";

export { escapeHtml, renderReport, wrapReportDocument, type RenderReportInput } from "./render";

export { compileReportWhere, isReportSortField, reportOrderBy, type CompiledWhere } from "./where";

export {
  JournalReportError,
  checkReportSelection,
  countReportMatches,
  deleteReport,
  duplicateReport,
  getReportWithDetails,
  listReports,
  renderReportFor,
  reportDocument,
  reportFileName,
  reportTemplateWarnings,
  runReport,
  saveReport,
  type RunReportOptions,
} from "./journal-reports";

export { SqliteJournalReportRepository } from "./repository";
