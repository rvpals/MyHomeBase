import { z } from "zod";
import { CSV_DELIMITERS } from "./delimiter";

/**
 * How many rows one read returns.
 *
 * The grid pages client-side within whatever it is given, so this is the
 * server-side window rather than the page size someone sees. 1000 rather than
 * the SQLite browser's 500: a delimited file is usually opened to scan the
 * whole thing, the cells are text rather than arbitrary BLOBs, and the sidecar
 * read is a local indexed scan.
 */
export const CSV_PAGE_LIMIT = 1000;

/**
 * The largest window a caller may ask for.
 *
 * A ceiling on one request, not on the file: a 200k-row file is fine, asking
 * for all of it in one response is not. The view pages through instead.
 */
export const CSV_MAX_PAGE_LIMIT = 5000;

/** Which uploaded file a request is about. */
export const csvFileIdSchema = z.coerce.number().int().positive();

/** One of the separators this tool reads. */
export const csvDelimiterSchema = z.enum(CSV_DELIMITERS);

/**
 * A file being uploaded.
 *
 * The name is only ever used for display and for its extension — the stored
 * name is generated — so it is checked for emptiness and extension rather than
 * for path safety, and `file-store.ts` never builds a path from it.
 *
 * `.txt` is accepted deliberately, and it is why the delimiter is sniffed
 * rather than assumed: a `.txt` export is as often tab-separated as comma.
 */
export const csvUploadFileNameSchema = z
  .string()
  .trim()
  .min(1, "The file needs a name.")
  .refine(
    (name) => /\.(csv|txt|tsv|tab|psv)$/i.test(name),
    "Only .csv, .txt, .tsv, .tab and .psv files can be opened here.",
  );

/**
 * How a file is read on import.
 *
 * Both fields are optional because the common path is "work it out for me":
 * the delimiter is sniffed and a header row assumed. A caller who knows better
 * — the reader correcting the guess, or a CLI flag — passes them explicitly.
 */
export const csvImportOptionsSchema = z.object({
  delimiter: csvDelimiterSchema.optional(),
  hasHeaderRow: z.boolean().default(true),
});

export type CsvImportOptionsInput = z.input<typeof csvImportOptionsSchema>;
export type CsvImportOptions = z.infer<typeof csvImportOptionsSchema>;

/** A windowed read of one uploaded file. */
export const readCsvRowsSchema = z.object({
  fileId: csvFileIdSchema,
  limit: z.number().int().positive().max(CSV_MAX_PAGE_LIMIT).default(CSV_PAGE_LIMIT),
  offset: z.number().int().min(0).default(0),
});

/**
 * What a *caller* passes, so the window is optional — `z.input`, not `z.infer`.
 *
 * Same reasoning as `sqlite-browser`'s `ReadTableInput`: `.default()` makes the
 * two types differ, and using the output type here would make every call site
 * supply a limit and an offset, which is the opposite of what a default is for.
 */
export type ReadCsvRowsInput = z.input<typeof readCsvRowsSchema>;
export type ReadCsvRowsOptions = z.infer<typeof readCsvRowsSchema>;

/**
 * A delete of one or more rows.
 *
 * Rows are addressed by the sidecar's rowid, never by position: the grid sorts
 * and filters, so "the third row" means nothing by the time a click arrives.
 * At least one is required — an empty list would report a successful delete of
 * nothing.
 */
export const deleteCsvRowsSchema = z.object({
  fileId: csvFileIdSchema,
  rowIds: z
    .array(z.number().int())
    .min(1, "Pick at least one row to delete.")
    .max(10000, "Too many rows selected at once."),
});

export type DeleteCsvRowsInput = z.infer<typeof deleteCsvRowsSchema>;

/**
 * The cells to write.
 *
 * A record rather than a list of pairs so the same shape serves a single-row
 * edit and a bulk edit — the difference is only how many rowids come with it.
 * `null` clears a cell; an absent column is left untouched.
 *
 * `z.record` with an explicit key schema, so a prototype-polluting key like
 * `__proto__` is a parse failure rather than something the writer has to
 * defend against. The column names are checked against the file's own list in
 * the use-case regardless — this is the cheaper first guard.
 */
export const csvCellChangesSchema = z
  .record(z.string().min(1), z.string().nullable())
  .refine((changes) => Object.keys(changes).length > 0, "Nothing to change.");

/** An edit applied to one or more rows. */
export const editCsvRowsSchema = z.object({
  fileId: csvFileIdSchema,
  rowIds: z
    .array(z.number().int())
    .min(1, "Pick at least one row to edit.")
    .max(10000, "Too many rows selected at once."),
  changes: csvCellChangesSchema,
});

export type EditCsvRowsInput = z.infer<typeof editCsvRowsSchema>;
