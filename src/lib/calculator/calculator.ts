// The state machine: a state and a key in, a new state out.
//
// A pure function, which is the point. Every behaviour a reader would call "how the
// calculator works" -- that a digit after `=` starts fresh but an operator continues,
// that AC never touches the history, that an error clears on the next keystroke -- is
// decided here and tested without rendering anything. The component holds the current
// value and draws it; it makes no decisions.

import { evaluate } from "./evaluate";
import { formatResult } from "./format";
import type { CalculatorKey } from "./keypad";
import type { AngleMode, CalculatorState } from "./types";

/** A fresh calculator. `angleMode` is the reader's stored preference, so it is passed in. */
export function initialState(angleMode: AngleMode = "deg"): CalculatorState {
  return { entry: "", justEvaluated: false, angleMode };
}

/**
 * Whether `text` ends in a binary operator — meaning the expression is unfinished.
 *
 * Used to decide whether an operator pressed now should *replace* the last one
 * (`3 + ×` becomes `3 ×`, what the reader obviously meant) rather than append and
 * produce a syntax error. `(` is excluded: `sin(-` is a legitimate thing to be
 * halfway through typing.
 */
function endsWithOperator(text: string): boolean {
  return /[+\-×÷*/^%]$/.test(text.trimEnd());
}

/**
 * What a key does, as a new state.
 *
 * `onCalculated` is a callback rather than a return value because recording history is
 * I/O and this function is pure -- it reports *that* a calculation completed and lets
 * the caller decide whether to persist it. The state machine stays testable with no
 * database, and a calculation evaluated from the CLI records history through the same
 * path the window does.
 */
export function applyKey(
  state: CalculatorState,
  key: CalculatorKey,
  onCalculated?: (expression: string, result: string) => void,
): CalculatorState {
  switch (key.action) {
    case "clear":
      // AC clears the display and nothing else. The tape is explicitly out of scope --
      // a calculator that forgot your working-out because you pressed clear would be a
      // bug, so wiping history is its own deliberate control.
      return initialState(state.angleMode);

    case "angle-mode":
      // The expression survives the toggle: switching to radians mid-`sin(45` should
      // change what it *means*, not delete what was typed.
      return {
        ...state,
        angleMode: state.angleMode === "deg" ? "rad" : "deg",
        error: undefined,
      };

    case "backspace": {
      // After `=` there is no keystroke to take back -- the entry holds a result, not
      // something typed -- so backspace clears rather than truncating a number that
      // was never typed digit by digit.
      if (state.justEvaluated) return initialState(state.angleMode);
      return {
        ...state,
        entry: state.entry.slice(0, -1),
        error: undefined,
        justEvaluated: false,
      };
    }

    case "negate": {
      // Wraps rather than prefixing: `-(3+4)` is unambiguous where `-3+4` would silently
      // change the sum. Toggles back off if it is already wrapped, so ± is reversible.
      const trimmed = state.entry.trim();
      if (trimmed === "") return state;
      const next = trimmed.startsWith("-(") && trimmed.endsWith(")")
        ? trimmed.slice(2, -1)
        : `-(${trimmed})`;
      return { ...state, entry: next, error: undefined, justEvaluated: false };
    }

    case "equals": {
      if (state.entry.trim() === "") return state;

      const result = evaluate(state.entry, state.angleMode);
      if (!result.ok) {
        // The failed expression is kept on screen. Clearing it would make the reader
        // retype the whole thing to fix one character.
        return { ...state, error: result.error, justEvaluated: false };
      }

      const formatted = formatResult(result.value);
      onCalculated?.(state.entry.trim(), formatted);

      return {
        ...state,
        entry: formatted,
        lastResult: formatted,
        error: undefined,
        justEvaluated: true,
      };
    }

    case "insert": {
      const insert = key.insert ?? "";

      // The rule every physical calculator follows, and the reason `justEvaluated`
      // exists as a field: after `=`, a *digit* starts a new calculation while an
      // *operator* continues from the result. `2+2=` then `×3` is 12; `2+2=` then `5`
      // is 5, not 45.
      if (state.justEvaluated) {
        const continues = /^[+\-×÷*/^%!]/.test(insert);
        return {
          ...state,
          entry: continues ? `${state.entry}${insert}` : insert,
          error: undefined,
          justEvaluated: false,
        };
      }

      // Two operators in a row: replace rather than append. `3+×` is what a reader
      // produces when they change their mind, and it should mean `3×`.
      if (/^[+\-×÷*/^%]$/.test(insert) && endsWithOperator(state.entry)) {
        return {
          ...state,
          entry: `${state.entry.trimEnd().slice(0, -1)}${insert}`,
          error: undefined,
          justEvaluated: false,
        };
      }

      return {
        ...state,
        entry: `${state.entry}${insert}`,
        error: undefined,
        justEvaluated: false,
      };
    }
  }
}

/**
 * Evaluates a whole expression in one call — the CLI's entry point, and a convenience
 * for anything that has a complete expression rather than keystrokes.
 *
 * Returns the formatted string so the terminal and the window agree character for
 * character, which is the ARCHITECTURE.md contract: one use-case, two adapters, same
 * output.
 */
export function calculate(
  expression: string,
  angleMode: AngleMode = "deg",
): { ok: true; result: string } | { ok: false; message: string } {
  const result = evaluate(expression, angleMode);
  return result.ok
    ? { ok: true, result: formatResult(result.value) }
    : { ok: false, message: result.error.message };
}
