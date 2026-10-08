// The read-only guard for a report's raw-SQL WHERE fragment.
//
// Raw-SQL mode is admin-only and exists for the expressiveness the filter-query
// syntax can't reach: subqueries, HAVING, date functions. The fragment is
// spliced into a WHERE clause, so unlike every other query in this codebase its
// text is not parameterised — which is exactly why it is checked here.
//
// This guard runs in `lib`, so the web app and the CLI enforce it identically.
// It runs BOTH on save and again on run: a fragment that reached the table by
// some other route (a hand-edited database, a restored backup) still cannot
// execute. Validating only on save would make the table itself the trust
// boundary, and the table is a file on a NAS.
//
// WHAT THIS IS NOT: a SQL parser, and not a defence against a determined
// attacker who already has an admin session. It is a guard against the realistic
// failure here — a mistyped or over-ambitious fragment destroying data in a
// single-user home app whose database has no second copy. The fragment still
// runs with full read access to every table.

/** Thrown with a message meant to be shown to the author. */
export class ReportSqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportSqlError";
  }
}

/**
 * Statement keywords that have no business in a boolean expression.
 *
 * Matched as whole words, case-insensitively. `CREATE` is here as well as the
 * obvious DML because `CREATE TRIGGER` inside a fragment would be a write path,
 * and `ATTACH` because it reaches another database file entirely.
 */
const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "REPLACE",
  "TRUNCATE",
  "ATTACH",
  "DETACH",
  "PRAGMA",
  "VACUUM",
  "REINDEX",
  "ANALYZE",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "GRANT",
  "REVOKE",
] as const;

/**
 * SQLite functions that reach outside the query. `load_extension` runs native
 * code; `readfile`/`writefile`/`edit` are CLI-shell functions that touch the
 * filesystem and must never be reachable from a stored report.
 */
const FORBIDDEN_FUNCTIONS = ["load_extension", "readfile", "writefile", "edit", "fts3_tokenizer"] as const;

/** The longest fragment accepted. A guard against a pasted-in whole script. */
const MAX_FRAGMENT_LENGTH = 2000;

/**
 * Checks a raw-SQL WHERE fragment, throwing `ReportSqlError` if it is anything
 * other than a read-only boolean expression.
 *
 * An empty fragment is **valid** and means "every entry" — the caller decides
 * whether a report with no condition is what the author wanted, the same way an
 * empty filter query does.
 */
export function assertReadOnlyFragment(fragment: string): void {
  const sql = fragment.trim();
  if (sql === "") return;

  if (sql.length > MAX_FRAGMENT_LENGTH) {
    throw new ReportSqlError(
      `The SQL condition is too long (${sql.length} characters, limit ${MAX_FRAGMENT_LENGTH}).`,
    );
  }

  // A semicolon ends the statement, so anything after it is a second statement.
  // better-sqlite3's prepare() refuses multiple statements, but relying on that
  // would put the check in the driver rather than in the rule.
  if (sql.includes(";")) {
    throw new ReportSqlError("The SQL condition may not contain a semicolon.");
  }

  // Comment markers can hide the rest of the generated query — `x = 1 --` would
  // comment out the encrypted-entry exclusion and the ORDER BY that follow it.
  if (sql.includes("--") || sql.includes("/*") || sql.includes("*/")) {
    throw new ReportSqlError("The SQL condition may not contain a comment (-- or /* */).");
  }

  // Keyword checks run against a copy with string literals blanked out, so a
  // legitimate `e.title LIKE '%update%'` isn't rejected for the word inside the
  // quotes. The original is what executes; this copy only decides.
  const withoutLiterals = blankStringLiterals(sql);

  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(withoutLiterals)) {
      throw new ReportSqlError(
        `The SQL condition may not contain ${keyword} — it must be a read-only condition.`,
      );
    }
  }

  for (const fn of FORBIDDEN_FUNCTIONS) {
    if (new RegExp(`\\b${fn}\\b`, "i").test(withoutLiterals)) {
      throw new ReportSqlError(`The SQL condition may not call ${fn}().`);
    }
  }

  // Unbalanced parentheses would otherwise break the surrounding query with a
  // syntax error at render time, which reads as "the report is broken" rather
  // than "the condition is wrong".
  if (countChar(withoutLiterals, "(") !== countChar(withoutLiterals, ")")) {
    throw new ReportSqlError("The SQL condition has unbalanced parentheses.");
  }

  // An unterminated literal would swallow the rest of the generated query.
  if (hasUnterminatedLiteral(sql)) {
    throw new ReportSqlError("The SQL condition has an unterminated quoted string.");
  }
}

/** `tryAssertReadOnlyFragment`'s shape — for a caller that renders the message. */
export function checkReadOnlyFragment(fragment: string): { ok: true } | { ok: false; error: string } {
  try {
    assertReadOnlyFragment(fragment);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The SQL condition could not be read.",
    };
  }
}

/**
 * Replaces the contents of every quoted string with spaces, preserving length.
 *
 * SQLite escapes a quote by doubling it (`'it''s'`), which this handles by
 * staying inside the literal when it meets the pair. Length is preserved so a
 * position in the blanked copy still lines up with the original, which keeps any
 * future message that wants to point at an offset honest.
 */
function blankStringLiterals(sql: string): string {
  let out = "";
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];

    if (char === "'" || char === '"') {
      const quote = char;
      out += quote;
      index += 1;

      while (index < sql.length) {
        if (sql[index] === quote) {
          // A doubled quote is an escaped quote, not the end of the literal.
          if (sql[index + 1] === quote) {
            out += "  ";
            index += 2;
            continue;
          }
          out += quote;
          index += 1;
          break;
        }
        out += " ";
        index += 1;
      }
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

function countChar(text: string, char: string): number {
  let count = 0;
  for (const current of text) if (current === char) count += 1;
  return count;
}

/** True when a quote opens and never closes. */
function hasUnterminatedLiteral(sql: string): boolean {
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];

    if (char === "'" || char === '"') {
      const quote = char;
      index += 1;
      let closed = false;

      while (index < sql.length) {
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            index += 2;
            continue;
          }
          closed = true;
          index += 1;
          break;
        }
        index += 1;
      }

      if (!closed) return true;
      continue;
    }

    index += 1;
  }

  return false;
}
