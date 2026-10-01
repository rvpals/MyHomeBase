// Word frequency across the journal's own prose — what the home screen's
// "Top 10 Words" list ranks, beside Top Tags and Top Categories.
//
// Pure functions over entries that are already in memory: no repository, no I/O,
// no cache. The caller reads the entries and hands them in, which is what lets
// the whole thing be unit-tested without a database.

import type { JournalEntry } from "./types";

/** One ranked word and how many times it was used. */
export interface JournalWordCount {
  word: string;
  /**
   * Total occurrences across every entry, **not** the number of entries
   * containing it — a word used four times in one entry counts four.
   */
  count: number;
}

/**
 * The shortest word the ranking will consider.
 *
 * Three rather than one, so the single letters and two-letter function words
 * (`a`, `I`, `it`, `is`, `of`, `to`, `on`, `at`, `in`, `my`, `we`, `so`) drop out
 * on length alone instead of each needing a line in `STOPWORDS`. The cost is
 * that a genuinely meaningful short word is lost too — `dad`, `cat` and `job`
 * survive at three, but a two-letter name would not. Judged the better trade:
 * the alternative is a stopword list several times this size that still misses
 * one.
 */
const MIN_WORD_LENGTH = 3;

/**
 * Words carrying no signal about what a journal is *about*.
 *
 * Deliberately a fixed constant and not a setting: it is a property of English,
 * not a preference, and a per-journal editable list would mean a settings row, a
 * screen and a migration for something nobody tunes twice. If that turns out to
 * be wrong, this becomes the default for that setting rather than being replaced.
 *
 * Only words of `MIN_WORD_LENGTH` or more are listed — anything shorter can
 * never reach the filter, so listing `the` matters but listing `an` would be
 * dead weight. Grouped by why each group is here, because a flat alphabetical
 * list invites duplicates.
 */
const STOPWORDS = new Set<string>([
  // Articles, demonstratives, quantifiers.
  "the", "this", "that", "these", "those", "there", "here",
  "all", "any", "both", "each", "few", "more", "most", "other", "some", "such",
  "than", "too", "very", "much", "many", "lot", "lots",
  // Pronouns and possessives.
  "you", "your", "yours", "she", "her", "hers", "him", "his", "its",
  "our", "ours", "they", "them", "their", "theirs", "myself", "yourself",
  "himself", "herself", "itself", "ourselves", "themselves", "who", "whom", "whose",
  // Auxiliaries and the highest-frequency verbs. `had`/`has`/`have` and
  // `was`/`were` dominate any narrative text and say nothing about its subject.
  "was", "were", "been", "being", "are", "and", "but", "not",
  "has", "had", "have", "having", "did", "does", "doing", "done",
  "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  "get", "got", "getting", "went", "goes", "going", "come", "came", "coming",
  // Prepositions and conjunctions at or above the length floor.
  "for", "with", "from", "into", "onto", "out", "off", "over", "under",
  "about", "after", "before", "between", "during", "through", "above", "below",
  "again", "then", "once", "because", "while", "until", "since", "also",
  // Time words a dated journal repeats structurally — every entry already
  // carries its date, so "today" in the text is noise.
  "today", "tomorrow", "yesterday", "day", "days", "week", "weeks",
  "month", "months", "year", "years", "time", "times", "morning", "afternoon",
  "evening", "night", "when", "where", "what", "how", "why",
  // Clock and calendar fragments the calendar importer writes into content.
  "am", "pm",
  // Vague filler that ranks high and means nothing on its own.
  "just", "like", "really", "well", "back", "even", "still", "way",
  "thing", "things", "something", "anything", "nothing", "everything",
  "good", "nice", "great", "bit", "one", "two", "first", "last", "next",
]);

