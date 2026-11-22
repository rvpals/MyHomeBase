/**
 * What a Word Wizard word means, from Wiktionary.
 *
 * The game's dictionary (ENABLE) is a word-game list: it says a word is *allowed*, not
 * what it means, and the bot happily plays QI, ZA or AALII. This looks the word up so a
 * player can tap it and see it is real.
 *
 * Wiktionary rather than a general dictionary API because those miss most of the short
 * word-game words, which are exactly the ones a player is suspicious of. The service is
 * free and keyless; only the word itself is sent.
 *
 * The fetch is a parameter so the tests never touch the network, and answers are cached
 * in memory (found and not-found alike — a word does not gain a definition mid-game).
 * Failures are not cached, so a timeout can be retried.
 */

import { lookupWordDefinitionSchema } from "./schema";

const WIKTIONARY_DEFINITION_URL = "https://en.wiktionary.org/api/rest_v1/page/definition/";
// Wikimedia asks automated clients to identify themselves; kept generic on purpose.
const USER_AGENT = "home-word-game/1.0 (personal, non-commercial definition lookup)";
const TIMEOUT_MS = 6000;
/** Meanings shown per word — enough to prove it is real without a wall of text. */
export const MAX_DEFINITIONS = 3;
const CACHE_LIMIT = 500;

export interface WordDefinitionEntry {
  /** "Noun", "Verb" … as Wiktionary labels it. */
  partOfSpeech: string;
  /** Plain text, HTML stripped. */
  definition: string;
}

export type WordDefinitionResult =
  | { status: "found"; word: string; entries: WordDefinitionEntry[] }
  | { status: "not-found"; word: string }
  | { status: "error"; word: string; message: string };

export type DefinitionFetch = (url: string, init: RequestInit) => Promise<Response>;

const cache = new Map<string, WordDefinitionResult>();

/** Test hook: forget every cached answer. */
export function clearWordDefinitionCache(): void {
  cache.clear();
}

/** Look up one word. Never throws: a bad word or a network failure comes back as `error`. */
export async function lookupWordDefinition(
  input: unknown,
  fetchImpl: DefinitionFetch,
): Promise<WordDefinitionResult> {
  const parsed = lookupWordDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    const raw = typeof (input as { word?: unknown })?.word === "string" ? (input as { word: string }).word : "";
    return { status: "error", word: raw, message: parsed.error.issues[0]?.message ?? "Not a word." };
  }
  const word = parsed.data.word.toUpperCase();
  const cached = cache.get(word);
  if (cached) return cached;

  let response: Response;
  try {
    response = await fetchImpl(WIKTIONARY_DEFINITION_URL + encodeURIComponent(word.toLowerCase()), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { status: "error", word, message: "The dictionary didn't answer. Try again in a moment." };
  }

  let result: WordDefinitionResult;
  if (response.status === 404) {
    result = { status: "not-found", word };
  } else if (!response.ok) {
    return { status: "error", word, message: `The dictionary answered ${response.status}. Try again later.` };
  } else {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "error", word, message: "The dictionary sent something unreadable." };
    }
    const entries = parseWiktionaryDefinitions(body);
    result = entries.length > 0 ? { status: "found", word, entries } : { status: "not-found", word };
  }

  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(word, result);
  return result;
}

interface WiktionaryUsage {
  partOfSpeech?: unknown;
  definitions?: unknown;
}

/**
 * Pull up to `MAX_DEFINITIONS` English meanings out of Wiktionary's response, which is
 * `{ en: [{ partOfSpeech, definitions: [{ definition: "<html>" }] }], …other languages }`.
 * Empty definitions (Wiktionary has some for inflected forms) are skipped.
 */
export function parseWiktionaryDefinitions(body: unknown): WordDefinitionEntry[] {
  const english = (body as { en?: unknown } | null)?.en;
  if (!Array.isArray(english)) return [];
  const entries: WordDefinitionEntry[] = [];
  for (const usage of english as WiktionaryUsage[]) {
    if (!Array.isArray(usage.definitions)) continue;
    const partOfSpeech = typeof usage.partOfSpeech === "string" ? usage.partOfSpeech : "";
    for (const item of usage.definitions as { definition?: unknown }[]) {
      if (typeof item?.definition !== "string") continue;
      const definition = htmlToText(item.definition);
      if (!definition) continue;
      entries.push({ partOfSpeech, definition });
      if (entries.length >= MAX_DEFINITIONS) return entries;
    }
  }
  return entries;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

/** Strip tags and decode the handful of entities Wiktionary uses. Plain text only — never rendered as HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, name: string) => {
      const key = name.toLowerCase();
      if (key in ENTITIES) return ENTITIES[key];
      if (key.startsWith("#x")) return String.fromCodePoint(parseInt(key.slice(2), 16));
      if (key.startsWith("#")) return String.fromCodePoint(parseInt(key.slice(1), 10));
      return match;
    })
    .replace(/\s+/g, " ")
    .trim();
}
