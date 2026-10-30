import { describe, expect, it } from "vitest";
import {
  awardRound,
  beginTurn,
  currentDrawer,
  guessers,
  missRound,
  roundNumber,
  roundPoints,
  scoreFor,
  skipRound,
  standings,
  startGame,
  stopDrawing,
  tick,
  tickIntervalMs,
  type PictionaryEntrant,
} from "./game-pictionary";
import {
  PICTIONARY_BASE_POINTS,
  PICTIONARY_GUESSER_SHARE,
  PICTIONARY_MAX_PLAYERS,
  PICTIONARY_SPEED_BONUS,
  PICTIONARY_TURN_SECONDS,
  type PictionaryState,
} from "./types";

/** A fixed RNG, so every prompt in a test is the first unused word in its tier. */
const first = () => 0;

const ROSTER: readonly PictionaryEntrant[] = [
  { name: "Min" },
  { name: "Alex" },
  { name: "Sam" },
];

function session(rounds = 6): PictionaryState {
  return startGame(ROSTER, "easy", rounds, first);
}

/** Play a round to `judging` so the award paths have somewhere to start. */
function toJudging(state: PictionaryState): PictionaryState {
  return stopDrawing(beginTurn(state));
}

describe("startGame", () => {
  it("opens on the handoff screen, not on the word", () => {
    // The guessers are looking at the device until it reaches the drawer.
    expect(session().phase).toBe("handoff");
  });

  it("seats everyone on zero with the first player drawing", () => {
    const state = session();
    expect(state.players.map((player) => player.score)).toEqual([0, 0, 0]);
    expect(state.players.map((player) => player.turnsTaken)).toEqual([0, 0, 0]);
    expect(currentDrawer(state)?.name).toBe("Min");
  });

  it("deals a prompt and remembers it as used", () => {
    const state = session();
    expect(state.current?.word).toBeTruthy();
    expect(state.used).toEqual([state.current?.word]);
  });

  it("puts the tier's full clock on the board", () => {
    expect(startGame(ROSTER, "hard", 4, first).secondsLeft).toBe(PICTIONARY_TURN_SECONDS.hard);
  });

  it("rejects a roster too small to play", () => {
    expect(() => startGame([ROSTER[0]], "easy", 6, first)).toThrow(/at least/i);
    expect(() => startGame([], "easy", 6, first)).toThrow(/at least/i);
  });

  it("drops blank names rather than counting them", () => {
    // Three boxes with one left empty is a two-player session, not an error — that is
    // what the setup screen actually produces.
    const state = startGame([...ROSTER.slice(0, 2), { name: "   " }], "easy", 6, first);
    expect(state.players.map((player) => player.name)).toEqual(["Min", "Alex"]);
  });

  it("trims and collapses whitespace in a name", () => {
    const state = startGame([{ name: "  Min  " }, { name: "Van  Gogh" }], "easy", 6, first);
    expect(state.players.map((player) => player.name)).toEqual(["Min", "Van Gogh"]);
  });

  it("rejects a name nobody could fit on the turn banner", () => {
    expect(() =>
      startGame([{ name: "a".repeat(100) }, ROSTER[1]], "easy", 6, first),
    ).toThrow(/at most/i);
  });

  it("rejects more players than one device can pass around", () => {
    const crowd = Array.from({ length: PICTIONARY_MAX_PLAYERS + 1 }, (_, index) => ({
      name: `Player ${index + 1}`,
    }));
    expect(() => startGame(crowd, "easy", 6, first)).toThrow(/at most/i);
  });

  it("rejects two players sharing a name, whatever the case", () => {
    expect(() => startGame([ROSTER[0], { name: "Min" }], "easy", 6, first)).toThrow(
      /different name/i,
    );
    expect(() => startGame([ROSTER[0], { name: "min" }], "easy", 6, first)).toThrow(
      /different name/i,
    );
  });
});

describe("the turn", () => {
  it("starts the clock on begin", () => {
    expect(beginTurn(session()).phase).toBe("drawing");
  });

  it("ignores a second begin, so a double tap cannot restart a turn", () => {
    const drawing = tick(beginTurn(session()));
    expect(beginTurn(drawing).secondsLeft).toBe(drawing.secondsLeft);
  });

  it("counts a second down while drawing", () => {
    const state = tick(beginTurn(session()));
    expect(state.secondsLeft).toBe(PICTIONARY_TURN_SECONDS.easy - 1);
    expect(state.phase).toBe("drawing");
  });

  it("does not run the clock outside drawing", () => {
    const handoff = session();
    expect(tick(handoff)).toBe(handoff);
  });

  it("ends the round itself when the clock runs out", () => {
    let state = beginTurn(session());
    for (let i = 0; i < PICTIONARY_TURN_SECONDS.easy; i += 1) state = tick(state);
    expect(state.phase).toBe("judging");
    expect(state.secondsLeft).toBe(0);
  });

  it("freezes the clock when the drawer stops early", () => {
    const stopped = stopDrawing(tick(tick(beginTurn(session()))));
    expect(stopped.phase).toBe("judging");
    expect(stopped.secondsLeft).toBe(PICTIONARY_TURN_SECONDS.easy - 2);
  });

  it("ticks once a second", () => {
    expect(tickIntervalMs()).toBe(1000);
  });

  it("offers everyone but the drawer as a guesser", () => {
    expect(guessers(session()).map((player) => player.name)).toEqual(["Alex", "Sam"]);
  });
});

