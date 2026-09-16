// The tokeniser: an expression string to a flat list of tokens.
//
// Hand-written, and deliberately not `eval()` / `new Function()`. Those would be
// arbitrary code execution on a string — this app already treats uploaded SVG as
// hostile and sanitises it to an allowlist, so accepting a string and *running* it
// would be inconsistent with the standard the rest of the codebase holds. A tokeniser
// plus the shunting-yard evaluator next door is ~200 lines, has no dependencies, and
// can only ever produce a number.

import { FUNCTION_NAMES, isFunctionName } from "./functions";

export type TokenKind =
  | "number"
  | "operator"
  | "function"
  | "constant"
  | "left-paren"
  | "right-paren";

export interface Token {
  kind: TokenKind;
  /** The source text: `"3.5"`, `"+"`, `"sin"`, `"pi"`. */
  value: string;
  /**
   * For an operator, whether it takes one operand or two.
   *
   * Resolved *here* rather than in the evaluator because it depends on what came
   * before: the `-` in `-5` and the `-` in `3-5` are the same character and different
   * operators. The tokeniser is the only place with the preceding token to hand, so
   * deciding it later would mean re-walking the list.
   */
  arity?: 1 | 2;
}

/** Thrown for input the tokeniser cannot make sense of at all. */
export class TokenizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenizeError";
  }
}

/** The constants a reader can type, as names. Values live in `functions.ts`. */
export const CONSTANT_NAMES = ["pi", "e"] as const;

const OPERATORS = new Set(["+", "-", "*", "/", "^", "%", "!"]);

/**
 * Characters that may appear in an expression, for a cheap early reject.
 *
 * Whitespace is allowed and discarded; everything else must be a digit, a decimal
 * point, an operator, a parenthesis, or a letter (which will be read as a function or
 * constant name). Anything else — a semicolon, a backtick, a bracket — is refused
 * rather than silently skipped, because a character we don't understand means the
 * reader's intent is unknown, and guessing at it is how a wrong answer gets rendered
 * confidently.
 */
const ALLOWED = /^[0-9a-zA-Z.+\-*/^%!()\s,√π×÷]*$/;

/**
 * Whether a `+`/`-` in this position is a sign rather than an addition.
 *
 * It is unary exactly when there is nothing to its left to operate on: at the very
 * start, after another operator, or after an opening parenthesis. `3 * -2` and `-3`
 * both hit this; `3 - 2` does not.
 */
function isUnaryPosition(previous: Token | undefined): boolean {
  if (previous === undefined) return true;
  return (
    previous.kind === "left-paren" ||
    // A postfix `!` completes its operand, so a following `-` is binary: `5!-2`.
    (previous.kind === "operator" && previous.value !== "!")
  );
}

/**
 * Normalises the symbols a reader may type or a keypad may insert.
 *
 * The keypad's buttons read `×`, `÷` and `√` because that is what a calculator looks
 * like, while the evaluator works in ASCII. Mapping them here means the pretty symbols
 * never reach the parser and the parser never has to know they exist.
 */
function normalize(input: string): string {
  return input
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/√/g, "sqrt")
    .replace(/π/g, "pi");
}

/**
 * Splits an expression into tokens.
 *
 * Throws `TokenizeError` only for input that is not expressible at all (a stray
 * character, a malformed number like `1.2.3`). Structural problems — unbalanced
 * parentheses, a trailing operator — are *not* detected here; they are the evaluator's
 * to report, because that is where the structure is actually known. Splitting the
 * responsibility this way keeps each piece small and means a test can pin exactly which
 * stage rejects what.
 */
export function tokenize(input: string): Token[] {
  const source = normalize(input);
  if (!ALLOWED.test(source)) {
    throw new TokenizeError("That expression contains a character the calculator cannot read.");
  }

  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    // A number: digits with at most one decimal point. Read greedily, so `3.14` is one
    // token rather than three.
    if (/[0-9.]/.test(character)) {
      let text = "";
      while (index < source.length && /[0-9.]/.test(source[index])) {
        text += source[index];
        index += 1;
      }
      // `Number("1.2.3")` is NaN rather than a throw, so this is checked explicitly —
      // otherwise a typo would evaluate to NaN and be *displayed* as a result.
      if (!Number.isFinite(Number(text))) {
        throw new TokenizeError(`"${text}" is not a number.`);
      }
      tokens.push({ kind: "number", value: text });
      continue;
    }

    // A name: a function (`sin`, `log`) or a constant (`pi`, `e`). Read greedily and
    // then classified, rather than matched prefix-first — `e` is a constant but the `e`
    // starting `exp` is not, and only the whole run can tell them apart.
    if (/[a-zA-Z]/.test(character)) {
      let name = "";
      while (index < source.length && /[a-zA-Z0-9]/.test(source[index])) {
        name += source[index];
        index += 1;
      }
      const lower = name.toLowerCase();
      if (isFunctionName(lower)) {
        tokens.push({ kind: "function", value: lower });
      } else if ((CONSTANT_NAMES as readonly string[]).includes(lower)) {
        tokens.push({ kind: "constant", value: lower });
      } else {
        throw new TokenizeError(
          `"${name}" isn't a function this calculator knows. Try one of: ${FUNCTION_NAMES.slice(0, 6).join(", ")}…`,
        );
      }
      continue;
    }

    if (character === "(") {
      tokens.push({ kind: "left-paren", value: character });
      index += 1;
      continue;
    }

    if (character === ")") {
      tokens.push({ kind: "right-paren", value: character });
      index += 1;
      continue;
    }

    if (OPERATORS.has(character)) {
      // `!` is postfix and always unary; `+`/`-` depend on position; the rest are binary.
      const arity: 1 | 2 =
        character === "!"
          ? 1
          : (character === "-" || character === "+") && isUnaryPosition(tokens[tokens.length - 1])
            ? 1
            : 2;
      tokens.push({ kind: "operator", value: character, arity });
      index += 1;
      continue;
    }

    // Unreachable while ALLOWED and the branches above agree, but a silent skip here
    // would drop a character and change the answer, so it fails loudly instead.
    throw new TokenizeError(`Unexpected character "${character}".`);
  }

  return tokens;
}
