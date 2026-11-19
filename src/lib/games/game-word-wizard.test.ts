import { describe, expect, it } from "vitest";
import {
  canSwap,
  createBag,
  evaluatePlay,
  passTurn,
  playTiles,
  scoreGame,
  squareAt,
  standings,
  startGame,
  swapTiles,
} from "./game-word-wizard";
import {
  WORD_WIZARD_CENTRE,
  WORD_WIZARD_FULL_RACK_BONUS,
  WORD_WIZARD_SIZE,
  type WordWizardState,
  type WordWizardTile,
} from "./types";

const WORDS = new Set(["CAT", "CATS", "AT", "TA", "AX", "XI", "BAT", "TAB", "AS", "RETAINS"]);
const isWord = (word: string) => WORDS.has(word);

/** A seeded generator, so a deal is the same every run. */
function seeded(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const at = (row: number, col: number) => row * WORD_WIZARD_SIZE + col;

function rackOf(letters: string, firstId = 1000): WordWizardTile[] {
  return [...letters].map((letter, i) => ({ id: firstId + i, letter }));
}

/** A bot game with player 0's rack replaced. */
function gameWith(rack: string, other = "QQQQQQQ"): WordWizardState {
  const state = startGame({
    mode: "bot",
    entrants: [
      { name: "Min", kind: "human" },
      { name: "Wizard", kind: "bot" },
    ],
    random: seeded(),
  });
  state.players[0].rack = rackOf(rack);
  state.players[1].rack = rackOf(other, 2000);
  return state;
}

describe("the board", () => {
  it("is symmetric under both mirrors and the diagonal", () => {
    for (let r = 0; r < WORD_WIZARD_SIZE; r += 1) {
      for (let c = 0; c < WORD_WIZARD_SIZE; c += 1) {
        const square = squareAt(at(r, c));
        expect(squareAt(at(c, r))).toBe(square);
        expect(squareAt(at(14 - r, c))).toBe(square);
        expect(squareAt(at(r, 14 - c))).toBe(square);
      }
    }
  });

  it("makes the centre a double word and keeps eight triple words", () => {
    expect(squareAt(WORD_WIZARD_CENTRE)).toBe("double-word");
    const triples = Array.from({ length: 225 }, (_, i) => squareAt(i)).filter((s) => s === "triple-word");
    expect(triples).toHaveLength(8);
  });
});

describe("startGame", () => {
  it("fills a 102-tile bag and deals seven each", () => {
    expect(createBag(seeded())).toHaveLength(102);
    const state = gameWith("CAT");
    expect(state.bag).toHaveLength(102 - 14);
    expect(state.turn).toBe(0);
  });

  it("refuses duplicate or blank names and the wrong player count", () => {
    const random = seeded();
    expect(() =>
      startGame({
        mode: "pass-and-play",
        entrants: [
          { name: "Ann", kind: "human" },
          { name: "ann", kind: "human" },
        ],
        random,
      }),
    ).toThrow(/same name/);
    expect(() =>
      startGame({ mode: "pass-and-play", entrants: [{ name: "Solo", kind: "human" }], random }),
    ).toThrow(/2–4/);
    expect(() =>
      startGame({
        mode: "pass-and-play",
        entrants: [
          { name: " ", kind: "human" },
          { name: "Bo", kind: "human" },
        ],
        random,
      }),
    ).toThrow(/name/);
  });
});

describe("evaluatePlay", () => {
  it("scores the first word through the centre double word", () => {
    const state = gameWith("CATXYZQ");
    const result = evaluatePlay(
      state,
      [
        { index: at(7, 6), tileId: 1000 },
        { index: at(7, 7), tileId: 1001 },
        { index: at(7, 8), tileId: 1002 },
      ],
      isWord,
    );
    expect(result).toMatchObject({ ok: true, score: (3 + 1 + 1) * 2, fullRackBonus: false });
  });

  it("refuses a first word off the centre, a gap, a bend and a non-word", () => {
    const state = gameWith("CATXYZQ");
    expect(
      evaluatePlay(state, [{ index: at(0, 0), tileId: 1000 }, { index: at(0, 1), tileId: 1001 }], isWord),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/centre/) });
    expect(
      evaluatePlay(state, [{ index: at(7, 6), tileId: 1000 }, { index: at(7, 8), tileId: 1001 }], isWord),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/unbroken/) });
    expect(
      evaluatePlay(state, [{ index: at(7, 7), tileId: 1000 }, { index: at(8, 8), tileId: 1001 }], isWord),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/one row/) });
    expect(
      evaluatePlay(state, [{ index: at(7, 7), tileId: 1001 }, { index: at(7, 8), tileId: 1000 }], isWord),
    ).toMatchObject({ ok: false, invalidWords: ["AC"] });
  });

  it("refuses a tile that is not on the rack and a blank with no letter", () => {
    const state = gameWith("?ATXYZQ");
    expect(evaluatePlay(state, [{ index: at(7, 7), tileId: 9 }], isWord)).toMatchObject({ ok: false });
    expect(
      evaluatePlay(state, [{ index: at(7, 7), tileId: 1000 }, { index: at(7, 8), tileId: 1001 }], isWord),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/blank/) });
  });

  it("scores a blank as zero", () => {
    const state = gameWith("?ATXYZQ");
    const result = evaluatePlay(
      state,
      [
        { index: at(7, 6), tileId: 1000, letter: "c" },
        { index: at(7, 7), tileId: 1001 },
        { index: at(7, 8), tileId: 1002 },
      ],
      isWord,
    );
    expect(result).toMatchObject({ ok: true, score: (0 + 1 + 1) * 2 });
  });

  it("adds the full-rack bonus for all seven tiles", () => {
    const state = gameWith("RETAINS");
    const placements = [..."RETAINS"].map((_, i) => ({ index: at(7, 4 + i), tileId: 1000 + i }));
    const result = evaluatePlay(state, placements, isWord);
    expect(result.ok && result.fullRackBonus).toBe(true);
    // R E T A I N S on cols 4–10 of row 7: col 4 is plain, col 7 the centre (double word).
    expect(result.ok && result.score).toBe((1 + 1 + 1 + 1 + 1 + 1 + 1) * 2 + WORD_WIZARD_FULL_RACK_BONUS);
  });

  it("requires a later play to join the board, and scores cross words", () => {
    const first = gameWith("CATXYZQ", "SBXIQQQ");
    const { state } = playTiles(
      first,
      [
        { index: at(7, 6), tileId: 1000 },
        { index: at(7, 7), tileId: 1001 },
        { index: at(7, 8), tileId: 1002 },
      ],
      isWord,
    );
    expect(state.turn).toBe(1);
    expect(evaluatePlay(state, [{ index: at(0, 0), tileId: 2000 }], isWord)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/join/),
    });
    // S after CAT makes CATS, a single tile on a plain square.
    const cats = evaluatePlay(state, [{ index: at(7, 9), tileId: 2000 }], isWord);
    expect(cats).toMatchObject({ ok: true, score: 3 + 1 + 1 + 1 });
  });
});

