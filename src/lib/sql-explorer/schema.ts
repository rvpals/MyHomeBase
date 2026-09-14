import { z } from "zod";

export const sqlStatementSchema = z.string().min(1);

// Only a leading SELECT is accepted for read-only execution. Everything else is
// rejected, including CTEs (`WITH …`): the repository's read-only pattern is
// /^(SELECT|PRAGMA|EXPLAIN)/, so a `WITH …` statement would fall through to its
// write path (`.run()`), and SQLite permits `WITH … DELETE`. Keeping this
// stricter than the repository is deliberate.
export const readOnlySqlStatementSchema = sqlStatementSchema.refine(
  (sql) => /^\s*SELECT\b/i.test(sql),
  { message: "Only SELECT queries are allowed here." },
);

// A table name crossing the boundary. Kept to the characters SQLite identifiers
// actually use here, so a name can never carry a quote or a semicolon into the
// interpolated DELETE. The repository additionally checks the name exists.
export const tableNameSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Not a valid table name.");

// One BLOB cell's address, as it arrives from the blob route's query string.
// The column name is held to the same identifier rule as the table name: it is
// interpolated into the SELECT (a column cannot be a bound parameter), and the
// repository additionally checks it against the table's real columns.
export const blobCellSourceSchema = z.object({
  tableName: tableNameSchema,
  columnName: z
    .string()
    .min(1)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Not a valid column name."),
  // A rowid is a signed 64-bit integer; anything else never addressed a row.
  rowId: z.coerce.number().int(),
});
