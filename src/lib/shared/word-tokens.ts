// Splitting prose into comparable, meaningful words — the shared half of word ranking.
//
// Lives in `src/lib/shared/` rather than in a feature module because two modules now
// rank words and they must agree on what a word IS. The Journal ranks its own entries
// ("Top Words" on its home screen); the Document Library ranks the text recovered from
// filed files (its Keywords section). If each kept its own tokenizer and stopword list,
// the same prose would produce two different rankings and the lists would drift apart
// the first time either was tuned.
//
// `src/lib/journal/word-stats.ts` re-exports these, so every existing Journal caller is
// unchanged — the move is an extraction, not a rewrite. The Journal keeps everything
// specific to it (its excluded-words setting, `topWords` over `JournalEntry`); only the
// two pieces that are properties of *English* rather than of either module moved here.
//
// Pure functions over strings: no repository, no I/O, no React. Same rules as every
// other file in `src/lib/shared/`.

/**
 * The shortest word any ranking will consider.
 *
 * Three rather than one, so the single letters and two-letter function words
 * (`a`, `I`, `it`, `is`, `of`, `to`, `on`, `at`, `in`, `my`, `we`, `so`) drop out
 * on length alone instead of each needing a line in `STOPWORDS`. The cost is
 * that a genuinely meaningful short word is lost too — `dad`, `cat` and `job`
 * survive at three, but a two-letter name would not. Judged the better trade:
 * the alternative is a stopword list several times this size that still misses
 * one.
 */
export const MIN_WORD_LENGTH = 3;

/**
 * Words carrying no signal about what a text is *about*.
 *
 * Deliberately a fixed constant and not a setting: it is a property of English,
 * not a preference, and a per-module editable list would mean a settings row, a
 * screen and a migration for something nobody tunes twice. The Journal layers its
 * reader's own `excludedWords` on top of this rather than replacing it, and the
 * Document Library does the same with its noise list — this stays the floor.
 *
 * Only words of `MIN_WORD_LENGTH` or more are listed — anything shorter can
 * never reach the filter, so listing `the` matters but listing `an` would be
 * dead weight. Grouped by why each group is here, because a flat alphabetical
 * list invites duplicates.
 */
export const STOPWORDS: ReadonlySet<string> = new Set<string>([
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
 *
 * That last rule matters more for documents than it did for the Journal: OCR of a
 * scanned invoice produces a great deal of numeric debris, and excluding digits
 * here is what keeps an amount column out of the keyword ranking.
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
 * Puts a word into the form `tokenizeWords` compares against: lowercased, trimmed,
 * surrounding apostrophes and a possessive tail removed.
 *
 * Every write path that stores a word to match against tokens goes through this.
 * Storing `"Beach "` instead would leave a row that looks right in a settings list
 * and silently never matches a token, which is the most confusing way for a word
 * feature to fail. Returns `""` for anything that can't be a ranked word (blank,
 * too short, digits), and the caller rejects on that rather than storing an
 * unusable row.
 */
export function normalizeWord(raw: string): string {
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
 * Parses a stored comma-joined word list into usable words.
 *
 * Tolerant by design: the value is one hand-editable `sys_module_settings` row, so
 * blanks, stray spacing, casing and duplicates are all normalized away rather than
 * trusted. Order is preserved (first occurrence wins) so a list doesn't reshuffle on
 * every save.
 *
 * **Splits on commas only**, never on whitespace. A two-word phrase can never be a
 * token so it could not be ignored anyway, but splitting on spaces would silently turn
 * one nonsense entry into two — and the Document Library's prefill templates already
 * record (migration 0169) why comma-only splitting is the right rule for a list a
 * person types.
 */
export function parseWordList(stored: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const part of stored.split(",")) {
    const word = normalizeWord(part);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  return words;
}

/**
 * The inverse of `parseWordList` — normalized, deduped, comma-joined.
 *
 * `""` for an empty list, which the caller must turn into *removing* the setting row
 * rather than storing a blank: the module-settings schema rejects an empty value.
 */
export function serializeWordList(words: readonly string[]): string {
  return parseWordList(words.join(",")).join(",");
}
