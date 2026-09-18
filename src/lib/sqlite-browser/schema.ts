import { z } from "zod";

/**
 * The upload size cap, in bytes.
 *
 * Enforced here rather than in the action so the CLI rejects exactly what the
 * web app rejects — the boundary rule is the schema, per ARCHITECTURE.md.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** How many rows one table read returns. */
export const TABLE_PAGE_LIMIT = 500;

/**
 * A table name crossing the boundary.
 *
 * Held to the characters a SQLite identifier actually uses here, so a name can
 * never carry a quote or a semicolon into an interpolated DELETE — a table name
 * cannot be a bound parameter. The reader additionally resolves it against the
 * file's own `sqlite_master`, so both guards stand between a caller's string and
 * the SQL text. Same reasoning as `sql-explorer`'s copy.
 */
export const tableNameSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Not a valid table name.");

/**
 * A file being uploaded.
 *
 * The name is only ever used for display and for its extension — the stored
 * name is generated — so it is checked for emptiness rather than for path
 * safety, and `file-store.ts` never builds a path from it.
 */
export const uploadDatabaseSchema = z.object({
  originalFileName: z
    .string()
    .trim()
    .min(1, "The file needs a name.")
    .refine(
      (name) => /\.(db|sqlite|sqlite3|db3)$/i.test(name),
      "Only .db, .sqlite, .sqlite3 and .db3 files can be opened here.",
    ),
  bytes: z
    .instanceof(Uint8Array)
    .refine((bytes) => bytes.byteLength > 0, "That file is empty.")
    .refine(
      (bytes) => bytes.byteLength <= MAX_UPLOAD_BYTES,
      `That file is larger than the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit.`,
    ),
  uploadedByUserId: z.number().int().positive().nullable(),
});

export type UploadDatabaseInput = z.infer<typeof uploadDatabaseSchema>;

/** Which uploaded file a request is about. */
export const databaseIdSchema = z.coerce.number().int().positive();

/** A read of one table inside one uploaded file. */
export const readTableSchema = z.object({
  databaseId: databaseIdSchema,
  tableName: tableNameSchema,
  limit: z.number().int().positive().max(5000).default(TABLE_PAGE_LIMIT),
});

/**
 * What a *caller* passes, so `limit` is optional — `z.input`, not `z.infer`.
 *
 * `.default()` makes the two types differ: after parsing the limit is always a
 * number, but nobody has to supply one. Using the output type here made the
 * flag mandatory at every call site, which is the opposite of what a default is
 * for. `ReadTableOptions` is the parsed shape, for anything downstream of the
 * parse.
 */
export type ReadTableInput = z.input<typeof readTableSchema>;
export type ReadTableOptions = z.infer<typeof readTableSchema>;

/**
 * A delete of one or more rows.
 *
 * Rows are addressed by rowid, never by position: the grid sorts and filters,
 * so "the third row" means nothing by the time a click arrives. At least one is
 * required — an empty list would report a successful delete of nothing.
 */
export const deleteRowsSchema = z.object({
  databaseId: databaseIdSchema,
  tableName: tableNameSchema,
  rowIds: z
    .array(z.number().int())
    .min(1, "Pick at least one row to delete.")
    .max(10000, "Too many rows selected at once."),
});

export type DeleteRowsInput = z.infer<typeof deleteRowsSchema>;
