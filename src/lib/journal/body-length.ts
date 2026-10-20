// The condition behind the Entries browser's "Substantial Entries" tab: entries
// whose body text runs to more than ten words.
//
// Pure — builds a SQL fragment and its parameters, executes nothing. The
// repository ANDs what this returns into the WHERE it already builds from the
// reader's filter.
//
// **Why this isn't a `JournalFilter` transform like `withLockedCondition`.**
// That one appends a `JournalFilterCondition` and is a filter-in/filter-out
// function. This can't be: `findEntries` runs `journalFilterSchema.parse()`,
// which drops any field that isn't on the `FIELD_COLUMNS` allowlist, so a
// `wordCount` condition would be stripped silently on the way to the query and
// the tab would list every entry. Making it a real filter field is a bigger
// change — new field kind, new operators, the builder's dropdowns, the
// filter-query grammar and `describeFilter` — and the tab doesn't need it. So
// the scope travels *beside* the filter, as its own repository argument, and the
// SQL below is a fixed literal written here.
//
// The allowlist rules at the top of filters.ts still hold: no part of this
// fragment is derived from input, and the threshold leaves as a named parameter.

/**
 * Which body-length population a list is scoped to.
 *
 * A two-state scope rather than a boolean for the same reason `JournalLockScope`
 * is three-state: "add no length condition at all" is what the other three tabs
 * need, and that reads better as a named arm than as `false`.
 */
export type JournalBodyScope = "all" | "substantial";

/**
 * How many words a body must exceed to count as substantial.
 *
 * The comparison is **strictly greater than** this, so at ten words exactly an
 * entry is not substantial — "longer than 10 words" as asked, not "at least 10".
 */
export const SUBSTANTIAL_MIN_WORDS = 10;

/** The parameter name the fragment binds its threshold to. */
const MIN_SPACES_PARAM = "__minSpaces";

export interface BodyLengthSql {
  sql: string;
  params: Record<string, number>;
}

/**
 * The WHERE fragment for `scope`, or `undefined` when it adds nothing.
 *
 * `undefined` means "contributes no condition", and the caller must treat it as
 * *no clause at all* rather than as true or false — the same contract
 * `buildFilterSql` has. `"all"` is the case that returns it, so the other three
 * tabs' queries are byte-for-byte what they were before this existed.
 *
 * **How the count works.** SQLite has no word-count function, so the fragment
 * counts the separators instead: the length of the trimmed body minus its length
 * with spaces removed is the number of spaces, and n spaces separate n+1 words.
 * More than ten words therefore means ten or more spaces, which is why the
 * comparison below is `>=` against `SUBSTANTIAL_MIN_WORDS` and not `>`.
 *
 * Three deliberate limitations, all in the conservative direction — the tab can
 * omit a borderline entry, never invent one:
 *
 *   - Consecutive spaces each count, so a double space between sentences reads
 *     as one extra word.
 *   - Newlines and tabs are not separators here, so an entry written one word
 *     per line counts as a single word. Normalising them costs three nested
 *     `replace()` calls and was judged not worth it until a real entry is found
 *     that it gets wrong.
 *   - An empty body is excluded by the leading length test, so a blank entry
 *     can't satisfy the count by arithmetic accident.
 *
 * **Encrypted entries are excluded explicitly**, by `is_encrypted = 0`, rather
 * than being left to fall out on their own. They would fall out anyway — an
 * encrypted entry's `content` column is blank and the real text lives in
 * `content_encrypted` (migration 0131) — but that is an accident of storage, not
 * a decision. A sealed body is unreadable without that entry's own password, so
 * its length genuinely cannot be judged, and saying so in the query keeps it
 * true if the blank-column detail ever changes. Same reasoning as the
 * `entry.isEncrypted` skip in `topWords`.
 */
export function buildBodyLengthSql(scope: JournalBodyScope): BodyLengthSql | undefined {
  if (scope === "all") return undefined;
  return {
    sql:
      `(length(trim(e.content)) > 0` +
      ` AND length(trim(e.content)) - length(replace(trim(e.content), ' ', '')) >= @${MIN_SPACES_PARAM}` +
      ` AND e.is_encrypted = 0)`,
    params: { [MIN_SPACES_PARAM]: SUBSTANTIAL_MIN_WORDS },
  };
}

/**
 * How many words `content` holds, by the same rule the SQL counts by.
 *
 * Space-separated, trimmed first, and n spaces means n+1 words — deliberately
 * the *same* arithmetic as `buildBodyLengthSql`, limitations included, so the
 * number shown in the Body Length column can never contradict the condition
 * that decided the row belongs there. A cleverer count here (splitting on
 * newlines, collapsing runs of spaces) would read better and would sometimes
 * disagree with the filter, which is worse: a reader would see "12 words" on a
 * row the tab had excluded, or "9" on a row it had let in.
 *
 * `0` for an empty or whitespace-only body, which is also what the condition
 * treats as "no body at all".
 */
export function countBodyWords(content: string): number {
  const trimmed = content.trim();
  if (trimmed.length === 0) return 0;
  const spaces = trimmed.length - trimmed.replace(/ /g, "").length;
  return spaces + 1;
}

/**
 * Whether `entry` would be listed by the `"substantial"` scope — the same test
 * the SQL above applies, in TypeScript.
 *
 * Exists so the rule can be unit-tested and reasoned about without a database,
 * and so a caller holding entries already in memory doesn't have to re-query to
 * ask the question. It is **not** what the tab uses: membership is decided in
 * SQL, because a client-side pass would only ever see the first 500 rows the
 * query returned and would disagree with the server about everything past them.
 *
 * Kept deliberately in step with `buildBodyLengthSql`, limitations included —
 * it counts spaces the same way, so the two agree on double spaces and on
 * newlines rather than one being quietly cleverer than the other.
 */
export function isSubstantialBody(entry: { content: string; isEncrypted: boolean }): boolean {
  if (entry.isEncrypted) return false;
  // Expressed through `countBodyWords` rather than repeating its arithmetic, so
  // the column and the condition cannot drift apart. "More than ten words" is a
  // strict `>`, which is why ten exactly is excluded.
  return countBodyWords(entry.content) > SUBSTANTIAL_MIN_WORDS;
}
