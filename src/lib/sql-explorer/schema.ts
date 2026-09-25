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

// Tags as the save dialog and the CLI both supply them: one comma-separated
// string. Split, trimmed, blanks dropped, de-duplicated case-insensitively
// (keeping the first spelling), so "Investments, investments," stores one tag.
//
// A transform rather than a z.array(z.string()) because every caller has a
// string at the boundary -- an <input> on the web, an argv value on the CLI --
// and splitting it in both adapters is exactly the duplicated logic the schema
// exists to prevent.
export const tagListSchema = z
  .string()
  .default("")
  .transform((raw) => {
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const part of raw.split(",")) {
      const tag = part.trim();
      if (tag === "") continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
    return tags;
  });

// A saved query crossing the boundary. The statement is held to
// sqlStatementSchema (non-empty) and deliberately NOT to the read-only rule:
// the SQL Query tab runs writes, so a saved UPDATE is a legitimate thing to
// store. What protects the reader is that loading a saved query fills the
// editor without executing it.
export const saveQuerySchema = z.object({
  name: z.string().trim().min(1, "A name is required.").max(120),
  description: z.string().trim().max(500).default(""),
  tags: tagListSchema,
  sqlStatement: sqlStatementSchema,
});

// The id of a saved query, as a delete supplies it. Coerced because it arrives
// as a string from argv on the CLI.
export const savedQueryIdSchema = z.coerce.number().int().positive();