describe("playTiles", () => {
  it("moves tiles to the board, refills the rack and passes the turn", () => {
    const state = gameWith("CATXYZQ");
    const bagBefore = state.bag.length;
    const { state: next, result } = playTiles(
      state,
      [
        { index: at(7, 7), tileId: 1001 },
        { index: at(7, 8), tileId: 1002 },
      ],
      isWord,
    );
    expect(result.ok).toBe(true);
    expect(next.board[at(7, 7)]?.letter).toBe("A");
    expect(next.players[0].rack).toHaveLength(7);
    expect(next.bag).toHaveLength(bagBefore - 2);
    expect(next.players[0].score).toBe(4);
    expect(next.turn).toBe(1);
  });

  it("leaves the state alone when refused", () => {
    const state = gameWith("CATXYZQ");
    const { state: next, result } = playTiles(state, [{ index: at(0, 0), tileId: 1000 }], isWord);
    expect(result.ok).toBe(false);
    expect(next).toBe(state);
  });

  it("ends the game when a player goes out with the bag empty", () => {
    const state = { ...gameWith("AT", "QZ"), bag: [] };
    const { state: next } = playTiles(
      state,
      [
        { index: at(7, 7), tileId: 1000 },
        { index: at(7, 8), tileId: 1001 },
      ],
      isWord,
    );
    expect(next.phase).toBe("over");
    // Min scored 4, went out and gains Q(10)+Z(9); the bot loses the same.
    expect(next.players[0].score).toBe(4 + 19);
    expect(next.players[1].score).toBe(-19);
    expect(next.winners).toEqual([0]);
    expect(scoreGame(next)).toBe(23);
  });
});

describe("swap and pass", () => {
  it("swaps tiles back into the bag and ends the turn", () => {
    const state = gameWith("CATXYZQ");
    expect(canSwap(state)).toBe(true);
    const next = swapTiles(state, [1003, 1004], seeded(3));
    expect(next.players[0].rack).toHaveLength(7);
    expect(next.bag).toHaveLength(state.bag.length);
    expect(next.turn).toBe(1);
    expect(next.history.at(-1)).toMatchObject({ kind: "swap", swapped: 2 });
  });

  it("refuses a swap when the bag is low", () => {
    const state = { ...gameWith("CATXYZQ"), bag: [] };
    expect(canSwap(state)).toBe(false);
    expect(() => swapTiles(state, [1000], seeded())).toThrow(/bag/);
  });

  it("ends the game after every player passes twice, charging racks", () => {
    let state = gameWith("AB", "Q");
    for (let i = 0; i < 4; i += 1) state = passTurn(state);
    expect(state.phase).toBe("over");
    expect(state.players.map((p) => p.score)).toEqual([-5, -10]);
    expect(standings(state)[0].name).toBe("Min");
    expect(scoreGame(state)).toBe(0); // a winning negative score records nothing
  });
});

describe("scoreGame", () => {
  it("records nothing for a loss, a tie or a pass-and-play game", () => {
    const base = { ...gameWith("A"), phase: "over" as const };
    const tie = { ...base, players: base.players.map((p) => ({ ...p, score: 50 })) };
    expect(scoreGame(tie)).toBe(0);
    const loss = { ...base, players: [{ ...base.players[0], score: 10 }, { ...base.players[1], score: 30 }] };
    expect(scoreGame(loss)).toBe(0);
    const win = { ...base, players: [{ ...base.players[0], score: 30 }, { ...base.players[1], score: 10 }] };
    expect(scoreGame(win)).toBe(30);
    expect(scoreGame({ ...win, mode: "pass-and-play" })).toBe(0);
  });
});
