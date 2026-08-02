// Parser for James Clear's "3-2-1" newsletter — turns a pasted issue into quote
// candidates for review. Pure: text in, data out. No LLM and no network; the
// newsletter's structure (numbered section headings, Roman-numeral items, curly
// quotes, "Source:" footers) is regular enough to read deterministically.
//
// Deliberately format-specific. It reports what it could not place rather than
// guessing, so a change to the newsletter's layout fails visibly instead of
// quietly importing nonsense.

import type { QuoteCategory } from "./types";

export interface ParsedQuoteCandidate {
  quote: string;
  author: string;
  /** The citation under the quote, when the issue printed one. */
  source: string;
  /** Which part of the issue it came from — shown in the preview for context. */
  section: "Ideas" | "Quotes" | "Question";
  /** Free-text topic from the attribution line ("focus"), when present. */
  topic: string;
}

export interface ParsedNewsletter {
  candidates: ParsedQuoteCandidate[];
  /** Headings the parser recognised, for a "did it understand the issue?" check. */
  sectionsFound: string[];
  /** Anything structural it expected but didn't find. Surface these to the user. */
  warnings: string[];
}

const NEWSLETTER_AUTHOR = "James Clear";

// Zero-width and non-breaking characters ride along in pasted email text and
// would stop the section/numeral patterns from matching.
const INVISIBLE_CHARACTERS = /[​-‍﻿ ]/g;

const SECTION_PATTERNS: { pattern: RegExp; section: ParsedQuoteCandidate["section"] }[] = [
  { pattern: /^\d+\s+Ideas?\s+From\s+Me$/i, section: "Ideas" },
  { pattern: /^\d+\s+Quotes?\s+From\s+Others$/i, section: "Quotes" },
  { pattern: /^\d+\s+Questions?\s+For\s+You$/i, section: "Question" },
];

const ROMAN_NUMERAL_MARKER = /^(X{0,3})(IX|IV|V?I{0,3})\.$/;
const SOURCE_LINE = /^Source:\s*(.+)$/i;
const SIGN_OFF = /^(Until next week|Want to share this issue)/i;

/** Curly and straight quotation marks the newsletter may use. */
const OPENING_QUOTES = ['"', "“"];
const CLOSING_QUOTES = ['"', "”"];

function normalize(text: string): string[] {
  return text
    .replace(INVISIBLE_CHARACTERS, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim());
}

function matchSection(line: string): ParsedQuoteCandidate["section"] | undefined {
  for (const { pattern, section } of SECTION_PATTERNS) {
    if (pattern.test(line)) return section;
  }
  return undefined;
}

/**
 * Strips one layer of surrounding quotation marks, leaving quotations *inside*
 * the passage intact.
 *
 * The trailing mark is only removed when the passage's quote marks balance. A
 * multi-paragraph item can open with a quote and never close it, ending instead
 * on an internal quotation — the 30 July 2026 issue does exactly this, closing
 * on `"What is an inspiring way to live?"`. Stripping that final mark would
 * corrupt the nested question, so an odd count means "the opener has no partner"
 * and only the opener comes off.
 */
