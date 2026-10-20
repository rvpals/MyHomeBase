/** The longest run of identifier characters ending at `caret` — the word being typed. */
export interface TableFragment {
  /** What has been typed so far; may be empty. */
  text: string;
  /** Index in the statement where the fragment starts. */
  start: number;
}

const IDENTIFIER_CHAR = /[A-Za-z0-9_]/;
const TABLE_KEYWORD_BEFORE = /\b(from|join)\s+$/i;

/** Finds the identifier fragment immediately before the caret. */
export function fragmentBeforeCaret(sql: string, caret: number): TableFragment {
  const end = Math.min(Math.max(caret, 0), sql.length);
  let start = end;
  while (start > 0 && IDENTIFIER_CHAR.test(sql[start - 1])) start -= 1;
  return { text: sql.slice(start, end), start };
}

/**
 * Whether a table name is expected at `fragmentStart` — i.e. the word before it
 * is FROM or JOIN. A table after a comma (`FROM a, b`) is not recognised.
 */
export function expectsTableName(sql: string, fragmentStart: number): boolean {
  return TABLE_KEYWORD_BEFORE.test(sql.slice(0, fragmentStart));
}

/**
 * Table names that start with `fragment`, case-insensitively, alphabetically.
 *
 * A fragment shorter than `minLength` suggests nothing, so a lone `s` doesn't
 * open a list of every table. A name identical to the fragment is dropped —
 * there's nothing left to complete.
 */
export function suggestTableNames(
  names: string[],
  fragment: string,
  { minLength = 2, limit = 12 }: { minLength?: number; limit?: number } = {},
): string[] {
  const needle = fragment.toLowerCase();
  if (needle.length < minLength) return [];
  return names
    .filter((name) => {
      const lower = name.toLowerCase();
      return lower.startsWith(needle) && lower !== needle;
    })
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit);
}
