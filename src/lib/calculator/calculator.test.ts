import { describe, expect, it, vi } from "vitest";
import { applyKey, calculate, initialState } from "./calculator";
import { ALL_KEYS, keyForKeyboardEvent, type CalculatorKey } from "./keypad";
import type { CalculatorState } from "./types";

/** A key by id, so the tests read as the reader's actions rather than as object literals. */
function key(id: string): CalculatorKey {
  const found = ALL_KEYS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No key "${id}" in the catalogue.`);
  return found;
}

/** Presses a sequence of keys from a fresh calculator. */
function press(...ids: string[]): CalculatorState {
  return ids.reduce((state, id) => applyKey(state, key(id)), initialState("deg"));
}

describe("applyKey — typing", () => {
  it("builds an expression from digits and operators", () => {
    expect(press("1", "2", "add", "3").entry).toBe("12+3");
  });

  it("inserts a function with its opening parenthesis", () => {
    expect(press("sin").entry).toBe("sin(");
  });

  it("replaces a trailing operator rather than appending a second", () => {
    // What a reader produces when they change their mind: 3 + × should mean 3 ×.
    expect(press("3", "add", "multiply").entry).toBe("3×");
    expect(press("3", "add", "multiply", "divide").entry).toBe("3÷");
  });

  it("does not treat a parenthesis as a trailing operator", () => {
    // `sin(-` is a legitimate thing to be halfway through typing.
    expect(press("sin", "subtract").entry).toBe("sin(-");
  });
});

describe("applyKey — equals", () => {
  it("evaluates and shows the result", () => {
    const state = press("2", "add", "2", "equals");
    expect(state.entry).toBe("4");
    expect(state.lastResult).toBe("4");
    expect(state.justEvaluated).toBe(true);
  });

  it("does nothing on an empty entry", () => {
    const state = press("equals");
    expect(state.entry).toBe("");
    expect(state.lastResult).toBeUndefined();
  });

  it("keeps a failed expression on screen with its error", () => {
    // Clearing it would make the reader retype everything to fix one character.
    const state = press("1", "divide", "0", "equals");
    expect(state.error?.kind).toBe("divide-by-zero");
    expect(state.entry).toBe("1÷0");
    expect(state.justEvaluated).toBe(false);
  });

  it("respects the angle mode", () => {
    const degrees = press("sin", "9", "0", "close", "equals");
    expect(degrees.entry).toBe("1");

    const radians = applyKey(press("angle"), key("sin"));
    const evaluated = ["9", "0", "close", "equals"].reduce(
      (state, id) => applyKey(state, key(id)),
      radians,
    );
    expect(evaluated.entry).not.toBe("1");
  });

  it("reports the calculation to the caller so it can be recorded", () => {
    // A callback rather than a return value, so the state machine stays pure and the
    // caller decides whether to persist.
    const onCalculated = vi.fn();
    const state = press("6", "multiply", "7");
    applyKey(state, key("equals"), onCalculated);
    expect(onCalculated).toHaveBeenCalledWith("6×7", "42");
  });

  it("does not report a failed calculation", () => {
    // The tape is a record of results; a syntax error has none, and recording mistypes
    // would push real answers off the end of a 50-row cap.
    const onCalculated = vi.fn();
    applyKey(press("1", "divide", "0"), key("equals"), onCalculated);
    expect(onCalculated).not.toHaveBeenCalled();
  });
});

describe("applyKey — what happens after equals", () => {
  it("starts a new calculation when a digit is typed", () => {
    // 2+2= then 5 is 5, not 45. The rule every physical calculator follows.
    const state = press("2", "add", "2", "equals", "5");
    expect(state.entry).toBe("5");
    expect(state.justEvaluated).toBe(false);
  });

  it("continues from the result when an operator is typed", () => {
    // 2+2= then ×3 is 12.
    const state = press("2", "add", "2", "equals", "multiply", "3", "equals");
    expect(state.entry).toBe("12");
  });

  it("keeps the last result available for the puck across a new entry", () => {
    const state = press("2", "add", "2", "equals", "9");
    // The entry has moved on, but the puck still has something to show.
    expect(state.entry).toBe("9");
    expect(state.lastResult).toBe("4");
  });
});

describe("applyKey — clear, backspace and sign", () => {
  it("AC resets the display but keeps the angle mode", () => {
    const radians = applyKey(initialState("deg"), key("angle"));
    const cleared = applyKey(applyKey(radians, key("5")), key("clear"));
    expect(cleared.entry).toBe("");
    expect(cleared.lastResult).toBeUndefined();
    // The mode is a preference, not part of the sum being cleared.
    expect(cleared.angleMode).toBe("rad");
  });

  it("backspace removes the last character", () => {
    const state = applyKey(press("1", "2", "3"), {
      id: "backspace",
      label: "⌫",
      action: "backspace",
      tone: "action",
    });
    expect(state.entry).toBe("12");
  });

  it("backspace after equals clears, since a result was never typed", () => {
    const state = applyKey(press("2", "add", "2", "equals"), {
      id: "backspace",
      label: "⌫",
      action: "backspace",
      tone: "action",
    });
    expect(state.entry).toBe("");
  });

  it("negate wraps the expression so a sum keeps its meaning", () => {
    // -(3+4) is unambiguous where a prefixed -3+4 would silently change the sum.
    expect(press("3", "add", "4", "negate").entry).toBe("-(3+4)");
  });

  it("negate is reversible", () => {
    expect(press("5", "negate", "negate").entry).toBe("5");
  });

  it("negate does nothing on an empty entry", () => {
    expect(press("negate").entry).toBe("");
  });

  it("clears the error on the next keystroke", () => {
    const failed = press("1", "divide", "0", "equals");
    expect(failed.error).toBeDefined();
    expect(applyKey(failed, key("clear")).error).toBeUndefined();
    expect(applyKey(failed, key("5")).error).toBeUndefined();
  });
});

describe("applyKey — the angle mode toggle", () => {
  it("flips between degrees and radians", () => {
    const first = applyKey(initialState("deg"), key("angle"));
    expect(first.angleMode).toBe("rad");
    expect(applyKey(first, key("angle")).angleMode).toBe("deg");
  });

  it("keeps what was typed, changing only what it means", () => {
    const state = applyKey(press("sin", "4", "5"), key("angle"));
    expect(state.entry).toBe("sin(45");
  });
});

describe("keyForKeyboardEvent", () => {
  it("maps digits and operators", () => {
    expect(keyForKeyboardEvent("7")?.id).toBe("7");
    expect(keyForKeyboardEvent("+")?.id).toBe("add");
    expect(keyForKeyboardEvent("*")?.id).toBe("multiply");
    expect(keyForKeyboardEvent("/")?.id).toBe("divide");
  });

  it("maps both Enter and = to equals", () => {
    expect(keyForKeyboardEvent("Enter")?.id).toBe("equals");
    expect(keyForKeyboardEvent("=")?.id).toBe("equals");
  });

  it("maps Escape to clear and Backspace to backspace", () => {
    expect(keyForKeyboardEvent("Escape")?.id).toBe("clear");
    expect(keyForKeyboardEvent("Backspace")?.action).toBe("backspace");
  });

  it("ignores a key the calculator has no use for", () => {
    // Important because the window is non-modal: an unmapped key must fall through to
    // the page rather than being swallowed.
    expect(keyForKeyboardEvent("a")).toBeUndefined();
    expect(keyForKeyboardEvent("Tab")).toBeUndefined();
    expect(keyForKeyboardEvent("ArrowLeft")).toBeUndefined();
  });
});

describe("the keypad catalogue", () => {
  it("has no duplicate ids", () => {
    const ids = ALL_KEYS.map((candidate) => candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every insert key something to insert", () => {
    for (const candidate of ALL_KEYS) {
      if (candidate.action === "insert") {
        expect(candidate.insert, candidate.id).toBeTruthy();
      }
    }
  });

  it("binds no physical key to two buttons", () => {
    const bound = ALL_KEYS.flatMap((candidate) => candidate.keys ?? []);
    expect(new Set(bound).size).toBe(bound.length);
  });
});

describe("calculate", () => {
  it("evaluates a whole expression, formatted as the display would show it", () => {
    expect(calculate("2+2")).toEqual({ ok: true, result: "4" });
    expect(calculate("0.1+0.2")).toEqual({ ok: true, result: "0.3" });
  });

  it("defaults to degrees, matching the keypad's default", () => {
    expect(calculate("sin(90)")).toEqual({ ok: true, result: "1" });
  });

  it("returns the message rather than throwing", () => {
    const outcome = calculate("1/0");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("divide by zero");
  });
});
