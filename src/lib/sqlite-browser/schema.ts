import { z } from "zod";
import { formatCap } from "./errors";

/**
 * The upload size cap when nothing is configured, in bytes.
 *
 * 1 GB, which is "any SQLite file you would realistically sit and browse"
 * rather than a number tuned to a particular file. It started at 50 MB and was
 * raised the first time it was pointed at a real database: MyHomeBase's own
 * was 89 MB on a desktop copy, so the original figure failed the most obvious
 * thing anyone would try this tool on. That episode is also why the cap is now
 * **configurable** (Admin → Configuration → Application) rather than a number
 * only a developer can change.
 *
 * **This costs disk, not memory.** The upload route streams to the upload root
 * and never buffers the file (see `SqliteFileStore.saveStream`), so the cap
 * bounds how much space one upload can take in the workspace folder — which is
 * scratch space that can be cleared. Were uploads ever to go back through a
 * server action, this number would be a memory figure instead and would need
 * revisiting along with `serverActions.bodySizeLimit`.
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

/**
 * The largest the configured cap may be, in bytes.
 *
 * A ceiling on the *setting*, not on any one upload. Without it a typo —
 * 5000 where 500 was meant — would let a single upload fill the NAS volume,
 * and the upload root is scratch space nobody is watching. 5 GB is far above
 * any plausible SQLite file someone would sit and browse, so it constrains
 * mistakes rather than intent.
 */
export const MAX_UPLOAD_CEILING_BYTES = 5 * 1024 * 1024 * 1024;

/** The smallest the configured cap may be — below this the tool is useless. */
export const MIN_UPLOAD_CAP_BYTES = 1024 * 1024;

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
export const uploadFileNameSchema = z
  .string()
  .trim()
  .min(1, "The file needs a name.")
  .refine(
    (name) => /\.(db|sqlite|sqlite3|db3)$/i.test(name),
    "Only .db, .sqlite, .sqlite3 and .db3 files can be opened here.",
  );

/**
 * A file being uploaded, validated against a cap resolved at call time.
 *
 * A factory rather than a constant schema because the cap is now a setting:
 * building it per call is what lets the web app and the CLI enforce the *same
 * configured* number instead of a compile-time one. The default keeps every
 * existing caller and test working without passing a cap.
 */
export function uploadDatabaseSchemaFor(maxBytes: number = DEFAULT_MAX_UPLOAD_BYTES) {
  return z.object({
    originalFileName: uploadFileNameSchema,
    bytes: z
      .instanceof(Uint8Array)
      .refine((bytes) => bytes.byteLength > 0, "That file is empty.")
      .refine(
        (bytes) => bytes.byteLength <= maxBytes,
        `That file is larger than the ${formatCap(maxBytes)} limit.`,
      ),
    uploadedByUserId: z.number().int().positive().nullable(),
  });
}

/** The shape an upload takes, independent of which cap it was checked against. */
export type UploadDatabaseInput = z.infer<ReturnType<typeof uploadDatabaseSchemaFor>>;

/**
 * The configured cap itself, as it arrives from the admin control.
 *
 * Range-checked here rather than clamped, unlike `resolveToolsSettings`: this
 * is someone typing a number into a form, where saying "that is too large" is
 * more useful than silently storing something else. The resolver stays
 * forgiving because it reads rows that may have been edited by hand.
 */
export const maxUploadCapSchema = z
  .number()
  .int("Give a whole number of megabytes.")
  .min(MIN_UPLOAD_CAP_BYTES, `The limit cannot be below ${formatCap(MIN_UPLOAD_CAP_BYTES)}.`)
  .max(MAX_UPLOAD_CEILING_BYTES, `The limit cannot exceed ${formatCap(MAX_UPLOAD_CEILING_BYTES)}.`);

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
