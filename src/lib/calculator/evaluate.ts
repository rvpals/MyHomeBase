// The evaluator: tokens to a number, by the shunting-yard algorithm.
//
// Two passes rather than one. `toPostfix` turns the infix tokens the reader typed into
// Reverse Polish order, which is where operator precedence and associativity are
// decided; `evaluatePostfix` then walks that list with a value stack and never has to
// think about precedence again. Splitting them is what makes the precedence rules
// testable on their own -- `2+3*4` producing `2 3 4 * +` is a fact you can assert
// directly, rather than inferring it from the number 14.

import { CONSTANTS, applyFunction, factorial, isFactorialInput } from "./functions";
import { TokenizeError, tokenize, type Token } from "./tokenize";
import type { AngleMode, CalculatorError, EvaluationResult } from "./types";

/**
 * Operator precedence. Higher binds tighter.
 *
 * `!` (factorial) outranks `^` so `3!^2` is `(3!)^2` = 36, and unary minus sits *below*
 * `^` so `-2^2` is `-(2^2)` = -4 — which is the mathematical convention and the one
 * every scientific calculator follows, however surprising it looks.
 */
const PRECEDENCE: Readonly<Record<string, number>> = {
  "+": 1,
  "-": 1,
  "*": 2,
  "/": 2,
  "%": 2,
  // Unary minus/plus. Named separately from binary `-` because they share a character
  // but not a precedence; the tokeniser has already told us which is which via `arity`.
  "unary": 3,
  "^": 4,
  "!": 5,
};

/** `^` is the only right-associative operator: `2^3^2` is `2^(3^2)` = 512, not 64. */
const RIGHT_ASSOCIATIVE = new Set(["^", "unary"]);

const syntax = (message: string): CalculatorError => ({ kind: "syntax", message });

/** The precedence key for a token — unary +/- are ranked as `unary`, not as themselves. */
function precedenceKey(token: Token): string {
  return token.kind === "operator" && token.arity === 1 && token.value !== "!"
    ? "unary"
    : token.value;
}

/**
 * Infix tokens to postfix (RPN).
 *
 * Exported so the precedence rules can be tested without also testing the arithmetic.
 * Returns the reordered tokens, or a syntax error for structure that cannot be parsed —
 * which is where unbalanced parentheses are caught, since this is the stage that
 * actually tracks them.
 */
export function toPostfix(
  tokens: Token[],
): { ok: true; output: Token[] } | { ok: false; error: CalculatorError } {
  const output: Token[] = [];
  const stack: Token[] = [];

  for (const token of tokens) {
    switch (token.kind) {
      case "number":
      case "constant":
        output.push(token);
        break;

      case "function":
        // A function waits on the stack until its closing parenthesis pops it, exactly
        // as an operator does.
        stack.push(token);
        break;

      case "operator": {
        // Postfix `!` applies to what is already there, so it never waits.
        if (token.value === "!") {
          output.push(token);
          break;
        }
        const incoming = PRECEDENCE[precedenceKey(token)];
        while (stack.length > 0) {
          const top = stack[stack.length - 1];
          if (top.kind !== "operator") break;
          const sitting = PRECEDENCE[precedenceKey(top)];
          // Pop while the operator on top binds at least as tightly — strictly
          // tighter for a right-associative operator, which is the whole difference
          // between `2^3^2` grouping right and grouping left.
          const shouldPop = RIGHT_ASSOCIATIVE.has(precedenceKey(token))
            ? sitting > incoming
            : sitting >= incoming;
          if (!shouldPop) break;
          output.push(stack.pop() as Token);
        }
        stack.push(token);
        break;
      }

      case "left-paren":
        stack.push(token);
        break;

      case "right-paren": {
        let foundOpening = false;
        while (stack.length > 0) {
          const top = stack.pop() as Token;
          if (top.kind === "left-paren") {
            foundOpening = true;
            break;
          }
          output.push(top);
        }
        if (!foundOpening) {
          return { ok: false, error: syntax("There's a ) with no matching (.") };
        }
        // A function's parenthesis has just closed, so the function itself now applies.
        const top = stack[stack.length - 1];
        if (top?.kind === "function") output.push(stack.pop() as Token);
        break;
      }
    }
  }

  while (stack.length > 0) {
    const top = stack.pop() as Token;
    if (top.kind === "left-paren") {
      return { ok: false, error: syntax("There's a ( with no matching ).") };
    }
    output.push(top);
  }

  return { ok: true, output };
}