/**
 * Splits text into comparable words.
 *
 * Lowercased so `Beach` and `beach` are one word. Apostrophes are kept *inside* a
 * word (`don't`, `mum's`) rather than splitting it into `don` + `t`, then the
 * possessive tail is dropped so `mum's` and `mum` rank together — but a leading
 * or trailing quote is not part of the word. Digits are excluded entirely: a bare
 * `2024` or `30` is never an interesting "most used word", and mixed tokens like
 * `5km` are dropped with them rather than being given a special rule.
 */
export function tokenizeWords(text: string, extraStopwords?: ReadonlySet<string>): string[] {
  const words: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z'’]+/)) {
    // Strip surrounding apostrophes, then a possessive ending.
    const word = raw.replace(/^['’]+|['’]+$/g, "").replace(/['’]s$/, "");
    if (word.length < MIN_WORD_LENGTH) continue;
    if (STOPWORDS.has(word)) continue;
    if (extraStopwords?.has(word)) continue;
    words.push(word);
  }
  return words;
}

/**
 * Puts a word into the form the tokenizer compares against: lowercased, trimmed,
 * surrounding apostrophes and a possessive tail removed.
 *
 * Every write path goes through this. Storing `"Beach "` instead would leave a
 * row that looks right in the Preferences list and silently never matches a
 * token, which is the most confusing way for this feature to fail. Returns `""`
 * for anything that can't be a ranked word (blank, too short, digits), and the
 * caller rejects on that rather than storing an unusable row.
 */
export function normalizeExcludedWord(raw: string): string {
  const word = raw
    .trim()
    .toLowerCase()
    .replace(/^['’]+|['’]+$/g, "")
    .replace(/['’]s$/, "");
  if (word.length < MIN_WORD_LENGTH) return "";
  // The tokenizer only ever emits [a-z'’], so anything else could never match.
  if (!/^[a-z'’]+$/.test(word)) return "";
  return word;
}

/**
 * Parses the stored `excluded_words` setting into a word list.
 *
 * Tolerant by design: the value is a comma-joined string in a hand-editable
 * settings row, so blanks, stray spacing, casing and duplicates are all
 * normalized away rather than trusted. Order is preserved (first occurrence
 * wins) so the Preferences list doesn't reshuffle on every save.
 */
export function parseExcludedWords(stored: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const part of stored.split(",")) {
    const word = normalizeExcludedWord(part);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  return words;
}

/**
 * The inverse of `parseExcludedWords` — normalized, deduped, comma-joined.
 *
 * `""` for an empty list, which the caller must turn into *removing* the
 * setting row rather than storing a blank: the module-settings schema rejects an
 * empty value.
 */
export function serializeExcludedWords(words: readonly string[]): string {
  return parseExcludedWords(words.join(",")).join(",");
}

/**
 * The `limit` most-used words across every entry's title and content, most used
 * first.
 *
 * Ties break alphabetically, so the list is stable: two words used the same
 * number of times would otherwise swap places between renders depending on the
 * order the entries came back in, which reads as the page flickering.
 *
 * Returns fewer than `limit` when the journal doesn't have that many distinct
 * words, and an empty array for an empty journal — the caller renders its own
 * empty state rather than being handed placeholder rows.
 */
export function topWords(
  entries: readonly JournalEntry[],
  limit = 10,
  excludedWords: readonly string[] = [],
): JournalWordCount[] {
  if (limit <= 0) return [];

  // Layered on top of STOPWORDS rather than replacing it: the built-in list is a
  // property of English and stays the floor, while this is the reader's own set
  // of dismissals. Normalized on the way in so a hand-edited settings row with
  // odd casing still matches.
  const extra = new Set(excludedWords.map(normalizeExcludedWord).filter(Boolean));

  const counts = new Map<string, number>();
  for (const entry of entries) {
    // Title and content both count, so a word used only in titles still ranks.
    // Joined with a space so the last word of the title can't fuse with the
    // first of the content.
    for (const word of tokenizeWords(`${entry.title} ${entry.content}`, extra)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((left, right) => right.count - left.count || left.word.localeCompare(right.word))
    .slice(0, limit);
}
