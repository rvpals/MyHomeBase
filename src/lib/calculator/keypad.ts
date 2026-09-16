// The keypad, as data.
//
// A catalogue in `lib` rather than thirty buttons hardcoded in the view, for the reason
// `COMPACT_NAV_STYLES` and `CLOCK_FACE_OPTIONS` give: the keys, their labels and what
// each one does are facts about the calculator, and the CLI's help text lists the same
// set. It also means the view is a `.map` over a table instead of a wall of JSX, so a
// key can't be wired to the wrong handler.

/** What pressing a key does. */
export type KeyAction =
  /** Append `insert` to the expression. Digits, operators, functions, constants. */
  | "insert"
  /** Evaluate. */
  | "equals"
  /** Clear everything (AC) — but never the history. */
  | "clear"
  /** Delete the last character. */
  | "backspace"
  /** Flip the sign of the expression. */
  | "negate"
  /** Toggle degrees/radians. */
  | "angle-mode";

/**
 * How a key reads visually. The view maps these to styles; `lib` only says which is
 * which, because "the operators are a different colour from the digits" is a fact about
 * a calculator's layout, not about this app's palette.
 */
export type KeyTone = "digit" | "operator" | "function" | "action" | "danger";

export interface CalculatorKey {
  /** Stable id — also the React key, so it must be unique across the whole pad. */
  id: string;
  /** What the button shows. May be a symbol the tokeniser normalises (`×`, `√`, `π`). */
  label: string;
  action: KeyAction;
  /**
   * The text appended for an `insert` key. Omitted for every other action.
   *
   * Separate from `label` because they differ for most keys: the button reads `sin` but
   * inserts `sin(`, and reads `×` but inserts `×` which the tokeniser turns into `*`.
   */
  insert?: string;
  tone: KeyTone;
  /**
   * Physical keys that trigger this button, as `KeyboardEvent.key` values.
   *
   * Declared here so the keyboard map and the on-screen pad cannot disagree — the view
   * builds its handler from this same table rather than keeping a second list. Bound
   * only while focus is inside the calculator panel, never globally: the window is
   * non-modal, so a global handler would swallow typing meant for the page behind it.
   */
  keys?: readonly string[];
  /** Screen-reader name, where the label alone is a symbol. */
  ariaLabel?: string;
}

/**
 * The scientific rows, above the numeric pad.
 *
 * Grouped as a physical calculator groups them — trig together, logs together, roots
 * and powers together — rather than alphabetically, because a reader reaches for these
 * by position and muscle memory.
 */
export const SCIENTIFIC_KEYS: readonly CalculatorKey[] = [
  { id: "sin", label: "sin", action: "insert", insert: "sin(", tone: "function" },
  { id: "cos", label: "cos", action: "insert", insert: "cos(", tone: "function" },
  { id: "tan", label: "tan", action: "insert", insert: "tan(", tone: "function" },
  { id: "angle", label: "DEG", action: "angle-mode", tone: "action", ariaLabel: "Toggle degrees or radians" },

  { id: "asin", label: "sin⁻¹", action: "insert", insert: "asin(", tone: "function", ariaLabel: "Inverse sine" },
  { id: "acos", label: "cos⁻¹", action: "insert", insert: "acos(", tone: "function", ariaLabel: "Inverse cosine" },
  { id: "atan", label: "tan⁻¹", action: "insert", insert: "atan(", tone: "function", ariaLabel: "Inverse tangent" },
  { id: "pi", label: "π", action: "insert", insert: "π", tone: "function", ariaLabel: "Pi" },

  { id: "ln", label: "ln", action: "insert", insert: "ln(", tone: "function" },
  { id: "log", label: "log", action: "insert", insert: "log(", tone: "function" },
  { id: "exp", label: "eˣ", action: "insert", insert: "exp(", tone: "function", ariaLabel: "e to the power of" },
  { id: "e", label: "e", action: "insert", insert: "e", tone: "function", ariaLabel: "Euler's number" },

  { id: "sqrt", label: "√", action: "insert", insert: "√(", tone: "function", ariaLabel: "Square root" },
  { id: "power", label: "xʸ", action: "insert", insert: "^", tone: "function", keys: ["^"], ariaLabel: "To the power of" },
  { id: "factorial", label: "n!", action: "insert", insert: "!", tone: "function", keys: ["!"], ariaLabel: "Factorial" },
  { id: "percent", label: "mod", action: "insert", insert: "%", tone: "function", keys: ["%"], ariaLabel: "Modulo" },
];

