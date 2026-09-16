/**
 * The scientific calculator's domain types.
 *
 * All of it is pure data. The evaluator takes a string and returns a number or an error;
 * the state machine takes a state and a key and returns a new state. Nothing here knows
 * about a window, a puck, or a database — which is what lets the whole calculator be
 * driven from a terminal and tested without a browser.
 */

/**
 * Whether trigonometric functions read their argument as degrees or radians.
 *
 * A stored preference, not view state, because it changes the *answer*: `sin(90)` is 1
 * in degrees and 0.8939… in radians. A reader who sets degrees once should not have to
 * set it again after a reload and silently get different numbers in between.
 */
export type AngleMode = "deg" | "rad";

/**
 * Why an expression could not be evaluated.
 *
 * A closed union rather than a free-text message, so the view can decide how to present
 * each one and a test can assert which happened. The display shows a short label; the
 * distinctions matter because they are the difference between "you mistyped" and
 * "that question has no answer".
 */
export type CalculatorErrorKind =
  /** Parentheses don't balance, an operator has no operand, a function has no argument. */
  | "syntax"
  /** Division by zero. Kept apart from `domain` because it is by far the most common. */
  | "divide-by-zero"
  /** Mathematically undefined for the input: `sqrt(-1)`, `ln(0)`, `asin(2)`, `(-1)!`. */
  | "domain"
  /** The result is finite in theory but not representable: `170!` overflows to Infinity. */
  | "overflow";

/** A failed evaluation. */
export interface CalculatorError {
  kind: CalculatorErrorKind;
  /** A short phrase for the display, e.g. "Cannot divide by zero". */
  message: string;
}

/**
 * The result of evaluating an expression: a number, or why not.
 *
 * A discriminated union rather than `number | undefined` or a thrown exception. The
 * evaluator is called on every `=`, and an expected, routine outcome like "you divided
 * by zero" is not an exceptional condition — making it a return value means the caller
 * cannot forget to handle it, and the state machine stays a pure function.
 */
export type EvaluationResult =
  | { ok: true; value: number }
  | { ok: false; error: CalculatorError };

/**
 * One line of the tape: what was asked, and what came back.
 *
 * `result` is the formatted string rather than a number, deliberately. The tape is a
 * record of what the reader *saw*, so re-formatting an old entry under today's rules
 * would rewrite history — and a `0.30000000000000004` that displayed as `0.3` should
 * stay `0.3` in the list.
 */
export interface CalculationEntry {
  id: number;
  expression: string;
  result: string;
  /** ISO 8601, from the database. */
  createdAt: string;
}

/**
 * The calculator's whole visible state.
 *
 * One object rather than five `useState` calls, because the transitions move several
 * fields at once and the illegal in-between states shouldn't be representable: after
 * `=` the entry becomes the result *and* `justEvaluated` flips *and* the error clears,
 * and three separate setters is how one of those gets forgotten.
 */
export interface CalculatorState {
  /**
   * What the reader is building, as they typed it: `"3 + sin(45)"`. The display's top
   * line, and what `=` evaluates. Blank is a fresh calculator.
   */
  entry: string;
  /**
   * The last successful result, formatted — the display's big line, and **the image the
   * puck shows when minimized**. `undefined` until the first `=`.
   */
  lastResult?: string;
  /** Set when the last `=` failed. Cleared by the next keystroke. */
  error?: CalculatorError;
  /**
   * True immediately after `=`. It decides what a digit does next: typing a digit
   * starts a *new* calculation, while typing an operator *continues* from the result.
   * That is how every physical calculator behaves and it cannot be derived from the
   * other fields — `entry` looks the same either way.
   */
  justEvaluated: boolean;
  angleMode: AngleMode;
}
