import { describe, expect, it } from "vitest";
import { evaluate, toPostfix } from "./evaluate";
import { tokenize } from "./tokenize";

/** The value, or a thrown assertion — keeps the arithmetic cases to one line each. */
function value(expression: string, mode: "deg" | "rad" = "rad"): number {
  const result = evaluate(expression, mode);
  if (!result.ok) throw new Error(`Expected a value, got: ${result.error.message}`);
  return result.value;
}

/** The error kind, for the failure cases. */
function errorKind(expression: string): string {
  const result = evaluate(expression, "deg");
  if (result.ok) throw new Error(`Expected an error, got ${result.value}`);
  return result.error.kind;
}

describe("toPostfix — precedence and associativity", () => {
  /** The RPN as a space-joined string, so the ordering is asserted directly. */
  function rpn(expression: string): string {
    const result = toPostfix(tokenize(expression));
    if (!result.ok) throw new Error(result.error.message);
    return result.output.map((token) => token.value).join(" ");
  }

  it("gives multiplication higher precedence than addition", () => {
    expect(rpn("2+3*4")).toBe("2 3 4 * +");
  });

  it("keeps left-associative operators left-grouped", () => {
    // 8/4/2 is (8/4)/2 = 1, not 8/(4/2) = 4.
    expect(rpn("8/4/2")).toBe("8 4 / 2 /");
  });

  it("groups exponentiation to the right", () => {
    // The one right-associative operator: 2^3^2 is 2^(3^2).
    expect(rpn("2^3^2")).toBe("2 3 2 ^ ^");
  });

  it("respects parentheses over precedence", () => {
    expect(rpn("(2+3)*4")).toBe("2 3 + 4 *");
  });

  it("emits a function after its argument", () => {
    expect(rpn("sin(90)")).toBe("90 sin");
  });

  it("reports an unmatched opening parenthesis", () => {
    const result = toPostfix(tokenize("(2+3"));
    expect(result.ok).toBe(false);
  });

  it("reports an unmatched closing parenthesis", () => {
    const result = toPostfix(tokenize("2+3)"));
    expect(result.ok).toBe(false);
  });
});

describe("evaluate — arithmetic", () => {
  it("does the four operations", () => {
    expect(value("2+3")).toBe(5);
    expect(value("7-2")).toBe(5);
    expect(value("6*7")).toBe(42);
    expect(value("8/2")).toBe(4);
  });

  it("applies precedence rather than evaluating left to right", () => {
    expect(value("2+3*4")).toBe(14);
    expect(value("2+3*4")).not.toBe(20);
  });

  it("handles nested parentheses", () => {
    expect(value("((2+3)*(4-1))")).toBe(15);
  });

  it("reads a leading minus as a sign", () => {
    expect(value("-5")).toBe(-5);
    expect(value("-5+3")).toBe(-2);
  });

  it("reads a minus after an operator as a sign", () => {
    expect(value("3*-2")).toBe(-6);
    expect(value("3--2")).toBe(5);
  });

  it("binds unary minus below exponentiation, as mathematics does", () => {
    // -2^2 is -(2^2) = -4, not (-2)^2 = 4. Surprising but conventional, and every
    // scientific calculator agrees.
    expect(value("-2^2")).toBe(-4);
    expect(value("(-2)^2")).toBe(4);
  });

  it("does modulo", () => {
    expect(value("7%3")).toBe(1);
  });

  it("computes factorials, and ranks ! above ^", () => {
    expect(value("5!")).toBe(120);
    expect(value("0!")).toBe(1);
    // (3!)^2 = 36, not 3!^2 read as 3^(2!) or similar.
    expect(value("3!^2")).toBe(36);
  });

  it("treats a percentage-style expression as modulo, not percent", () => {
    // Documenting the deliberate choice: `%` is modulo on this keypad (labelled "mod"),
    // because a scientific calculator's % is ambiguous and mod is unambiguous.
    expect(value("10%4")).toBe(2);
  });
});

describe("evaluate — the float-precision cases", () => {
  it("returns the true IEEE value, leaving presentation to the formatter", () => {
    // The evaluator must not round: that is `formatResult`'s job, and a rounding here
    // would compound through a longer expression.
    expect(value("0.1+0.2")).toBeCloseTo(0.3, 15);
  });
});

