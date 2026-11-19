/**
 * Word Wizard's dictionary, as a compact prefix tree.
 *
 * The word list itself is a static file (`public/games/word-wizard-words.txt`, the
 * public-domain ENABLE list). This module never loads it: it takes the text and returns
 * a structure, so the browser, a test and the CLI all build one the same way.
 *
 * A trie rather than a `Set<string>` because the bot needs *prefixes* — "is there any
 * word starting Q-U-I?" — to prune its search, and a Set can only answer whole words.
 * The nodes live in typed arrays rather than as objects: ~400k nodes as objects is tens
 * of megabytes in a browser tab, as four parallel arrays it is a few.
 *
 * Each node stores its letter, whether a word ends there, its first child and its next
 * sibling. Children are a sibling list in alphabetical order, so finding one is a walk of
 * at most 26 steps.
 */

export interface WordWizardLexicon {
  /** Number of words. */
  readonly size: number;
  /** Letter code at each node, 0–25. The root's is unused. */
  readonly letter: Uint8Array;
  /** 1 where a word ends at this node. */
  readonly terminal: Uint8Array;
  /** First child's node index, or -1. */
  readonly firstChild: Int32Array;
  /** Next sibling's node index, or -1. */
  readonly nextSibling: Int32Array;
}

/** The root node. */
export const LEXICON_ROOT = 0;

const A_CODE = 65;

/** Words this game can hold: 2–15 letters A–Z. */
const WORD_PATTERN = /^[A-Z]{2,15}$/;

/**
 * Build a lexicon from a word list: one word per line, any case. Lines that are not
 * 2–15 plain letters are skipped rather than rejected, so a list with a stray header or
 * a hyphenated entry still loads.
 */
export function parseLexicon(text: string): WordWizardLexicon {
  const words = Array.from(
    new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.trim().toUpperCase())
        .filter((line) => WORD_PATTERN.test(line)),
    ),
  ).sort();
  return buildLexicon(words);
}

/**
 * Build from words that are already sorted, unique and upper-case.
 *
 * Sorted input is what makes this linear: each word shares a prefix with the one before
 * it, so only the rest needs new nodes, and a new child is always its parent's last.
 */
function buildLexicon(words: readonly string[]): WordWizardLexicon {
  const letter: number[] = [0];
  const terminal: number[] = [0];
  const firstChild: number[] = [-1];
  const nextSibling: number[] = [-1];
  const lastChild: number[] = [-1];

  // The node path of the previous word: path[i] is the node for its first i letters.
  let path: number[] = [LEXICON_ROOT];
  let previous = "";

  for (const word of words) {
    let common = 0;
    while (common < word.length && common < previous.length && word[common] === previous[common]) {
      common += 1;
    }
    path = path.slice(0, common + 1);
    for (let i = common; i < word.length; i += 1) {
      const parent = path[i];
      const node = letter.length;
      letter.push(word.charCodeAt(i) - A_CODE);
      terminal.push(0);
      firstChild.push(-1);
      nextSibling.push(-1);
      lastChild.push(-1);
      if (firstChild[parent] === -1) firstChild[parent] = node;
      else nextSibling[lastChild[parent]] = node;
      lastChild[parent] = node;
      path.push(node);
    }
    terminal[path[word.length]] = 1;
    previous = word;
  }

  return {
    size: words.length,
    letter: Uint8Array.from(letter),
    terminal: Uint8Array.from(terminal),
    firstChild: Int32Array.from(firstChild),
    nextSibling: Int32Array.from(nextSibling),
  };
}

/** The child of `node` for letter code `code` (0–25), or -1. */
export function lexiconChild(lexicon: WordWizardLexicon, node: number, code: number): number {
  for (let child = lexicon.firstChild[node]; child !== -1; child = lexicon.nextSibling[child]) {
    const at = lexicon.letter[child];
    if (at === code) return child;
    if (at > code) return -1;
  }
  return -1;
}

/** The node reached by spelling `prefix` from the root, or -1 when no word starts so. */
export function lexiconNode(lexicon: WordWizardLexicon, prefix: string): number {
  let node = LEXICON_ROOT;
  for (let i = 0; i < prefix.length && node !== -1; i += 1) {
    node = lexiconChild(lexicon, node, prefix.charCodeAt(i) - A_CODE);
  }
  return node;
}

/** Whether `word` (any case) is in the list. */
export function isLexiconWord(lexicon: WordWizardLexicon, word: string): boolean {
  const upper = word.toUpperCase();
  if (!WORD_PATTERN.test(upper)) return false;
  const node = lexiconNode(lexicon, upper);
  return node !== -1 && lexicon.terminal[node] === 1;
}
