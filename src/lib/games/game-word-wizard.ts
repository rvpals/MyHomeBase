import {
  WORD_WIZARD_BLANK,
  WORD_WIZARD_CENTRE,
  WORD_WIZARD_FULL_RACK_BONUS,
  WORD_WIZARD_LAYOUT,
  WORD_WIZARD_LETTER_VALUES,
  WORD_WIZARD_MAX_NAME_LENGTH,
  WORD_WIZARD_MAX_PLAYERS,
  WORD_WIZARD_MIN_BAG_TO_SWAP,
  WORD_WIZARD_MIN_PLAYERS,
  WORD_WIZARD_RACK_SIZE,
  WORD_WIZARD_SIZE,
  WORD_WIZARD_TILE_COUNTS,
  type WordWizardBotLevel,
  type WordWizardCell,
  type WordWizardMode,
  type WordWizardPlacement,
  type WordWizardPlayResult,
  type WordWizardPlayer,
  type WordWizardSquare,
  type WordWizardState,
  type WordWizardTile,
  type WordWizardWord,
} from "./types";

// Word Wizard's rules, as pure functions over `WordWizardState`. Nothing here knows
// about a screen: the view asks what a placement would score, plays it, and draws the
// result. Word checks go through a predicate (`isWord`) rather than a dictionary type,
// so the tests can use a ten-word list and the view the full one.

export type Random = () => number;

/** Is this a playable word? Upper-case in, yes or no out. */
export type WordCheck = (word: string) => boolean;

const SQUARE_BY_CODE: Record<string, WordWizardSquare> = {
  ".": "plain",
  d: "double-letter",
  t: "triple-letter",
  D: "double-word",
  T: "triple-word",
  "*": "double-word",
};

/** The bonus square at `index` (row-major, 0–224). */
export function squareAt(index: number): WordWizardSquare {
  const row = Math.floor(index / WORD_WIZARD_SIZE);
  const col = index % WORD_WIZARD_SIZE;
  const fold = (n: number) => (n > 7 ? WORD_WIZARD_SIZE - 1 - n : n);
  return SQUARE_BY_CODE[WORD_WIZARD_LAYOUT[fold(row)][fold(col)]];
}

export function letterMultiplier(square: WordWizardSquare): number {
  return square === "double-letter" ? 2 : square === "triple-letter" ? 3 : 1;
}

export function wordMultiplier(square: WordWizardSquare): number {
  return square === "double-word" ? 2 : square === "triple-word" ? 3 : 1;
}

/** A tile's face value. A blank is worth 0 even once it stands for a letter. */
export function tileValue(letter: string): number {
  return WORD_WIZARD_LETTER_VALUES[letter] ?? 0;
}

