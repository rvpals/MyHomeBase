import { describe, expect, it } from "vitest";
import {
  chargeChessClock,
  chessClockReading,
  chessSearchBudgetMs,
  chessTimeControlTag,
  createChessClock,
  formatChessClock,
  hasChessClockFlagged,
  isChessClockUrgent,
  zeroChessClock,
} from "./chess-clock";
import {
  CHESS_LEVEL_SETUP,
  CHESS_MIN_SEARCH_MS,
  CHESS_TIME_CONTROLS,
  CHESS_TIME_CONTROL_SETUP,
  type ChessClock,
} from "./types";

/** A clock mid-game, so a test does not have to start from the full allowance. */
function clockAt(white: number, black: number, control: ChessClock["control"] = "3+2"): ChessClock {
  return { control, remainingMs: { w: white, b: black } };
}

describe("createChessClock", () => {
  it("gives both sides the control's full allowance", () => {
    const clock = createChessClock("5+0");
    expect(clock).toEqual({ control: "5+0", remainingMs: { w: 300_000, b: 300_000 } });
  });

  it("makes no clock at all for an untimed game", () => {
    // Untimed is a real member of the control list, and this is the one place that
    // matters: it is the absence of a clock, not a clock with no time on it.
    expect(createChessClock("untimed")).toBeUndefined();
  });

  it("builds a usable clock for every control on offer", () => {
    for (const control of CHESS_TIME_CONTROLS) {
      const clock = createChessClock(control);
      if (control === "untimed") {
        expect(clock, control).toBeUndefined();
        continue;
      }
      expect(clock?.remainingMs.w, control).toBe(CHESS_TIME_CONTROL_SETUP[control].initialMs);
      expect(clock?.remainingMs.w, control).toBe(clock?.remainingMs.b);
    }
  });
});

describe("chessClockReading", () => {
  it("shows what is banked when nothing is being spent", () => {
    expect(chessClockReading(clockAt(90_000, 60_000), "w")).toBe(90_000);
  });

  it("takes off what the side to move is currently spending", () => {
    expect(chessClockReading(clockAt(90_000, 60_000), "w", 5_000)).toBe(85_000);
  });

  it("never reads below zero", () => {
    expect(chessClockReading(clockAt(1_000, 60_000), "w", 9_000)).toBe(0);
  });
});

describe("chargeChessClock", () => {
  it("deducts the time taken and adds the increment", () => {
    // 3+2: four seconds of thought on a 90-second clock leaves 86, then +2 for the move.
    const { clock, flagged } = chargeChessClock(clockAt(90_000, 90_000), "w", 4_000);
    expect(flagged).toBe(false);
    expect(clock.remainingMs.w).toBe(88_000);
  });

  it("leaves the other side's clock alone", () => {
    const { clock } = chargeChessClock(clockAt(90_000, 60_000), "w", 4_000);
    expect(clock.remainingMs.b).toBe(60_000);
  });

  it("adds nothing on a control with no increment", () => {
    const { clock } = chargeChessClock(clockAt(90_000, 90_000, "5+0"), "w", 4_000);
    expect(clock.remainingMs.w).toBe(86_000);
  });

  it("flags when the time taken is more than the time left", () => {
    const { clock, flagged } = chargeChessClock(clockAt(3_000, 90_000), "w", 5_000);
    expect(flagged).toBe(true);
    expect(clock.remainingMs.w).toBe(0);
  });

  it("does not pay the increment to a side that flagged", () => {
    // The rule that matters: an increment is earned by a move that arrived in time, so
    // it can never rescue a fallen flag back above zero.
    const { clock, flagged } = chargeChessClock(clockAt(1_000, 90_000, "3+2"), "w", 4_000);
    expect(flagged).toBe(true);
    expect(clock.remainingMs.w).toBe(0);
  });

  it("flags on exactly running out", () => {
    const { flagged } = chargeChessClock(clockAt(5_000, 90_000), "w", 5_000);
    expect(flagged).toBe(true);
  });

  it("does not change the clock it was given", () => {
    const before = clockAt(90_000, 90_000);
    chargeChessClock(before, "w", 4_000);
    expect(before.remainingMs.w).toBe(90_000);
  });
});