describe("roundPoints", () => {
  it("pays the base plus a bonus for every second left", () => {
    const { total } = roundPoints("easy", 10);
    expect(total).toBe(PICTIONARY_BASE_POINTS.easy + 10 * PICTIONARY_SPEED_BONUS);
  });

  it("pays the base alone at the buzzer", () => {
    expect(roundPoints("medium", 0).total).toBe(PICTIONARY_BASE_POINTS.medium);
  });

  it("splits without losing or inventing a point", () => {
    // The whole reason the drawer takes the remainder rather than its own rounding.
    for (let seconds = 0; seconds <= 60; seconds += 1) {
      const { total, guesser, drawer } = roundPoints("hard", seconds);
      expect(guesser + drawer).toBe(total);
    }
  });

  it("gives the guesser the larger share", () => {
    const { total, guesser } = roundPoints("easy", 20);
    expect(guesser).toBe(Math.round(total * PICTIONARY_GUESSER_SHARE));
    expect(guesser).toBeGreaterThan(total - guesser);
  });

  it("does not pay a bonus for a negative clock", () => {
    expect(roundPoints("easy", -5).total).toBe(PICTIONARY_BASE_POINTS.easy);
  });
});

describe("awardRound", () => {
  it("pays both the guesser and the drawer", () => {
    const judging = toJudging(session());
    const { guesser, drawer } = roundPoints("easy", judging.secondsLeft);
    const next = awardRound(judging, "Alex", first);

    expect(next.players.find((player) => player.name === "Alex")?.score).toBe(guesser);
    expect(next.players.find((player) => player.name === "Min")?.score).toBe(drawer);
    expect(next.players.find((player) => player.name === "Sam")?.score).toBe(0);
  });

  it("records the round with who got it and when", () => {
    const judging = toJudging(session());
    const next = awardRound(judging, "Sam", first);
    const round = next.rounds[0];

    expect(round.outcome).toBe("guessed");
    expect(round.guesser).toBe("Sam");
    expect(round.drawer).toBe("Min");
    expect(round.word).toBe(judging.current?.word);
    expect(round.secondsLeft).toBe(judging.secondsLeft);
  });

  it("passes the pen on and deals a fresh prompt", () => {
    const judging = toJudging(session());
    const next = awardRound(judging, "Alex", first);

    expect(next.phase).toBe("handoff");
    expect(currentDrawer(next)?.name).toBe("Alex");
    expect(next.secondsLeft).toBe(PICTIONARY_TURN_SECONDS.easy);
    expect(next.current?.word).not.toBe(judging.current?.word);
    expect(next.used).toHaveLength(2);
  });

  it("counts the drawer's turn", () => {
    const next = awardRound(toJudging(session()), "Alex", first);
    expect(next.players[0].turnsTaken).toBe(1);
    expect(next.players[1].turnsTaken).toBe(0);
  });

  it("refuses to credit the drawer for their own word", () => {
    const judging = toJudging(session());
    expect(awardRound(judging, "Min", first)).toBe(judging);
  });

  it("refuses an id that is not in the roster", () => {
    const judging = toJudging(session());
    expect(awardRound(judging, "Nobody", first)).toBe(judging);
  });

  it("does nothing outside judging", () => {
    const handoff = session();
    expect(awardRound(handoff, "Alex", first)).toBe(handoff);
  });
});

describe("missRound", () => {
  it("scores nobody but still counts the turn", () => {
    const next = missRound(toJudging(session()), first);

    expect(next.players.every((player) => player.score === 0)).toBe(true);
    expect(next.players[0].turnsTaken).toBe(1);
    expect(next.rounds[0].outcome).toBe("missed");
    expect(next.rounds[0].guesser).toBeUndefined();
  });

  it("reveals the word it recorded", () => {
    const judging = toJudging(session());
    expect(missRound(judging, first).rounds[0].word).toBe(judging.current?.word);
  });

  it("does nothing outside judging", () => {
    const handoff = session();
    expect(missRound(handoff, first)).toBe(handoff);
  });
});

describe("skipRound", () => {
  it("costs nothing and does not spend the drawer's turn", () => {
    const next = skipRound(session(), first);

    expect(next.players.every((player) => player.score === 0)).toBe(true);
    expect(next.players.every((player) => player.turnsTaken === 0)).toBe(true);
    expect(next.rounds[0].outcome).toBe("skipped");
  });

  it("does not hand the same word back later in the session", () => {
    const state = session();
    const skipped = skipRound(state, first);
    expect(skipped.used).toContain(state.current?.word);
    expect(skipped.current?.word).not.toBe(state.current?.word);
  });

  it("cannot be used once the clock has started", () => {
    const drawing = beginTurn(session());
    expect(skipRound(drawing, first)).toBe(drawing);
  });
});

