import {
  WORD_WIZARD_BLANK,
  WORD_WIZARD_CENTRE,
  WORD_WIZARD_FULL_RACK_BONUS,
  WORD_WIZARD_RACK_SIZE,
  WORD_WIZARD_SIZE,
  type WordWizardBotLevel,
  type WordWizardCell,
  type WordWizardPlacement,
  type WordWizardState,
} from "./types";
import {
  canSwap,
  currentPlayer,
  isBoardEmpty,
  neighbours,
  passTurn,
  playTiles,
  swapTiles,
  wordsFormed,
  type Random,
} from "./game-word-wizard";
import {
  LEXICON_ROOT,
  isLexiconWord,
  lexiconChild,
  type WordWizardLexicon,
} from "./word-wizard-lexicon";

// The Word Wizard bot. It finds every legal play for its rack, scores each with the same
// `wordsFormed` a person is scored by, and picks one according to its level.
//
// The search is the standard one for crossword tile games: work one line at a time,
// start only from *anchors* (empty squares touching a tile), grow a left part out of the
// rack into the empty squares before the anchor, then extend right through the
// dictionary's prefix tree, testing each square against a precomputed *cross-check* —
// the set of letters that would make a valid word in the other direction. Every move it
// records is therefore legal by construction; `playTiles` still checks it, as it would
// any player's.

/** One legal play and its score. */
export interface WordWizardCandidate {
  placements: WordWizardPlacement[];
  score: number;
  words: string[];
}

const ALL_LETTERS = (1 << 26) - 1;
const BLANK_SLOT = 26;
const A_CODE = 65;

/**
 * Search steps before the bot stops looking. A rack with two blanks on an open board can
 * branch into millions of partial words; a cap keeps the bot's turn under a second on a
 * phone at the cost, in that rare case, of not seeing every play.
 */
const SEARCH_BUDGET = 1_500_000;

type Axis = "across" | "down";

function indexOf(axis: Axis, line: number, position: number): number {
  return axis === "across" ? line * WORD_WIZARD_SIZE + position : position * WORD_WIZARD_SIZE + line;
}

/**
 * For each empty square, the letters allowed there given the tiles above and below it
 * (for an across play) or left and right of it (for a down play). A square with no
 * neighbours in that direction allows everything.
 */
function crossChecks(
  board: readonly (WordWizardCell | null)[],
  axis: Axis,
  lexicon: WordWizardLexicon,
): Int32Array {
  const masks = new Int32Array(board.length).fill(ALL_LETTERS);
  const step = axis === "across" ? WORD_WIZARD_SIZE : 1; // the *perpendicular* step
  const inLine = (from: number, to: number) =>
    axis === "across" ? true : Math.floor(from / WORD_WIZARD_SIZE) === Math.floor(to / WORD_WIZARD_SIZE);

  for (let i = 0; i < board.length; i += 1) {
    if (board[i]) continue;
    let before = "";
    for (let j = i - step; j >= 0 && board[j] && inLine(i, j); j -= step) before = (board[j] as WordWizardCell).letter + before;
    let after = "";
    for (let j = i + step; j < board.length && board[j] && inLine(i, j); j += step) after += (board[j] as WordWizardCell).letter;
    if (before === "" && after === "") continue;
    let mask = 0;
    for (let code = 0; code < 26; code += 1) {
      if (isLexiconWord(lexicon, before + String.fromCharCode(A_CODE + code) + after)) mask |= 1 << code;
    }
    masks[i] = mask;
  }
  return masks;
}

function anchorsOf(board: readonly (WordWizardCell | null)[]): boolean[] {
  if (isBoardEmpty(board)) return board.map((_, i) => i === WORD_WIZARD_CENTRE);
  return board.map((cell, i) => cell === null && neighbours(i).some((n) => board[n] !== null));
}

