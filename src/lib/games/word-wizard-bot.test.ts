import { describe, expect, it } from "vitest";
import { evaluatePlay, playTiles, startGame } from "./game-word-wizard";
import { choosePlay, findPlays, takeBotTurn } from "./word-wizard-bot";
import { isLexiconWord, parseLexicon } from "./word-wizard-lexicon";
import { WORD_WIZARD_CENTRE, WORD_WIZARD_SIZE, type WordWizardState } from "./types";

const lexicon = parseLexicon(["at", "ta", "cat", "cats", "act", "tab", "bat", "bats", "stab", "as", "ab"].join("\n"));
const isWord = (word: string) => isLexiconWord(lexicon, word);
const at = (row: number, col: number) => row * WORD_WIZARD_SIZE + col;

function seeded(seed = 7): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function game(rack: string, level: "easy" | "normal" | "hard" = "hard"): WordWizardState {
  const state = startGame({
    mode: "bot",
    botLevel: level,
    entrants: [
      { name: "Min", kind: "human" },
      { name: "Wizard", kind: "bot" },
    ],
    random: seeded(),
  });
  // Put the bot to move with a known rack.
  state.turn = 1;
  state.players[1].rack = [...rack].map((letter, i) => ({ id: 500 + i, letter }));
  return state;
}

describe("findPlays", () => {
  it("finds only legal first plays, all covering the centre", () => {
    const state = game("CATSQQQ");
    const plays = findPlays(state, lexicon);
    expect(plays.length).toBeGreaterThan(0);
    for (const play of plays) {
      expect(play.placements.some((p) => p.index === WORD_WIZARD_CENTRE)).toBe(true);
      const check = evaluatePlay(state, play.placements, isWord);
      expect(check).toMatchObject({ ok: true, score: play.score });
    }
    expect(plays.map((p) => p.words[0])).toEqual(expect.arrayContaining(["CAT", "CATS", "ACT", "AT", "TA"]));
  });

  it("builds on existing tiles, and every play it finds is legal", () => {
    let state = game("CATQQQQ");
    state = playTiles(
      state,
      [
        { index: at(7, 6), tileId: 500 },
        { index: at(7, 7), tileId: 501 },
        { index: at(7, 8), tileId: 502 },
      ],
      isWord,
    ).state;
    // Hand the turn back to the bot with a rack that can extend CAT or cross it.
    state = { ...state, turn: 1 };
    state.players[1].rack = [..."SBQQQQQ"].map((letter, i) => ({ id: 600 + i, letter }));
    const plays = findPlays(state, lexicon);
    expect(plays.map((p) => p.words).flat()).toContain("CATS");
    for (const play of plays) expect(evaluatePlay(state, play.placements, isWord).ok).toBe(true);
  });

  it("uses a blank as any letter, scoring it zero", () => {
    const state = game("?TQQQQQ");
    const plays = findPlays(state, lexicon);
    const blankAt = plays.find((p) => p.words[0] === "AT" && p.placements.some((x) => x.letter === "A"));
    expect(blankAt).toBeDefined();
    expect(evaluatePlay(state, blankAt!.placements, isWord)).toMatchObject({ ok: true, score: blankAt!.score });
  });

  it("finds nothing for a rack that spells nothing", () => {
    expect(findPlays(game("QQQQQQQ"), lexicon)).toEqual([]);
  });
});

describe("choosePlay and takeBotTurn", () => {
  it("hard takes the top score; no candidates gives nothing", () => {
    const candidates = [
      { placements: [], score: 5, words: ["A"] },
      { placements: [], score: 20, words: ["B"] },
    ];
    expect(choosePlay(candidates, "hard", seeded())?.score).toBe(20);
    expect(choosePlay([], "easy", seeded())).toBeUndefined();
    expect(choosePlay(candidates, "easy", seeded())).toBeDefined();
  });

  it("plays when it can, and swaps when it cannot", () => {
    const played = takeBotTurn(game("CATSQQQ"), lexicon, seeded());
    expect(played.history.at(-1)?.kind).toBe("play");
    expect(played.turn).toBe(0);

    const stuck = takeBotTurn(game("QQQQQQQ"), lexicon, seeded());
    expect(stuck.history.at(-1)?.kind).toBe("swap");
  });

  it("passes when it cannot play or swap", () => {
    const state = { ...game("QQQQQQQ"), bag: [] };
    expect(takeBotTurn(state, lexicon, seeded()).history.at(-1)?.kind).toBe("pass");
  });
});
