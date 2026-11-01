// Ranking the words the library actually contains — what the Keywords section lists.
//
// The question this answers is "what is in my filing cabinet?", which is the opposite
// of the question the search box answers. Search starts from a word the reader already
// has in mind; this starts from no word at all and offers the vocabulary back, ranked,
// so a reader can discover that forty of their documents mention `allstate` without
// ever having thought to type it.
//
// ## Why this tokenizes in TypeScript rather than reading FTS5's vocabulary table
//
// SQLite's `fts5vocab` would give term counts straight out of the existing index, with
// no scan and no tokenizer — and it was the first design. It was rejected for two
// reasons, in this order:
//
//  1. **Titles are not in the FTS index.** `doc_text_fts` indexes attachment bodies
//     only; a document's title and description are matched with LIKE in `listDocuments`.
//     A ranking built from the vocab table alone could not see the word `insurance` in
//     a document *titled* "Car Insurance" with no indexed files, which is exactly the
//     kind of document this screen exists to surface.
//  2. **Its vocabulary is raw.** `unicode61` keeps every token it sees, so the top of
//     that list is `the`, `and`, `for`, `was` — measured, not assumed. Useful output
//     needs the stopword filter and the length floor in `shared/word-tokens.ts`
//     anyway, and once those are applied in TypeScript the vocab table has saved
//     nothing.
//
// The cost is honest and worth stating: ranking reads every cached text row into
// memory. That is bounded by `KEYWORD_SCAN_LIMIT` rather than left open — see its note.
//
// ## Why there is no `doc_keywords` table
//
// A stored ranking would be a cache of a cache. `doc_attachment_text` is already the
// cache — the extracted text is explicitly disposable and rebuildable from the files
// (migration 0165) — and a keyword table on top of it would need invalidating every
// time a file is re-OCR'd, re-uploaded or deleted. Three write paths that currently
// touch one table would have to remember to touch two, and the failure mode of
// forgetting is a keyword list that quietly describes documents that no longer say
// that word. Computing on read cannot go stale.

import { listDocuments } from "./documents";
import type { DocumentsRepository } from "./ports";
import type { DocumentSummary } from "./types";
import { normalizeWord, tokenizeWords } from "@/lib/shared/word-tokens";

/**
 * One ranked keyword and the two different counts a reader might mean by "how often".
 *
 * Both are kept because they answer different questions and the better one depends on
 * what the reader is doing. "Appears in 7 documents" is the useful figure when the goal
 * is to *find* documents, which is what this screen is for — so it is the default sort.
 * "Used 40 times" tells you how central the word is to the text that does mention it: a
 * word with 40 occurrences across 2 documents is a letterhead, one with 40 across 38 is
 * a subject.
 */
export interface DocumentKeyword {
  /** The normalized word, exactly as `tokenizeWords` emits it — lowercase. */
  word: string;
  /**
   * How many documents contain it at least once.
   *
   * The default ranking. Counted per document, not per attachment: a word on all six
   * pages of one lease is one document, because the reader clicking it gets one row.
   */
  documentCount: number;
  /** Total occurrences across every document — a word used four times counts four. */
  occurrences: number;
}

/** What a ranking run was asked for. */
export interface KeywordRankingOptions {
  /**
   * How many keywords to return, most documents first. Defaults to
   * `DEFAULT_KEYWORD_LIMIT`.
   */
  limit?: number;
  /**
   * Words to drop on top of the shared stopword list, normalized on the way in.
   *
   * Layered rather than replacing: the shared list is a property of English and stays
   * the floor. This is for the noise a *filing cabinet* has and prose does not — a
   * letterhead, a scanner's footer, the household's own surname on every form.
   */
  excludedWords?: readonly string[];
}

/**
 * The most keywords a ranking will return when the caller does not say.
 *
 * 200 rather than 10 (what the Journal's Top Words shows) because this is a screen of
 * its own with a filter box over it, not a home-screen widget: the reader is here to
 * browse the vocabulary, and a filter box over ten rows would be pointless furniture.
 */
export const DEFAULT_KEYWORD_LIMIT = 200;

/**
 * The most text rows one ranking will read.
 *
 * The brake on the design trade named at the top of this file. A household library of a
 * few hundred documents is nowhere near this; a library that has OCR'd tens of
 * thousands of scanned pages would be, and reading all of it into memory on every page
 * load would make the screen progressively slower in a way nobody would attribute to
 * this function.
 *
 * Capping is the honest failure: the ranking describes the most recently indexed
 * `KEYWORD_SCAN_LIMIT` files and `rankDocumentKeywords` reports that it did so through
 * `scanLimited`, so the screen can say as much. The alternative — getting slower
 * forever and never saying why — is worse. If this ceiling is ever actually reached in
 * practice, that is the signal to revisit `fts5vocab` with a stopword filter rather
 * than to raise the number.
 */
export const KEYWORD_SCAN_LIMIT = 5_000;