/** A fresh, shuffled bag of 102 tiles. */
export function createBag(random: Random): WordWizardTile[] {
  const tiles: WordWizardTile[] = [];
  let id = 1;
  for (const [letter, count] of Object.entries(WORD_WIZARD_TILE_COUNTS)) {
    for (let i = 0; i < count; i += 1) tiles.push({ id: id++, letter });
  }
  for (let i = tiles.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

export interface WordWizardEntrant {
  name: string;
  kind: "human" | "bot";
}

/**
 * Deal a new game. `bot` mode is one human (seat 0) against one bot; `pass-and-play`
 * takes two to four humans. Names are trimmed and capped; a blank or duplicate name is
 * refused rather than silently renamed, so the setup screen can say why.
 */
export function startGame(input: {
  mode: WordWizardMode;
  entrants: readonly WordWizardEntrant[];
  botLevel?: WordWizardBotLevel;
  random: Random;
}): WordWizardState {
  const entrants = input.entrants.map((entrant) => ({
    ...entrant,
    name: entrant.name.trim().slice(0, WORD_WIZARD_MAX_NAME_LENGTH),
  }));
  if (input.mode === "bot") {
    if (entrants.length !== 2 || entrants[0].kind !== "human" || entrants[1].kind !== "bot") {
      throw new Error("A bot game is one player against one bot.");
    }
  } else {
    if (entrants.length < WORD_WIZARD_MIN_PLAYERS || entrants.length > WORD_WIZARD_MAX_PLAYERS) {
      throw new Error(`Pass-and-play needs ${WORD_WIZARD_MIN_PLAYERS}–${WORD_WIZARD_MAX_PLAYERS} players.`);
    }
    if (entrants.some((entrant) => entrant.kind !== "human")) {
      throw new Error("Pass-and-play is people only.");
    }
  }
  if (entrants.some((entrant) => entrant.name === "")) throw new Error("Every player needs a name.");
  const names = new Set(entrants.map((entrant) => entrant.name.toLowerCase()));
  if (names.size !== entrants.length) throw new Error("Two players have the same name.");

  const bag = createBag(input.random);
  const players: WordWizardPlayer[] = entrants.map((entrant) => ({
    name: entrant.name,
    kind: entrant.kind,
    rack: bag.splice(0, WORD_WIZARD_RACK_SIZE),
    score: 0,
  }));

  return {
    mode: input.mode,
    botLevel: input.botLevel ?? "normal",
    board: Array.from({ length: WORD_WIZARD_SIZE * WORD_WIZARD_SIZE }, () => null),
    bag,
    players,
    turn: 0,
    history: [],
    scorelessTurns: 0,
    phase: "playing",
    winners: [],
    finalAdjustments: players.map(() => 0),
  };
}

export function currentPlayer(state: WordWizardState): WordWizardPlayer {
  return state.players[state.turn];
}

export function isBoardEmpty(board: readonly (WordWizardCell | null)[]): boolean {
  return board.every((cell) => cell === null);
}

function rowOf(index: number): number {
  return Math.floor(index / WORD_WIZARD_SIZE);
}

function colOf(index: number): number {
  return index % WORD_WIZARD_SIZE;
}

/** The orthogonal neighbours of `index` that are on the board. */
export function neighbours(index: number): number[] {
  const row = rowOf(index);
  const col = colOf(index);
  const out: number[] = [];
  if (row > 0) out.push(index - WORD_WIZARD_SIZE);
  if (row < WORD_WIZARD_SIZE - 1) out.push(index + WORD_WIZARD_SIZE);
  if (col > 0) out.push(index - 1);
  if (col < WORD_WIZARD_SIZE - 1) out.push(index + 1);
  return out;
}

type Axis = "across" | "down";

function stepOf(axis: Axis): number {
  return axis === "across" ? 1 : WORD_WIZARD_SIZE;
}

/** Whether moving one step along `axis` from `index` stays on the board. */
function canStep(index: number, axis: Axis, direction: 1 | -1): boolean {
  if (axis === "across") {
    const col = colOf(index) + direction;
    return col >= 0 && col < WORD_WIZARD_SIZE;
  }
  const row = rowOf(index) + direction;
  return row >= 0 && row < WORD_WIZARD_SIZE;
}

/**
 * The run of filled cells through `index` along `axis`, start to end. `letterAt` sees
 * both the existing board and the tiles being placed.
 */
function runThrough(index: number, axis: Axis, letterAt: (i: number) => string | undefined): number[] {
  const step = stepOf(axis);
  let start = index;
  while (canStep(start, axis, -1) && letterAt(start - step) !== undefined) start -= step;
  const run: number[] = [];
  let at = start;
  run.push(at);
  while (canStep(at, axis, 1) && letterAt(at + step) !== undefined) {
    at += step;
    run.push(at);
  }
  return run;
}

/**
 * The words a set of new tiles forms on `board`, each scored. Assumes the placement is
 * already in one line and on empty squares; `evaluatePlay` checks that first. Exported
 * so the bot scores its candidates with exactly the rules a player is scored by.
 */
export function wordsFormed(
  board: readonly (WordWizardCell | null)[],
  placed: ReadonlyMap<number, { letter: string; blank: boolean }>,
): WordWizardWord[] {
  const letterAt = (i: number) => placed.get(i)?.letter ?? board[i]?.letter;
  const indices = [...placed.keys()].sort((a, b) => a - b);
  if (indices.length === 0) return [];

  const sameRow = indices.every((i) => rowOf(i) === rowOf(indices[0]));
  const main: Axis = indices.length > 1 && !sameRow ? "down" : "across";
  const cross: Axis = main === "across" ? "down" : "across";

  const score = (run: number[]): WordWizardWord => {
    let sum = 0;
    let multiplier = 1;
    for (const i of run) {
      const fresh = placed.get(i);
      if (fresh) {
        const square = squareAt(i);
        sum += (fresh.blank ? 0 : tileValue(fresh.letter)) * letterMultiplier(square);
        multiplier *= wordMultiplier(square);
      } else {
        const cell = board[i] as WordWizardCell;
        sum += cell.blank ? 0 : tileValue(cell.letter);
      }
    }
    return { word: run.map((i) => letterAt(i)).join(""), score: sum * multiplier, indices: run };
  };

  const words: WordWizardWord[] = [];
  const mainRun = runThrough(indices[0], main, letterAt);
  if (mainRun.length > 1) words.push(score(mainRun));
  for (const i of indices) {
    const crossRun = runThrough(i, cross, letterAt);
    if (crossRun.length > 1) words.push(score(crossRun));
  }
  return words;
}

/**
 * Check a placement for the player whose turn it is, without changing anything. The
 * view calls this as tiles are laid, to show the running score or what is wrong.
 */
export function evaluatePlay(
  state: WordWizardState,
  placements: readonly WordWizardPlacement[],
  isWord: WordCheck,
): WordWizardPlayResult {
  if (state.phase !== "playing") return { ok: false, reason: "The game is over." };
  if (placements.length === 0) return { ok: false, reason: "Put at least one tile on the board." };

  const rack = currentPlayer(state).rack;
  const placed = new Map<number, { letter: string; blank: boolean }>();
  const usedTiles = new Set<number>();
  for (const placement of placements) {
    const tile = rack.find((candidate) => candidate.id === placement.tileId);
    if (!tile) return { ok: false, reason: "That tile is not on your rack." };
    if (usedTiles.has(tile.id)) return { ok: false, reason: "A tile can only be used once." };
    if (placement.index < 0 || placement.index >= state.board.length) {
      return { ok: false, reason: "That square is off the board." };
    }
    if (state.board[placement.index] || placed.has(placement.index)) {
      return { ok: false, reason: "That square is already taken." };
    }
    const blank = tile.letter === WORD_WIZARD_BLANK;
    const letter = blank ? (placement.letter ?? "").toUpperCase() : tile.letter;
    if (!/^[A-Z]$/.test(letter)) return { ok: false, reason: "Choose a letter for the blank tile." };
    usedTiles.add(tile.id);
    placed.set(placement.index, { letter, blank });
  }

  const indices = [...placed.keys()].sort((a, b) => a - b);
  const sameRow = indices.every((i) => rowOf(i) === rowOf(indices[0]));
  const sameCol = indices.every((i) => colOf(i) === colOf(indices[0]));
  if (!sameRow && !sameCol) return { ok: false, reason: "Tiles must go in one row or one column." };

  // No gaps: every square between the first and last new tile must be filled.
  const step = sameRow ? 1 : WORD_WIZARD_SIZE;
  for (let i = indices[0]; i <= indices[indices.length - 1]; i += step) {
    if (!placed.has(i) && !state.board[i]) return { ok: false, reason: "The tiles must form one unbroken word." };
  }

  if (isBoardEmpty(state.board)) {
    if (!placed.has(WORD_WIZARD_CENTRE)) return { ok: false, reason: "The first word must cover the centre star." };
    if (placed.size < 2) return { ok: false, reason: "The first word needs at least two letters." };
  } else {
    const touches = indices.some((i) => neighbours(i).some((n) => state.board[n] !== null));
    if (!touches) return { ok: false, reason: "New tiles must join a word already on the board." };
  }

  const words = wordsFormed(state.board, placed);
  if (words.length === 0) return { ok: false, reason: "That does not make a word." };
  const invalidWords = words.map((w) => w.word).filter((word) => !isWord(word));
  if (invalidWords.length > 0) {
    return {
      ok: false,
      reason: `Not in the word list: ${invalidWords.join(", ")}.`,
      invalidWords,
    };
  }

  const fullRackBonus = placed.size === WORD_WIZARD_RACK_SIZE;
  const score =
    words.reduce((sum, word) => sum + word.score, 0) + (fullRackBonus ? WORD_WIZARD_FULL_RACK_BONUS : 0);
  return { ok: true, words, score, fullRackBonus };
}

function rackValue(rack: readonly WordWizardTile[]): number {
  return rack.reduce((sum, tile) => sum + tileValue(tile.letter), 0);
}

function withPlayer(
  players: readonly WordWizardPlayer[],
  index: number,
  change: Partial<WordWizardPlayer>,
): WordWizardPlayer[] {
  return players.map((player, i) => (i === index ? { ...player, ...change } : player));
}

/**
 * End the game: everyone loses what is left on their rack, and a player who went out
 * gains everyone else's. Winners are the top score after that, so a tie has several.
 */
function finish(state: WordWizardState, wentOut: number | undefined): WordWizardState {
  const penalties = state.players.map((player) => rackValue(player.rack));
  const adjustments = penalties.map((penalty, i) =>
    i === wentOut ? penalties.reduce((sum, p) => sum + p, 0) : -penalty,
  );
  const players = state.players.map((player, i) => ({ ...player, score: player.score + adjustments[i] }));
  const top = Math.max(...players.map((player) => player.score));
  return {
    ...state,
    players,
    phase: "over",
    winners: players.flatMap((player, i) => (player.score === top ? [i] : [])),
    finalAdjustments: adjustments,
  };
}

function advance(state: WordWizardState): WordWizardState {
  return { ...state, turn: (state.turn + 1) % state.players.length };
}

/**
 * Play tiles for the player whose turn it is. Returns the new state, or the refusal
 * from `evaluatePlay` with the state unchanged.
 */
export function playTiles(
  state: WordWizardState,
  placements: readonly WordWizardPlacement[],
  isWord: WordCheck,
): { state: WordWizardState; result: WordWizardPlayResult } {
  const result = evaluatePlay(state, placements, isWord);
  if (!result.ok) return { state, result };

  const player = currentPlayer(state);
  const board = state.board.slice();
  for (const placement of placements) {
    const tile = player.rack.find((t) => t.id === placement.tileId) as WordWizardTile;
    const blank = tile.letter === WORD_WIZARD_BLANK;
    board[placement.index] = {
      tileId: tile.id,
      letter: blank ? (placement.letter as string).toUpperCase() : tile.letter,
      blank,
    };
  }
  const used = new Set(placements.map((p) => p.tileId));
  const kept = player.rack.filter((tile) => !used.has(tile.id));
  const bag = state.bag.slice();
  const drawn = bag.splice(0, WORD_WIZARD_RACK_SIZE - kept.length);
  const rack = [...kept, ...drawn];

  let next: WordWizardState = {
    ...state,
    board,
    bag,
    players: withPlayer(state.players, state.turn, { rack, score: player.score + result.score }),
    history: [
      ...state.history,
      {
        player: state.turn,
        kind: "play",
        words: result.words,
        score: result.score,
        fullRackBonus: result.fullRackBonus,
      },
    ],
    scorelessTurns: 0,
  };
  if (rack.length === 0) next = finish(next, state.turn);
  else next = advance(next);
  return { state: next, result };
}

/** Whether a swap is allowed right now. */
export function canSwap(state: WordWizardState): boolean {
  return state.phase === "playing" && state.bag.length >= WORD_WIZARD_MIN_BAG_TO_SWAP;
}

function scoreless(state: WordWizardState): WordWizardState {
  const scorelessTurns = state.scorelessTurns + 1;
  const next = { ...state, scorelessTurns };
  if (scorelessTurns >= state.players.length * 2) return finish(next, undefined);
  return advance(next);
}

/**
 * Return some tiles to the bag and draw as many, ending the turn. The bag is reshuffled
 * with the returned tiles in it, so a player cannot draw back what they threw.
 */
export function swapTiles(state: WordWizardState, tileIds: readonly number[], random: Random): WordWizardState {
  if (!canSwap(state)) throw new Error(`Swapping needs at least ${WORD_WIZARD_MIN_BAG_TO_SWAP} tiles in the bag.`);
  const player = currentPlayer(state);
  const ids = new Set(tileIds);
  const returned = player.rack.filter((tile) => ids.has(tile.id));
  if (returned.length === 0 || returned.length !== ids.size) throw new Error("Pick tiles from your rack to swap.");

  const bag = state.bag.slice();
  const drawn = bag.splice(0, returned.length);
  bag.push(...returned);
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  const rack = [...player.rack.filter((tile) => !ids.has(tile.id)), ...drawn];
  return scoreless({
    ...state,
    bag,
    players: withPlayer(state.players, state.turn, { rack }),
    history: [...state.history, { player: state.turn, kind: "swap", words: [], score: 0, swapped: returned.length }],
  });
}

/** Give up the turn. */
export function passTurn(state: WordWizardState): WordWizardState {
  if (state.phase !== "playing") return state;
  return scoreless({
    ...state,
    history: [...state.history, { player: state.turn, kind: "pass", words: [], score: 0 }],
  });
}

/** Players ranked by score, best first, ties keeping seat order. */
export function standings(state: WordWizardState): { name: string; score: number; seat: number }[] {
  return state.players
    .map((player, seat) => ({ name: player.name, score: player.score, seat }))
    .sort((a, b) => b.score - a.score || a.seat - b.seat);
}

/**
 * What a finished bot game posts to the shared board: the human's final score when they
 * beat the bot outright, and 0 otherwise — a loss or a tie — the rule Bridge and
 * Mahjong apply to a hand the human did not win. Pass-and-play posts nothing (its
 * players are typed names, not accounts), so it also answers 0.
 */
export function scoreGame(state: WordWizardState): number {
  if (state.mode !== "bot" || state.phase !== "over") return 0;
  const human = state.players[0];
  const beatAll = state.players.every((player, i) => i === 0 || human.score > player.score);
  return beatAll ? Math.max(0, human.score) : 0;
}