describe("hasChessClockFlagged", () => {
  it("is true only at or below zero", () => {
    expect(hasChessClockFlagged(clockAt(1, 90_000), "w")).toBe(false);
    expect(hasChessClockFlagged(clockAt(0, 90_000), "w")).toBe(true);
    expect(hasChessClockFlagged(clockAt(3_000, 90_000), "w", 3_000)).toBe(true);
  });
});

describe("zeroChessClock", () => {
  it("empties one side and leaves the other", () => {
    const clock = zeroChessClock(clockAt(5_000, 60_000), "w");
    expect(clock.remainingMs).toEqual({ w: 0, b: 60_000 });
  });
});

describe("chessSearchBudgetMs", () => {
  const advanced = CHESS_LEVEL_SETUP.advanced.timeMs;

  it("uses the level's whole budget in an untimed game", () => {
    expect(chessSearchBudgetMs(undefined, "w", advanced)).toBe(advanced);
  });

  it("will not spend more than the level's budget however much time is left", () => {
    expect(chessSearchBudgetMs(clockAt(900_000, 900_000, "15+10"), "w", advanced)).toBe(advanced);
  });

  it("spends a fraction of a short clock rather than the level's budget", () => {
    // A one-minute game: Advanced's 2.5s a move would flag it long before the board
    // did, so the budget has to come down.
    const budget = chessSearchBudgetMs(clockAt(60_000, 60_000, "1+0"), "w", advanced);
    expect(budget).toBeLessThan(advanced);
    expect(budget).toBeGreaterThan(CHESS_MIN_SEARCH_MS);
  });

  it("shrinks as the clock runs down", () => {
    const early = chessSearchBudgetMs(clockAt(60_000, 60_000, "1+0"), "w", advanced);
    const late = chessSearchBudgetMs(clockAt(6_000, 60_000, "1+0"), "w", advanced);
    expect(late).toBeLessThan(early);
  });

  it("still returns a usable budget on a nearly-dead clock", () => {
    // A floor, so a nearly-flagged computer answers with a legal move rather than an
    // unfinished search.
    expect(chessSearchBudgetMs(clockAt(100, 60_000, "1+0"), "w", advanced)).toBe(
      CHESS_MIN_SEARCH_MS,
    );
  });

  it("reads the clock of the side being asked about", () => {
    const clock = clockAt(600_000, 2_000, "10+0");
    expect(chessSearchBudgetMs(clock, "b", advanced)).toBeLessThan(
      chessSearchBudgetMs(clock, "w", advanced),
    );
  });
});

describe("formatChessClock", () => {
  it("prints minutes and seconds", () => {
    expect(formatChessClock(180_000)).toBe("3:00");
    expect(formatChessClock(182_000)).toBe("3:02");
    expect(formatChessClock(59_000)).toBe("0:59");
  });

  it("switches to tenths under ten seconds", () => {
    expect(formatChessClock(9_400)).toBe("9.4");
    expect(formatChessClock(10_000)).toBe("0:10");
  });

  it("prints hours when there are any", () => {
    expect(formatChessClock(3_723_000)).toBe("1:02:03");
  });

  it("prints zero rather than a negative", () => {
    expect(formatChessClock(0)).toBe("0.0");
    expect(formatChessClock(-5_000)).toBe("0.0");
  });

  it("rounds down, so a clock never reads more than it holds", () => {
    // 9.99s must not print as 10.0 and look like time the player does not have.
    expect(formatChessClock(9_990)).toBe("9.9");
  });
});

describe("isChessClockUrgent", () => {
  it("turns on under ten seconds", () => {
    expect(isChessClockUrgent(9_999)).toBe(true);
    expect(isChessClockUrgent(10_000)).toBe(false);
  });
});

describe("chessTimeControlTag", () => {
  it("writes seconds and increment for PGN", () => {
    expect(chessTimeControlTag(createChessClock("3+2"))).toBe("180+2");
    expect(chessTimeControlTag(createChessClock("15+10"))).toBe("900+10");
  });

  it("writes a dash for an untimed game", () => {
    expect(chessTimeControlTag(undefined)).toBe("-");
  });
});