/** A ranking, plus what it had to leave out to produce it. */
export interface KeywordRanking {
  keywords: DocumentKeyword[];
  /** Distinct words found before `limit` was applied — what the heading counts. */
  totalWords: number;
  /** Documents the ranking actually looked at: titles, descriptions and indexed text. */
  documentsScanned: number;
  /**
   * True when `KEYWORD_SCAN_LIMIT` capped the read, so the list describes part of the
   * library rather than all of it. The view says so rather than quietly under-reporting.
   */
  scanLimited: boolean;
}

/**
 * Ranks every word in the library's titles, descriptions and extracted text.
 *
 * Title and description count alongside the file contents, which is what makes a
 * document with no indexed files still reachable here. They are *not* weighted higher
 * than body text: a title word is one occurrence like any other. Weighting was
 * considered and dropped — any multiplier would be a number with no defensible value,
 * and the document count (the default sort) is unaffected by it either way.
 */
export function rankDocumentKeywords(
  repo: DocumentsRepository,
  options: KeywordRankingOptions = {},
): KeywordRanking {
  const limit = options.limit ?? DEFAULT_KEYWORD_LIMIT;
  const extra = new Set(
    (options.excludedWords ?? []).map(normalizeWord).filter((word) => word !== ""),
  );

  // Every document, so a title-only match ranks. This is the one projection
  // `listDocuments` returns — counts and sizes, not attachment rows — so it is a single
  // cheap query however large the library is.
  const documents = listDocuments(repo);

  // One more than the cap, so "did this bind?" is answered by the read itself rather
  // than by a second counting query.
  const texts = repo.listAllAttachmentText(KEYWORD_SCAN_LIMIT + 1);
  const scanLimited = texts.length > KEYWORD_SCAN_LIMIT;
  const scanned = scanLimited ? texts.slice(0, KEYWORD_SCAN_LIMIT) : texts;

  // Occurrences total across everything; documents are counted through a set per word,
  // so the same word on six pages of one lease adds six occurrences and one document.
  const occurrences = new Map<string, number>();
  const documentsByWord = new Map<string, Set<number>>();

  const count = (word: string, documentId: number): void => {
    occurrences.set(word, (occurrences.get(word) ?? 0) + 1);
    let seen = documentsByWord.get(word);
    if (!seen) {
      seen = new Set<number>();
      documentsByWord.set(word, seen);
    }
    seen.add(documentId);
  };

  for (const document of documents) {
    // Joined with a space so the last word of the title cannot fuse with the first of
    // the description.
    for (const word of tokenizeWords(`${document.title} ${document.description}`, extra)) {
      count(word, document.id);
    }
  }

  for (const text of scanned) {
    for (const word of tokenizeWords(text.body, extra)) {
      count(word, text.documentId);
    }
  }

  // Ties break alphabetically, so the list is stable: two words with the same document
  // count would otherwise swap places between renders depending on the order the rows
  // came back in, which reads as the page flickering.
  const ranked = [...documentsByWord.entries()]
    .map(([word, documentIds]) => ({
      word,
      documentCount: documentIds.size,
      occurrences: occurrences.get(word) ?? 0,
    }))
    .sort(
      (left, right) =>
        right.documentCount - left.documentCount ||
        right.occurrences - left.occurrences ||
        left.word.localeCompare(right.word),
    );

  // The documents actually represented in the ranking: every document contributed its
  // title, so this is the whole library rather than only the indexed part.
  return {
    keywords: limit <= 0 ? [] : ranked.slice(0, limit),
    totalWords: ranked.length,
    documentsScanned: documents.length,
    scanLimited,
  };
}

/**
 * The documents one keyword appears in — what a click on a keyword row opens.
 *
 * Deliberately **not** `searchAttachmentText`. That is the reader's search box: it
 * takes typed words, quotes them into an FTS expression and falls back to a LIKE scan.
 * This takes a word that came out of `tokenizeWords` and must match on exactly the
 * rule that ranked it, or the screen would say `lease` appears in 7 documents and then
 * list 6. Matching the ranking is the whole contract of this function.
 *
 * Returns the same `DocumentSummary` projection the rest of the module lists, so the
 * drill-down draws the rows every other documents screen draws.
 */
export function findDocumentsForKeyword(
  repo: DocumentsRepository,
  keyword: string,
): DocumentSummary[] {
  const word = normalizeWord(keyword);
  // An unrankable word (blank, too short, digits) can never have been in the list that
  // was clicked, so there is nothing to look up. Empty rather than throwing: this is
  // reached from a URL, and a hand-edited one should show no documents, not an error.
  if (word === "") return [];

  const documents = listDocuments(repo);

  const matched = new Set<number>();

  for (const document of documents) {
    if (tokenizeWords(`${document.title} ${document.description}`).includes(word)) {
      matched.add(document.id);
    }
  }

  // The same cap the ranking uses, for the same reason — and so that a capped ranking
  // and this lookup agree about which files they have seen.
  for (const text of repo.listAllAttachmentText(KEYWORD_SCAN_LIMIT)) {
    // Skipped when the document already matched on its title: tokenizing a long OCR'd
    // body to confirm something already known is the expensive half of this loop.
    if (matched.has(text.documentId)) continue;
    if (tokenizeWords(text.body).includes(word)) matched.add(text.documentId);
  }

  return documents.filter((document) => matched.has(document.id));
}
