// The scientific function catalogue, and the constants.
//
// Each function declares its own domain check, so "undefined for this input" is a fact
// about the function rather than a pile of special cases in the evaluator. That is what
// keeps `sqrt(-1)`, `ln(0)` and `asin(2)` reporting a *domain* error instead of quietly
// returning NaN and displaying it as an answer.

import type { AngleMode, CalculatorError } from "./types";

/** A function's implementation: an argument and the angle mode, in; a result, out. */
type Implementation = (argument: number, angleMode: AngleMode) => number;

interface FunctionSpec {
  /** What the reader types, lowercase. */
  name: string;
  implementation: Implementation;
  /**
   * Returns an error when the argument is outside the function's domain, else
   * `undefined`.
   *
   * Checked *before* the implementation runs, so the result can never be NaN by the
   * time it reaches the display. `Math.log(0)` is `-Infinity` and `Math.asin(2)` is
   * `NaN`; both would otherwise render as a confident-looking answer.
   */
  domainError?: (argument: number) => CalculatorError | undefined;
}

const DEGREES_PER_RADIAN = 180 / Math.PI;

/** Degrees to radians when the reader is working in degrees; otherwise unchanged. */
function toRadians(value: number, angleMode: AngleMode): number {
  return angleMode === "deg" ? value / DEGREES_PER_RADIAN : value;
}

/** Radians to degrees on the way out of an inverse trig function. */
function fromRadians(value: number, angleMode: AngleMode): number {
  return angleMode === "deg" ? value * DEGREES_PER_RADIAN : value;
}

const domain = (message: string): CalculatorError => ({ kind: "domain", message });

/**
 * Factorial, for non-negative integers only.
 *
 * Iterative rather than recursive: `170!` is the largest representable value and a
 * 170-deep recursion is pointless where a loop does. Above 170 the product overflows to
 * `Infinity`, which the caller reports as an overflow rather than displaying.
 */
function factorial(n: number): number {
  let product = 1;
  for (let multiplier = 2; multiplier <= n; multiplier += 1) {
    product *= multiplier;
  }
  return product;
}

/**
 * Whether `n` is a non-negative integer — the factorial domain.
 *
 * `Number.isInteger` is the check, not `n % 1 === 0`: the latter is true for `Infinity`.
 */
export function isFactorialInput(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

export { factorial };

/**
 * THE function table.
 *
 * Ordered roughly as a calculator's keys are grouped — trig, then inverse trig, then
 * logs, then roots and rounding — because `FUNCTION_NAMES` is what the error message
 * samples when a reader types something unknown.
 */
const FUNCTIONS: FunctionSpec[] = [
  { name: "sin", implementation: (x, mode) => Math.sin(toRadians(x, mode)) },
  { name: "cos", implementation: (x, mode) => Math.cos(toRadians(x, mode)) },
  {
    name: "tan",
    implementation: (x, mode) => Math.tan(toRadians(x, mode)),
    // `tan(90°)` is infinite. In radians the reader can never type the exact float that
    // would trip it, so this is checked in degrees only — where it is easy to hit and
    // `Math.tan` returns 1.633e16 rather than Infinity, which would display as a
    // plausible-looking enormous number instead of an error.
    domainError: (x) =>
      Number.isInteger((x - 90) / 180)
        ? domain("Tangent is undefined at 90° and every 180° after it.")
        : undefined,
  },
  {
    name: "asin",
    implementation: (x, mode) => fromRadians(Math.asin(x), mode),
    domainError: (x) =>
      x < -1 || x > 1 ? domain("Inverse sine needs a value between -1 and 1.") : undefined,
  },
  {
    name: "acos",
    implementation: (x, mode) => fromRadians(Math.acos(x), mode),
    domainError: (x) =>
      x < -1 || x > 1 ? domain("Inverse cosine needs a value between -1 and 1.") : undefined,
  },
  { name: "atan", implementation: (x, mode) => fromRadians(Math.atan(x), mode) },
  {
    name: "ln",
    implementation: (x) => Math.log(x),
    domainError: (x) =>
      x <= 0 ? domain("The natural log needs a value above zero.") : undefined,
  },
  {
    name: "log",
    implementation: (x) => Math.log10(x),
    domainError: (x) => (x <= 0 ? domain("The log needs a value above zero.") : undefined),
  },
  {
    name: "sqrt",
    implementation: (x) => Math.sqrt(x),
    domainError: (x) =>
      x < 0 ? domain("The square root of a negative number isn't a real number.") : undefined,
  },
  // The cube root is defined for negatives, unlike the square root — `Math.cbrt(-8)` is
  // -2, which is correct and needs no guard.
  { name: "cbrt", implementation: (x) => Math.cbrt(x) },
  { name: "exp", implementation: (x) => Math.exp(x) },
  { name: "abs", implementation: (x) => Math.abs(x) },
  { name: "round", implementation: (x) => Math.round(x) },
  { name: "floor", implementation: (x) => Math.floor(x) },
  { name: "ceil", implementation: (x) => Math.ceil(x) },
];

const BY_NAME = new Map(FUNCTIONS.map((specification) => [specification.name, specification]));

/** Every function name, for the keypad and for the tokeniser's error message. */
export const FUNCTION_NAMES: readonly string[] = FUNCTIONS.map(
  (specification) => specification.name,
);

/** Whether `name` is a function this calculator knows. */
export function isFunctionName(name: string): boolean {
  return BY_NAME.has(name);
}

/**
 * Applies a function, or returns why it can't be.
 *
 * The domain check runs first and the result is checked for finiteness afterwards, so
 * this can only ever hand back a real, finite number or an error — the evaluator never
 * has to wonder whether a NaN slipped through.
 */
export function applyFunction(
  name: string,
  argument: number,
  angleMode: AngleMode,
): { ok: true; value: number } | { ok: false; error: CalculatorError } {
  const specification = BY_NAME.get(name);
  if (!specification) {
    return { ok: false, error: { kind: "syntax", message: `Unknown function "${name}".` } };
  }

  const domainProblem = specification.domainError?.(argument);
  if (domainProblem) return { ok: false, error: domainProblem };

  const value = specification.implementation(argument, angleMode);

  if (Number.isNaN(value)) {
    return {
      ok: false,
      error: domain(`${name} isn't defined for that value.`),
    };
  }
  if (!Number.isFinite(value)) {
    return {
      ok: false,
      error: { kind: "overflow", message: "That result is too large to show." },
    };
  }

  return { ok: true, value };
}

/** The constants, by the name a reader types. */
export const CONSTANTS: Readonly<Record<string, number>> = Object.freeze({
  pi: Math.PI,
  e: Math.E,
});