describe("the end of a session", () => {
  it("reaches the summary after the last round", () => {
    const two = session(2);
    const afterFirst = awardRound(toJudging(two), "Alex", first);
    const afterSecond = awardRound(toJudging(afterFirst), "Min", first);

    expect(afterSecond.phase).toBe("summary");
    expect(afterSecond.rounds).toHaveLength(2);
    expect(afterSecond.current).toBeUndefined();
    expect(afterSecond.secondsLeft).toBe(0);
  });

  it("finishes even when the last clock runs out", () => {
    let state = beginTurn(session(1));
    for (let i = 0; i < PICTIONARY_TURN_SECONDS.easy; i += 1) state = tick(state);
    const done = missRound(state, first);

    expect(done.phase).toBe("summary");
    expect(done.rounds).toHaveLength(1);
  });

  it("counts a skipped round against the session's length", () => {
    // A skip is a round that happened — otherwise skipping would extend the game.
    const done = skipRound(session(1), first);
    expect(done.phase).toBe("summary");
  });

  it("reports each player's own score, floored at zero", () => {
    const two = session(2);
    const afterFirst = awardRound(toJudging(two), "Alex", first);
    const done = awardRound(toJudging(afterFirst), "Min", first);

    expect(scoreFor(done, "Alex")).toBeGreaterThan(0);
    expect(scoreFor(done, "Sam")).toBe(0);
  });

  it("reports a running total mid-session, since nothing is ever posted", () => {
    // Unlike the saved games, `scoreFor` does NOT refuse an unfinished session: no score
    // leaves this screen, so there is no board to keep honest and a running total is a
    // legitimate thing to read.
    const partway = awardRound(toJudging(session(6)), "Alex", first);
    expect(partway.phase).not.toBe("summary");
    expect(scoreFor(partway, "Alex")).toBeGreaterThan(0);
  });

  it("scores nothing for someone who was not playing", () => {
    const done = awardRound(toJudging(session(1)), "Alex", first);
    expect(scoreFor(done, "Nobody")).toBe(0);
  });

  it("ranks the standings highest first, breaking ties on fewer turns", () => {
    const done = awardRound(toJudging(session(1)), "Alex", first);
    const ranked = standings(done);

    expect(ranked[0].name).toBe("Alex");
    expect(ranked.map((player) => player.score)).toEqual(
      [...ranked.map((player) => player.score)].sort((a, b) => b - a),
    );
    // Min drew (1 turn, smaller share) and Sam did nothing (0 turns, 0 points).
    expect(ranked[1].name).toBe("Min");
    expect(ranked[2].name).toBe("Sam");
  });
});

describe("roundNumber", () => {
  it("counts from one and stops at the session's length", () => {
    const two = session(2);
    expect(roundNumber(two)).toBe(1);

    const afterFirst = awardRound(toJudging(two), "Alex", first);
    expect(roundNumber(afterFirst)).toBe(2);

    const done = awardRound(toJudging(afterFirst), "Min", first);
    expect(roundNumber(done)).toBe(2);
  });
});

describe("a session with its own word pool", () => {
  const pool = [
    { word: "inside joke", tier: "easy" as const },
    { word: "the cat thing", tier: "easy" as const },
  ];

  it("draws from the pool rather than the built-in bank", () => {
    const state = startGame(ROSTER, "easy", 2, first, pool);
    expect(pool.map((entry) => entry.word)).toContain(state.current?.word);
  });

  it("keeps drawing from the pool on later rounds", () => {
    const state = startGame(ROSTER, "easy", 3, first, pool);
    const next = awardRound(toJudging(state), "Alex", first);
    expect(pool.map((entry) => entry.word)).toContain(next.current?.word);
  });

  it("does not repeat a prompt while the pool has unused words", () => {
    const state = startGame(ROSTER, "easy", 3, first, pool);
    const next = awardRound(toJudging(state), "Alex", first);
    expect(next.current?.word).not.toBe(state.current?.word);
  });

  it("recycles the pool rather than running out of game", () => {
    // Three rounds from a two-word pool: the third has to reuse one.
    let state = startGame(ROSTER, "easy", 3, first, pool);
    state = awardRound(toJudging(state), "Alex", first);
    state = awardRound(toJudging(state), "Sam", first);
    expect(pool.map((entry) => entry.word)).toContain(state.current?.word);
  });

  it("falls back to the built-in bank when handed an empty pool", () => {
    const state = startGame(ROSTER, "easy", 2, first, []);
    expect(state.current?.word).toBeTruthy();
  });

  it("plays from the built-in bank when given no pool at all", () => {
    expect(startGame(ROSTER, "easy", 2, first).current?.word).toBeTruthy();
  });
});