describe("evaluate — constants and functions", () => {
  it("knows pi and e", () => {
    expect(value("pi")).toBeCloseTo(Math.PI, 12);
    expect(value("e")).toBeCloseTo(Math.E, 12);
  });

  it("accepts the keypad's pretty symbols", () => {
    // × ÷ √ π are what the buttons insert; the tokeniser normalises them.
    expect(value("6×7")).toBe(42);
    expect(value("8÷2")).toBe(4);
    expect(value("√(9)")).toBe(3);
    expect(value("π")).toBeCloseTo(Math.PI, 12);
  });

  it("respects the angle mode for trigonometry", () => {
    expect(value("sin(90)", "deg")).toBeCloseTo(1, 12);
    expect(value("sin(90)", "rad")).toBeCloseTo(0.8939966636, 8);
    expect(value("cos(0)", "deg")).toBe(1);
  });

  it("returns inverse trigonometry in the current angle mode", () => {
    expect(value("asin(1)", "deg")).toBeCloseTo(90, 10);
    expect(value("asin(1)", "rad")).toBeCloseTo(Math.PI / 2, 12);
  });

  it("does logs, roots and rounding", () => {
    expect(value("ln(e)")).toBeCloseTo(1, 12);
    expect(value("log(100)")).toBeCloseTo(2, 12);
    expect(value("sqrt(16)")).toBe(4);
    expect(value("cbrt(-8)")).toBe(-2);
    expect(value("abs(-3)")).toBe(3);
    expect(value("floor(2.7)")).toBe(2);
    expect(value("ceil(2.1)")).toBe(3);
    expect(value("round(2.5)")).toBe(3);
  });

  it("composes functions", () => {
    expect(value("sqrt(sqrt(16))")).toBe(2);
    expect(value("sin(cos(0))", "deg")).toBeCloseTo(Math.sin(Math.PI / 180), 12);
  });
});

describe("evaluate — the errors", () => {
  it("reports division by zero as its own kind", () => {
    expect(errorKind("1/0")).toBe("divide-by-zero");
    expect(errorKind("5%0")).toBe("divide-by-zero");
  });

  it("reports a domain error rather than returning NaN", () => {
    // Each of these is NaN or Infinity in raw IEEE arithmetic, and displaying that as
    // an answer is the bug these guards exist to prevent.
    expect(errorKind("sqrt(-1)")).toBe("domain");
    expect(errorKind("ln(0)")).toBe("domain");
    expect(errorKind("ln(-1)")).toBe("domain");
    expect(errorKind("log(0)")).toBe("domain");
    expect(errorKind("asin(2)")).toBe("domain");
    expect(errorKind("acos(-5)")).toBe("domain");
    expect(errorKind("(-8)^0.5")).toBe("domain");
  });

  it("reports tan at its asymptote in degrees", () => {
    // Math.tan(90°) is 1.633e16, which would display as a plausible huge number.
    expect(errorKind("tan(90)")).toBe("domain");
    expect(errorKind("tan(270)")).toBe("domain");
    expect(value("tan(45)", "deg")).toBeCloseTo(1, 12);
  });

  it("refuses a factorial of a negative or a fraction", () => {
    expect(errorKind("(-1)!")).toBe("domain");
    expect(errorKind("2.5!")).toBe("domain");
  });

  it("reports an overflow rather than showing Infinity", () => {
    expect(errorKind("200!")).toBe("overflow");
    expect(errorKind("9^9^9")).toBe("overflow");
  });

  it("reports a syntax error for an incomplete expression", () => {
    expect(errorKind("2+")).toBe("syntax");
    expect(errorKind("(2+3")).toBe("syntax");
    expect(errorKind("2+3)")).toBe("syntax");
    expect(errorKind("sin()")).toBe("syntax");
    expect(errorKind("2 3")).toBe("syntax");
    expect(errorKind("")).toBe("syntax");
    expect(errorKind("   ")).toBe("syntax");
  });

  it("refuses an unknown function instead of guessing", () => {
    expect(errorKind("frobnicate(2)")).toBe("syntax");
  });

  it("refuses characters that could only come from something other than the keypad", () => {
    // The tokeniser's allowlist. Not a security boundary — the evaluator can only ever
    // produce a number, since there is no eval() anywhere — but an unreadable character
    // means the reader's intent is unknown, and guessing is how a wrong answer gets
    // rendered confidently.
    expect(errorKind("2;3")).toBe("syntax");
    expect(errorKind("alert(1)")).toBe("syntax");
    expect(errorKind("[1]")).toBe("syntax");
  });

  it("refuses a malformed number rather than evaluating to NaN", () => {
    expect(errorKind("1.2.3")).toBe("syntax");
  });

  it("never throws, whatever it is given", () => {
    // The whole contract: `evaluate` is called on every `=`, so the caller must never
    // need a try/catch.
    const nasty = ["", "((((", "))))", "+++", "!!!", "sin", "1.2.3.4", "@#$", "0/0", "e^e^e^e"];
    for (const expression of nasty) {
      expect(() => evaluate(expression, "deg")).not.toThrow();
    }
  });
});