/** Applies a binary operator, reporting division by zero rather than returning Infinity. */
function applyBinary(
  operator: string,
  left: number,
  right: number,
): { ok: true; value: number } | { ok: false; error: CalculatorError } {
  switch (operator) {
    case "+":
      return { ok: true, value: left + right };
    case "-":
      return { ok: true, value: left - right };
    case "*":
      return { ok: true, value: left * right };
    case "/":
    case "%":
      // Its own error kind because it is much the most common, and because "cannot
      // divide by zero" is a more useful thing to read than "undefined".
      if (right === 0) {
        return {
          ok: false,
          error: { kind: "divide-by-zero", message: "Cannot divide by zero." },
        };
      }
      return { ok: true, value: operator === "/" ? left / right : left % right };
    case "^": {
      const value = Math.pow(left, right);
      // `(-8)^(1/3)` is NaN in IEEE arithmetic rather than -2. Reported as a domain
      // error instead of displaying NaN; `cbrt` is the function for that intent.
      if (Number.isNaN(value)) {
        return {
          ok: false,
          error: {
            kind: "domain",
            message: "A negative base with a fractional power isn't a real number.",
          },
        };
      }
      return { ok: true, value };
    }
    default:
      return { ok: false, error: syntax(`Unknown operator "${operator}".`) };
  }
}

/**
 * Evaluates a postfix token list.
 *
 * Exported alongside `toPostfix` so each half can be tested in isolation.
 */
export function evaluatePostfix(output: Token[], angleMode: AngleMode): EvaluationResult {
  const values: number[] = [];

  for (const token of output) {
    switch (token.kind) {
      case "number":
        values.push(Number(token.value));
        break;

      case "constant":
        values.push(CONSTANTS[token.value]);
        break;

      case "function": {
        const argument = values.pop();
        if (argument === undefined) {
          return { ok: false, error: syntax(`${token.value} needs a value to work on.`) };
        }
        const applied = applyFunction(token.value, argument, angleMode);
        if (!applied.ok) return applied;
        values.push(applied.value);
        break;
      }

      case "operator": {
        if (token.value === "!") {
          const operand = values.pop();
          if (operand === undefined) {
            return { ok: false, error: syntax("! needs a number before it.") };
          }
          if (!isFactorialInput(operand)) {
            return {
              ok: false,
              error: {
                kind: "domain",
                message: "Factorial only works on whole numbers from 0 up.",
              },
            };
          }
          const value = factorial(operand);
          if (!Number.isFinite(value)) {
            return {
              ok: false,
              error: { kind: "overflow", message: "That factorial is too large to show." },
            };
          }
          values.push(value);
          break;
        }

        if (token.arity === 1) {
          const operand = values.pop();
          if (operand === undefined) {
            return { ok: false, error: syntax(`${token.value} needs a number after it.`) };
          }
          values.push(token.value === "-" ? -operand : operand);
          break;
        }

        const right = values.pop();
        const left = values.pop();
        if (left === undefined || right === undefined) {
          return { ok: false, error: syntax(`${token.value} needs a number on each side.`) };
        }
        const applied = applyBinary(token.value, left, right);
        if (!applied.ok) return applied;
        values.push(applied.value);
        break;
      }

      // Parentheses never reach postfix — `toPostfix` consumes them all.
      default:
        return { ok: false, error: syntax("That expression doesn't parse.") };
    }
  }

  if (values.length === 0) {
    return { ok: false, error: syntax("There's nothing to calculate.") };
  }
  // More than one value left means operands with no operator between them, e.g. `2 3`.
  if (values.length > 1) {
    return { ok: false, error: syntax("That looks like two sums with no operator between.") };
  }

  const [value] = values;
  if (!Number.isFinite(value)) {
    return { ok: false, error: { kind: "overflow", message: "That result is too large to show." } };
  }

  return { ok: true, value };
}

/**
 * Evaluates an expression string.
 *
 * The one entry point the rest of the app uses. Never throws — a `TokenizeError` is
 * caught and returned as a syntax error, because an expression a reader mistyped is a
 * routine outcome and the caller shouldn't need a try/catch around every `=`.
 *
 * `angleMode` is a parameter rather than module state so the same expression is
 * reproducible: `evaluate("sin(90)", "deg")` is always 1, in a test and in the app.
 */
export function evaluate(input: string, angleMode: AngleMode = "rad"): EvaluationResult {
  if (input.trim() === "") {
    return { ok: false, error: syntax("There's nothing to calculate.") };
  }

  let tokens: Token[];
  try {
    tokens = tokenize(input);
  } catch (error) {
    return {
      ok: false,
      error: syntax(
        error instanceof TokenizeError ? error.message : "That expression doesn't parse.",
      ),
    };
  }

  const postfix = toPostfix(tokens);
  if (!postfix.ok) return postfix;

  return evaluatePostfix(postfix.output, angleMode);
}
