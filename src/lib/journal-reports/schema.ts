// The zod schemas that define what crosses the boundary. Both the server action
// and the CLI parse their raw input with these, so a given logical input is
// validated identically in both.

import { z } from "zod";
import { REPORT_PART_KINDS, REPORT_SORT_FIELDS, REPORT_WHERE_MODES } from "./types";

export const reportNameSchema = z
  .string()
  .trim()
  .min(1, "A report needs a name.")
  .max(120, "That name is too long.");

/**
 * The template HTML for one part.
 *
 * No minimum — an empty part is a real state (an aggregate report has no `row`
 * part, and a report may have no footer). The cap is generous but finite: a
 * template is markup, and a megabyte of it in a column is a mistake rather than
 * a use-case.
 */
export const reportPartHtmlSchema = z.string().max(100_000, "That template is too long.");

export const reportPartSchema = z.object({
  part: z.enum(REPORT_PART_KINDS as unknown as [string, ...string[]]),
  html: reportPartHtmlSchema,
});

/**
 * A report as it arrives from the editor or the CLI.
 *
 * Both `whereQuery` and `whereSql` are always accepted regardless of mode, so
 * switching modes in the editor round-trips without losing the other mode's
 * text. Only the one named by `whereMode` is ever compiled — the validation of
 * *that* text happens in the use-case, which is also where the admin check for
 * `sql` mode is enforced.
 */
export const saveReportSchema = z.object({
  // Coerced because an HTML form sends it as a string. Absent = a new report.
  id: z.coerce.number().int().positive().optional(),
  name: reportNameSchema,
  description: z.string().trim().max(500, "That description is too long.").default(""),
  whereMode: z.enum(REPORT_WHERE_MODES as unknown as [string, ...string[]]).default("filter"),
  whereQuery: z.string().trim().max(2000, "That filter query is too long.").default(""),
  whereSql: z.string().trim().max(2000, "That SQL condition is too long.").default(""),
  sortField: z.enum(REPORT_SORT_FIELDS as unknown as [string, ...string[]]).default("date"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  // 0 = no limit. Capped so a typo can't ask for a million-row print job.
  maxRows: z.coerce.number().int().min(0).max(100_000).default(0),
  parts: z.array(reportPartSchema).max(REPORT_PART_KINDS.length),
});

export type SaveReportInput = z.infer<typeof saveReportSchema>;

export const reportIdSchema = z.coerce.number().int().positive();

/** What the editor's live preview asks for: a draft that may not be saved yet. */
export const previewReportSchema = saveReportSchema.extend({
  // The preview is capped harder than a real run: it renders on every keystroke
  // pause, and nobody reads 500 entries in a preview pane.
  previewLimit: z.coerce.number().int().min(1).max(200).default(25),
});

export type PreviewReportInput = z.infer<typeof previewReportSchema>;