/**
 * The numeric pad, parentheses and the four arithmetic operators.
 *
 * Laid out in the conventional 4-column grid, digits ascending from the bottom — the
 * arrangement on every calculator and phone dialpad, which is worth matching exactly
 * because the whole point of a keypad is that you don't have to read it.
 */
export const NUMERIC_KEYS: readonly CalculatorKey[] = [
  { id: "clear", label: "AC", action: "clear", tone: "danger", keys: ["Escape"], ariaLabel: "Clear" },
  { id: "open", label: "(", action: "insert", insert: "(", tone: "operator", keys: ["("] },
  { id: "close", label: ")", action: "insert", insert: ")", tone: "operator", keys: [")"] },
  { id: "divide", label: "÷", action: "insert", insert: "÷", tone: "operator", keys: ["/"], ariaLabel: "Divide" },

  { id: "7", label: "7", action: "insert", insert: "7", tone: "digit", keys: ["7"] },
  { id: "8", label: "8", action: "insert", insert: "8", tone: "digit", keys: ["8"] },
  { id: "9", label: "9", action: "insert", insert: "9", tone: "digit", keys: ["9"] },
  { id: "multiply", label: "×", action: "insert", insert: "×", tone: "operator", keys: ["*"], ariaLabel: "Multiply" },

  { id: "4", label: "4", action: "insert", insert: "4", tone: "digit", keys: ["4"] },
  { id: "5", label: "5", action: "insert", insert: "5", tone: "digit", keys: ["5"] },
  { id: "6", label: "6", action: "insert", insert: "6", tone: "digit", keys: ["6"] },
  { id: "subtract", label: "−", action: "insert", insert: "-", tone: "operator", keys: ["-"], ariaLabel: "Minus" },

  { id: "1", label: "1", action: "insert", insert: "1", tone: "digit", keys: ["1"] },
  { id: "2", label: "2", action: "insert", insert: "2", tone: "digit", keys: ["2"] },
  { id: "3", label: "3", action: "insert", insert: "3", tone: "digit", keys: ["3"] },
  { id: "add", label: "+", action: "insert", insert: "+", tone: "operator", keys: ["+"], ariaLabel: "Plus" },

  { id: "negate", label: "±", action: "negate", tone: "operator", ariaLabel: "Change sign" },
  { id: "0", label: "0", action: "insert", insert: "0", tone: "digit", keys: ["0"] },
  { id: "decimal", label: ".", action: "insert", insert: ".", tone: "digit", keys: ["."] },
  // Enter *and* "=" both evaluate: one is what a keyboard user reaches for, the other
  // is what someone who has been clicking the pad types next.
  { id: "equals", label: "=", action: "equals", tone: "action", keys: ["Enter", "="], ariaLabel: "Equals" },
];

/** Every key, for the keyboard map and the CLI's help. */
export const ALL_KEYS: readonly CalculatorKey[] = [...SCIENTIFIC_KEYS, ...NUMERIC_KEYS];

/**
 * The key a physical keypress maps to, or `undefined`.
 *
 * Built from the catalogue rather than a second switch statement, which is what stops
 * the keyboard and the buttons drifting apart. Backspace is handled here rather than as
 * a button, since a pad with no visible delete key still needs one on a keyboard.
 */
export function keyForKeyboardEvent(pressed: string): CalculatorKey | undefined {
  if (pressed === "Backspace") {
    return { id: "backspace", label: "⌫", action: "backspace", tone: "action" };
  }
  return ALL_KEYS.find((key) => key.keys?.includes(pressed));
}