/** Every legal play for the current player, unsorted. */
export function findPlays(state: WordWizardState, lexicon: WordWizardLexicon): WordWizardCandidate[] {
  const board = state.board;
  const rack = currentPlayer(state).rack;
  const anchors = anchorsOf(board);
  const found = new Map<string, WordWizardCandidate>();
  let budget = SEARCH_BUDGET;

  // Rack tile ids by letter code, blanks in slot 26, used as stacks.
  const pool: number[][] = Array.from({ length: 27 }, () => []);
  for (const tile of rack) {
    pool[tile.letter === WORD_WIZARD_BLANK ? BLANK_SLOT : tile.letter.charCodeAt(0) - A_CODE].push(tile.id);
  }

  interface Laid {
    index: number;
    tileId: number;
    code: number;
    blank: boolean;
  }

  const record = (laid: readonly Laid[]) => {
    if (laid.length === 0) return;
    const key = laid
      .map((l) => `${l.index}:${l.code}:${l.blank ? 1 : 0}`)
      .sort()
      .join(",");
    if (found.has(key)) return;
    const placed = new Map(
      laid.map((l) => [l.index, { letter: String.fromCharCode(A_CODE + l.code), blank: l.blank }]),
    );
    const words = wordsFormed(board, placed);
    const score =
      words.reduce((sum, w) => sum + w.score, 0) +
      (laid.length === WORD_WIZARD_RACK_SIZE ? WORD_WIZARD_FULL_RACK_BONUS : 0);
    found.set(key, {
      placements: laid.map((l) => ({
        index: l.index,
        tileId: l.tileId,
        ...(l.blank ? { letter: String.fromCharCode(A_CODE + l.code) } : {}),
      })),
      score,
      words: words.map((w) => w.word),
    });
  };

  const axes: Axis[] = isBoardEmpty(board) ? ["across"] : ["across", "down"];
  for (const axis of axes) {
    const checks = crossChecks(board, axis, lexicon);

    for (let line = 0; line < WORD_WIZARD_SIZE; line += 1) {
      const at = (position: number) => indexOf(axis, line, position);
      const laid: Laid[] = [];

      const extendRight = (node: number, position: number, anchor: number) => {
        if (--budget < 0) return;
        if (position >= WORD_WIZARD_SIZE) {
          if (position > anchor && lexicon.terminal[node]) record(laid);
          return;
        }
        const index = at(position);
        const cell = board[index];
        if (cell) {
          const child = lexiconChild(lexicon, node, cell.letter.charCodeAt(0) - A_CODE);
          if (child !== -1) extendRight(child, position + 1, anchor);
          return;
        }
        if (position > anchor && lexicon.terminal[node]) record(laid);
        const allowed = checks[index];
        for (let child = lexicon.firstChild[node]; child !== -1; child = lexicon.nextSibling[child]) {
          const code = lexicon.letter[child];
          if (!(allowed & (1 << code))) continue;
          for (const slot of [code, BLANK_SLOT]) {
            const ids = pool[slot];
            if (ids.length === 0) continue;
            const tileId = ids.pop() as number;
            laid.push({ index, tileId, code, blank: slot === BLANK_SLOT });
            extendRight(child, position + 1, anchor);
            laid.pop();
            ids.push(tileId);
          }
        }
      };

      // Left parts are built right-to-left in letters but laid left-to-right, so they
      // are kept as a list of letters and given their squares only when complete.
      const leftPart = (node: number, letters: Laid[], limit: number, anchor: number) => {
        if (--budget < 0) return;
        const start = anchor - letters.length;
        letters.forEach((letter, i) => laid.push({ ...letter, index: at(start + i) }));
        extendRight(node, anchor, anchor);
        laid.length = 0;
        if (limit === 0) return;
        for (let child = lexicon.firstChild[node]; child !== -1; child = lexicon.nextSibling[child]) {
          const code = lexicon.letter[child];
          for (const slot of [code, BLANK_SLOT]) {
            const ids = pool[slot];
            if (ids.length === 0) continue;
            const tileId = ids.pop() as number;
            letters.push({ index: -1, tileId, code, blank: slot === BLANK_SLOT });
            leftPart(child, letters, limit - 1, anchor);
            letters.pop();
            ids.push(tileId);
          }
        }
      };

      for (let position = 0; position < WORD_WIZARD_SIZE; position += 1) {
        if (!anchors[at(position)]) continue;
        if (position > 0 && board[at(position - 1)]) {
          // Tiles already sit to the left: the left part is fixed, so walk it.
          let start = position - 1;
          while (start > 0 && board[at(start - 1)]) start -= 1;
          let node = LEXICON_ROOT;
          for (let p = start; p < position && node !== -1; p += 1) {
            node = lexiconChild(lexicon, node, (board[at(p)] as WordWizardCell).letter.charCodeAt(0) - A_CODE);
          }
          if (node !== -1) extendRight(node, position, position);
        } else {
          // Empty squares to the left, up to the previous anchor: room for a left part.
          let limit = 0;
          for (
            let p = position - 1;
            p >= 0 && !board[at(p)] && !anchors[at(p)] && limit < rack.length - 1;
            p -= 1
          ) {
            limit += 1;
          }
          leftPart(LEXICON_ROOT, [], limit, position);
        }
      }
    }
  }
  return [...found.values()];
}

/**
 * Pick a play for a level. Hard takes the best score; Normal picks among the top
 * quarter; Easy among the middle of the pack — still a real word, just not a sharp one.
 */
export function choosePlay(
  candidates: readonly WordWizardCandidate[],
  level: WordWizardBotLevel,
  random: Random,
): WordWizardCandidate | undefined {
  if (candidates.length === 0) return undefined;
  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  if (level === "hard") return ranked[0];
  const pick =
    level === "normal"
      ? Math.floor(random() * Math.max(1, Math.ceil(ranked.length * 0.25)))
      : Math.floor(ranked.length * (0.4 + random() * 0.4));
  return ranked[Math.min(pick, ranked.length - 1)];
}

/**
 * Take the current player's turn for them: play if anything is playable, otherwise swap
 * the awkward tiles (keeping blanks and an S) if the bag allows, otherwise pass.
 */
export function takeBotTurn(state: WordWizardState, lexicon: WordWizardLexicon, random: Random): WordWizardState {
  if (state.phase !== "playing") return state;
  const choice = choosePlay(findPlays(state, lexicon), state.botLevel, random);
  if (choice) {
    const { state: next, result } = playTiles(state, choice.placements, (word) => isLexiconWord(lexicon, word));
    if (result.ok) return next;
  }
  if (canSwap(state)) {
    const rack = currentPlayer(state).rack;
    let keptS = false;
    const toSwap = rack
      .filter((tile) => {
        if (tile.letter === WORD_WIZARD_BLANK) return false;
        if (tile.letter === "S" && !keptS) {
          keptS = true;
          return false;
        }
        return true;
      })
      .map((tile) => tile.id);
    if (toSwap.length > 0) return swapTiles(state, toSwap, random);
  }
  return passTurn(state);
}
