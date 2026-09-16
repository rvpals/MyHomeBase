import {
  ALL_KEYS,
  FUNCTION_NAMES,
  HISTORY_LIMIT,
  calculateAndRecord,
  clearCalculations,
  listCalculations,
} from "@/lib/calculator";
import { listUsers } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * Evaluates an expression, or reads and clears the tape — the same use-cases the
 * floating window drives, so the two cannot diverge.
 *
 *   calculator --user min --expression "2+2"
 *   calculator --user min --expression "sin(90)" --angle deg
 *   calculator --user min --history
 *   calculator --user min --clear-history
 *   calculator --functions
 *
 * The point of this command is not convenience: it is the ARCHITECTURE.md contract that
 * every use-case is reachable from a terminal. It is also how the evaluator gets
 * debugged against a real expression without opening a browser — which is exactly what
 * the precedence and domain cases in `evaluate.test.ts` were written from.
 */
export async function calculatorCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  // `--functions` needs no user: it prints the catalogue, which is code, not data.
  if (flags.functions !== undefined) {
    console.log("Functions:");
    console.log(`  ${FUNCTION_NAMES.join(", ")}`);
    console.log("Constants:");
    console.log("  pi, e");
    console.log("Operators:");
    console.log("  + - * / ^ % !   (% is modulo; ! is factorial)");
    console.log("Keypad:");
    console.log(`  ${ALL_KEYS.length} keys — see src/lib/calculator/keypad.ts`);
    return;
  }

  const username = flags.user;
  if (!username) {
    console.error(
      'Usage: calculator --user <username> --expression "<sum>" [--angle deg|rad]\n' +
        "       calculator --user <username> --history\n" +
        "       calculator --user <username> --clear-history\n" +
        "       calculator --functions",
    );
    process.exitCode = 1;
    return;
  }

  const user = listUsers(deps.userRepo).find((candidate) => candidate.username === username);
  if (!user) {
    console.error(`No user with the username "${username}".`);
    process.exitCode = 1;
    return;
  }

  if (flags["clear-history"] !== undefined) {
    clearCalculations(deps.calculatorHistoryRepo, user.id);
    console.log(`Cleared the calculation history for ${username}.`);
    return;
  }

  if (flags.history !== undefined) {
    const tape = listCalculations(deps.calculatorHistoryRepo, user.id);
    if (tape.length === 0) {
      console.log(`No calculations recorded for ${username}.`);
      return;
    }
    console.log(`Calculations for ${username} (newest first, up to ${HISTORY_LIMIT}):`);
    for (const entry of tape) {
      console.log(`  ${entry.createdAt}  ${entry.expression} = ${entry.result}`);
    }
    return;
  }

  const expression = flags.expression;
  if (expression === undefined) {
    console.error('Give --expression "<sum>", --history, or --clear-history.');
    process.exitCode = 1;
    return;
  }

  // Rejected here rather than left to the schema's `.catch`, matching how
  // `user-preferences` handles `--nav-style`: at a terminal, silently computing in a
  // different angle mode than the one typed is worse than an error.
  const angle = flags.angle;
  if (angle !== undefined && angle !== "deg" && angle !== "rad") {
    console.error(`--angle takes deg or rad, not "${angle}".`);
    process.exitCode = 1;
    return;
  }

  try {
    const outcome = calculateAndRecord(deps.calculatorHistoryRepo, user.id, {
      expression,
      angleMode: angle,
    });

    if (!outcome.ok) {
      // A failed sum is a non-zero exit, so a script can tell a syntax error from an
      // answer without parsing stdout.
      console.error(outcome.message);
      process.exitCode = 1;
      return;
    }

    // Just the result on stdout, so the command composes: `calculator … | xargs`.
    console.log(outcome.result);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to calculate.");
    process.exitCode = 1;
  }
}
