import { PICTIONARY_TIERS, type PictionaryTier, type PictionaryWord } from "./types";

/**
 * Turning a pasted or uploaded list into words the game can draw from.
 *
 * Pure text in, parsed words out — no database, no file system, no request. The
 * repository writes what this returns, and the same function parses a CLI argument, an
 * uploaded `.txt` and a textarea paste, which is the point.
 *
 * **The format is deliberately forgiving.** What people have to hand is a list, and a
 * list arrives in whatever shape the thing that produced it used: one word a line, a
 * CSV with a header, a comma-separated run, a column pasted out of a spreadsheet. The
 * parser accepts all of those rather than making someone reformat a list to import it.
 */

/** A word that could not be imported, and why — so the screen can say which line. */
export interface PictionaryImportProblem {
  /** 1-based line number in the submitted text, for pointing at the offending row. */
  line: number;
  /** The text that was rejected, trimmed. Empty when the line held nothing usable. */
  value: string;
  reason: string;
}

/** What `parseWordList` found. */
export interface PictionaryImportParse {
  /** Words that passed, deduplicated within this submission. */
  words: readonly PictionaryWord[];
  /** Rows that did not, each with a reason. */
  problems: readonly PictionaryImportProblem[];
  /** Rows that were a duplicate of an earlier row in the SAME submission. */
  duplicates: number;
}

/**
 * The longest a prompt may be.
 *
 * A limit exists because the import accepts arbitrary text and someone will eventually
 * paste a paragraph; 40 characters comfortably fits the longest real prompt ("hot air
 * balloon" is 15) while rejecting a sentence that got in by accident.
 */
export const PICTIONARY_MAX_WORD_LENGTH = 40;

/**
 * What a prompt may contain: letters, spaces, hyphens and apostrophes.
 *
 * Digits and other punctuation are rejected for the reason the built-in bank has none —
 * the one rule Pictionary has is that the drawer may not write, and a prompt carrying a
 * digit invites them to draw the character instead of the idea. Hyphens and apostrophes
 * are allowed because real words have them ("t-shirt", "jack-o'-lantern") and neither
 * can be drawn as a character on its own.
 *
 * Unicode letters rather than `a-z`: a household that plays in another language should
 * be able to import its own words, and there is nothing in the game that needs ASCII.
 */
const ALLOWED_WORD = /^[\p{L}][\p{L} '-]*$/u;

/** Collapses internal runs of whitespace, so "hot   air  balloon" imports as one prompt. */
function normalise(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Whether `value` is a usable prompt, or why it isn't.
 *
 * Returns the reason rather than a boolean so the import screen can tell someone *which*
 * rule a line broke — "too long" and "contains a digit" need different fixes, and an
 * importer that just says "3 rows failed" makes them hunt.
 */
export function wordProblem(value: string): string | undefined {
  const word = normalise(value);
  if (word.length === 0) return "Empty.";
  if (word.length > PICTIONARY_MAX_WORD_LENGTH) {
    return `Longer than ${PICTIONARY_MAX_WORD_LENGTH} characters.`;
  }
  if (/\d/.test(word)) return "Contains a digit — a prompt must be drawable, not written.";
  if (!ALLOWED_WORD.test(word)) {
    return "Contains something other than letters, spaces, hyphens and apostrophes.";
  }
  return undefined;
}

/**
 * Whether `line` looks like a header row rather than a word.
 *
 * Checked only for the FIRST line, and only when it names a column: a list whose first
 * word happens to be "word" is a real prompt, but a CSV exported from a spreadsheet
 * starts `word,tier` and importing "word" as a prompt is never what was meant.
 */
function isHeader(cells: readonly string[]): boolean {
  if (cells.length === 0) return false;
  const first = cells[0].trim().toLowerCase();
  if (first !== "word" && first !== "words" && first !== "prompt") return false;
  // A bare "word" on its own line is ambiguous; treat it as a header only when a second
  // cell names the other column, which is what an exported file looks like.
  if (cells.length === 1) return true;
  const second = cells[1].trim().toLowerCase();
  return second === "tier" || second === "difficulty" || second === "level";
}

/** The tier a row named, when it named one this build knows. */
function tierFrom(value: string | undefined): PictionaryTier | undefined {
  if (!value) return undefined;
  const found = value.trim().toLowerCase();
  return PICTIONARY_TIERS.find((tier) => tier === found);
}

/**
 * Splits one line into cells.
 *
 * Commas, semicolons and tabs all separate, because all three turn up: a CSV uses
 * commas, a European spreadsheet exports semicolons, and a column pasted out of Excel
 * arrives tab-separated. Quoted cells are **not** unwrapped — a prompt cannot contain a
 * comma anyway (the character class rejects it), so quoting carries no information here
 * and a quote-aware parser would be apparatus for nothing.
 */
function cellsOf(line: string): readonly string[] {
  return line.split(/[,;\t]/);
}

/**
 * Parses a submitted list into words.
 *
 * `defaultTier` is used for any row that does not name its own, which is the common
 * case: most lists are a bare column of words imported into one tier. A row MAY name a
 * tier in a second column, and then that wins — it is how one file can carry all three.
 *
 * Deduplicates within the submission (case-insensitively, per tier, matching the
 * table's unique index) and reports how many it dropped. It does **not** know what is
 * already stored: that collision is the database's to resolve, so the repository
 * inserts with `OR IGNORE` and reports the difference. Doing it here would mean this
 * function needed a repository and stopped being pure.
 */
export function parseWordList(text: string, defaultTier: PictionaryTier): PictionaryImportParse {
  const words: PictionaryWord[] = [];
  const problems: PictionaryImportProblem[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  // `split` on any newline so a file written on Windows imports the same as one from a
  // phone; a stray \r left on the end of a cell would otherwise fail the character test.
  const lines = text.split(/\r\n|\r|\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (line.trim().length === 0) return; // Blank lines are not an error, just nothing.

    const cells = cellsOf(line);
    if (lineNumber === 1 && isHeader(cells)) return;

    // Several words on one line (a comma-separated run) are all imported, which is what
    // someone who pasted "cat, dog, house" meant. A row whose SECOND cell names a tier
    // is the other reading, and it wins — see the doc comment.
    const named = tierFrom(cells[1]);
    const tier = named ?? defaultTier;
    const values = named ? [cells[0]] : cells;

    for (const value of values) {
      if (value.trim().length === 0) continue;

      const reason = wordProblem(value);
      if (reason) {
        problems.push({ line: lineNumber, value: value.trim(), reason });
        continue;
      }

      const word = normalise(value);
      const key = `${tier}:${word.toLowerCase()}`;
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }

      seen.add(key);
      words.push({ word, tier });
    }
  });

  return { words, problems, duplicates };
}