function stripOuterQuotes(text: string): string {
  let result = text.trim();
  const isBalanced = (result.match(/["“”]/g) ?? []).length % 2 === 0;
  if (OPENING_QUOTES.some((mark) => result.startsWith(mark))) result = result.slice(1);
  if (isBalanced && CLOSING_QUOTES.some((mark) => result.endsWith(mark))) {
    result = result.slice(0, -1);
  }
  return result.trim();
}

function looksQuoted(text: string): boolean {
  return OPENING_QUOTES.some((mark) => text.trimStart().startsWith(mark));
}

/**
 * Splits an attribution line such as
 *   "Investor Charlie Munger on hardship and perseverance:"
 *   "The 4th Earl of Chesterfield, Philip Dormer Stanhope, on focus:"
 * into an author and a topic. The topic is whatever follows the last " on ";
 * everything before it (minus a trailing comma) is the author. Returns no author
 * when the line doesn't look like an attribution at all.
 */
export function parseAttribution(line: string): { author: string; topic: string } | undefined {
  const trimmed = line.replace(/:$/, "").trim();
  if (trimmed === "" || trimmed.length > 200) return undefined;

  const onIndex = trimmed.toLowerCase().lastIndexOf(" on ");
  if (onIndex === -1) return { author: trimmed, topic: "" };

  const author = trimmed.slice(0, onIndex).replace(/,\s*$/, "").trim();
  const topic = trimmed.slice(onIndex + 4).trim();
  return { author: author === "" ? trimmed : author, topic };
}

interface Block {
  section: ParsedQuoteCandidate["section"];
  lines: string[];
}

/**
 * Parses a pasted 3-2-1 issue into quote candidates.
 *
 * Text is split into blocks by section heading and Roman-numeral marker rather
 * than by quotation marks — quote-pair scanning breaks on passages that quote
 * something internally.
 *
 * Each quoted paragraph inside a block becomes its own candidate (the Munger
 * item prints two), and a block's `Source:` footer is attached to every
 * candidate from that block.
 */
export function parseThreeTwoOneNewsletter(text: string): ParsedNewsletter {
  const lines = normalize(text);
  const warnings: string[] = [];
  const sectionsFound: string[] = [];

  const blocks: Block[] = [];
  let currentSection: ParsedQuoteCandidate["section"] | undefined;
  let currentBlock: Block | undefined;

  const closeBlock = () => {
    if (currentBlock && currentBlock.lines.length > 0) blocks.push(currentBlock);
    currentBlock = undefined;
  };

  for (const line of lines) {
    if (line === "" || /^[-–—_​]+$/.test(line)) continue;

    const section = matchSection(line);
    if (section) {
      closeBlock();
      currentSection = section;
      sectionsFound.push(line);
      // The single-question section has no numeral marker, so open its block now.
      if (section === "Question") currentBlock = { section, lines: [] };
      continue;
    }

    if (SIGN_OFF.test(line)) {
      closeBlock();
      currentSection = undefined;
      continue;
    }

    if (!currentSection) continue; // preamble ("Here are 3 ideas...") is ignored

    if (ROMAN_NUMERAL_MARKER.test(line)) {
      closeBlock();
      currentBlock = { section: currentSection, lines: [] };
      continue;
    }

    if (currentBlock) currentBlock.lines.push(line);
  }
  closeBlock();

  const candidates: ParsedQuoteCandidate[] = [];

  for (const block of blocks) {
    const sourceIndex = block.lines.findIndex((line) => SOURCE_LINE.test(line));
    const source =
      sourceIndex === -1 ? "" : (SOURCE_LINE.exec(block.lines[sourceIndex])?.[1] ?? "").trim();
    const body = sourceIndex === -1 ? block.lines : block.lines.slice(0, sourceIndex);
    if (body.length === 0) continue;

    if (block.section === "Question") {
      // Not a quotation: the closing section is a prompt, sometimes preceded by a
      // lead-in line. The question itself is the last line.
      const question = body[body.length - 1];
      if (question) {
        candidates.push({
          quote: stripOuterQuotes(question),
          author: NEWSLETTER_AUTHOR,
          source,
          section: "Question",
          topic: "",
        });
      }
      continue;
    }

    // A leading unquoted line in the "Quotes From Others" section is the
    // attribution; ideas are unattributed and credited to the newsletter's author.
    let author = NEWSLETTER_AUTHOR;
    let topic = "";
    let quoteLines = body;
    if (block.section === "Quotes" && !looksQuoted(body[0])) {
      const attribution = parseAttribution(body[0]);
      if (attribution) {
        author = attribution.author;
        topic = attribution.topic;
      }
      quoteLines = body.slice(1);
    }

    const quotedParagraphs = quoteLines.filter(looksQuoted);
    // Each quoted paragraph is its own candidate. Unquoted continuation lines of
    // a multi-paragraph passage are appended to the paragraph they follow.
    const passages: string[] = [];
    for (const line of quoteLines) {
      if (looksQuoted(line) || passages.length === 0) passages.push(line);
      else passages[passages.length - 1] += `\n\n${line}`;
    }

    if (quotedParagraphs.length === 0 && block.section === "Quotes") {
      warnings.push(`No quoted text found for "${author}".`);
    }

    for (const passage of passages) {
      const quote = stripOuterQuotes(passage);
      if (quote === "") continue;
      candidates.push({ quote, author, source, section: block.section, topic });
    }
  }

  for (const { pattern, section } of SECTION_PATTERNS) {
    if (!sectionsFound.some((heading) => pattern.test(heading))) {
      warnings.push(`No "${section}" section heading was found.`);
    }
  }
  if (candidates.length === 0) warnings.push("No quotes could be extracted from this text.");

  return { candidates, sectionsFound, warnings };
}

/** The category new candidates start on; the reviewer changes it per quote. */
export const DEFAULT_IMPORT_CATEGORY: QuoteCategory = "Wisdom";
