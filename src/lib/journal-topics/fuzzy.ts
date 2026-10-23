// Fuzzy term matching for Topics — "does this text mean the same thing as HSA?"
//
// Pure string functions, no repository and no I/O. Deliberately hand-rolled
// rather than pulling in a fuzzy-search dependency: the whole of it is trigram
// overlap plus three cheap pre-checks, it is readable in one sitting, and the
// Topics feature is not worth a new entry in package.json.
//
// The problem this solves is narrow. A reader types `HSA` and means the tag
// `HSA`, the tag `H.S.A.`, the category `Health Savings Account`, and a title
// that says "hsa reimbursement". It does NOT mean every entry containing the
// letters h, s and a. So the scoring below is deliberately conservative: it
// would rather miss a loose match than fill a graph with noise, because a
// hairball of false positives is the one failure mode that makes the whole
// screen useless.

/**
 * How similar two strings must be before they count as the same term.
 *
 * 0.5 is high for trigram similarity. It was picked against the failure that
 * matters: short acronyms share trigrams with surprisingly many words, and a
 * permissive threshold turns `HSA` into a match for "has a" and "Shasta". A
 * reader who wants the looser net can type a longer term; a reader drowning in
 * false edges has no recourse at all.
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.5;

/**
 * Terms at or below this length skip trigram scoring entirely and are matched
 * by the exact/acronym rules only.
 *
 * Three characters is one trigram, so similarity degenerates to a boolean at
 * that length while still reporting fractional-looking scores — misleading
 * precision. `HSA`, `IRA`, `401k` are exactly the terms a reader is most likely
 * to type, so getting this wrong would be felt immediately.
 */
const SHORT_TERM_LENGTH = 4;

/**
 * Strips a string to the characters that carry meaning for comparison.
 *
 * Lowercased, and everything that is not a letter or a digit removed outright
 * rather than collapsed to a space. That single choice is what makes `H.S.A.`,
 * `H S A` and `hsa` one term — the separators people sprinkle through an
 * acronym are noise, and keeping them as spaces would leave three one-letter
 * words that no trigram can bridge.
 *
 * The cost is that `re-sign` and `resign` normalize alike. Accepted: in a
 * journal's tag list that collision is vanishingly rare, and the alternative
 * loses every punctuated acronym, which is not.
 */
export function normalizeTerm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * The same normalization, but keeping word boundaries — used where words must
 * stay separate, such as building an acronym or matching whole words in a body.
 */
export function normalizeWords(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/**
 * The initials of a multi-word phrase: "Health Savings Account" -> "hsa".
 *
 * Returns `""` for a single word, because a one-word "acronym" is just the
 * word's first letter and would match nearly everything.
 */
export function acronymOf(value: string): string {
  const words = normalizeWords(value);
  if (words.length < 2) return "";
  return words.map((word) => word[0]).join("");
}

/**
 * The set of 3-character windows in a string, padded at both ends.
 *
 * Padding matters: without it, "cat" and "cats" share one trigram out of two
 * and three respectively, which understates how alike they are. Bracketing with
 * spaces makes the leading and trailing characters count, which is where short
 * words differ most.
 */
export function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const result = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i += 1) {
    result.add(padded.slice(i, i + 3));
  }
  return result;
}

/**
 * Jaccard overlap of two trigram sets, 0–1.
 *
 * Jaccard rather than a containment ratio, so that a short term is not scored
 * as a perfect match against a long phrase that happens to contain it. "art"
 * inside "Martha's party" should not read as the same term, and containment
 * would say it does.
 */
export function trigramSimilarity(a: string, b: string): number {
  if (a === "" || b === "") return 0;
  if (a === b) return 1;

  const left = trigrams(a);
  const right = trigrams(b);
  let shared = 0;
  for (const gram of left) {
    if (right.has(gram)) shared += 1;
  }
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * How strongly `candidate` means the same thing as `term`, 0–1.
 *
 * Four rules, in descending confidence, first match wins:
 *
 *   1. Identical once normalized            -> 1
 *   2. The candidate's acronym is the term  -> 0.95  ("Health Savings Account" ~ HSA)
 *   3. The term's acronym is the candidate  -> 0.95  (the same, written the other way)
 *   4. Trigram overlap                      -> its own score, or 0 below threshold
 *
 * Rules 2 and 3 score just under an exact match rather than equal to it, so a
 * literal tag always outranks an expansion when results are sorted — a reader
 * who typed `HSA` and has a tag spelled exactly that should see it first.
 *
 * A term of three characters or fewer skips rule 4 entirely (see
 * `SHORT_TERM_LENGTH`): for those, only an exact or acronym hit counts.
 */
export function termSimilarity(
  term: string,
  candidate: string,
  threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): number {
  const normalizedTerm = normalizeTerm(term);
  const normalizedCandidate = normalizeTerm(candidate);
  if (normalizedTerm === "" || normalizedCandidate === "") return 0;

  if (normalizedTerm === normalizedCandidate) return 1;

  if (normalizeTerm(acronymOf(candidate)) === normalizedTerm) return 0.95;
  if (normalizeTerm(acronymOf(term)) === normalizedCandidate) return 0.95;

  if (normalizedTerm.length < SHORT_TERM_LENGTH) return 0;

  const score = trigramSimilarity(normalizedTerm, normalizedCandidate);
  return score >= threshold ? score : 0;
}

/**
 * Whether `term` appears in `text` as a whole word (or as a run of adjacent
 * words matching the term's own words).
 *
 * Used for title and body matching, where trigram similarity is the wrong tool:
 * a 400-word entry shares few trigrams with a 3-letter term no matter how
 * prominently it features. Substring matching would be worse still — searching
 * `art` would hit "start", "party" and "heart".
 *
 * So: both sides are reduced to word lists and the term's words must appear
 * consecutively. "health savings" matches "my health savings account" and does
 * not match "health and savings".
 */
export function containsTermAsWords(text: string, term: string): boolean {
  const termWords = normalizeWords(term);
  if (termWords.length === 0) return false;

  const textWords = normalizeWords(text);
  if (textWords.length < termWords.length) return false;

  for (let i = 0; i + termWords.length <= textWords.length; i += 1) {
    let allMatch = true;
    for (let j = 0; j < termWords.length; j += 1) {
      if (textWords[i + j] !== termWords[j]) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return true;
  }
  return false;
}
