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
