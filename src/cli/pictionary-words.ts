import {
  PICTIONARY_TIERS,
  clearCustomWords,
  countCustomWords,
  importWords,
  listCustomWords,
  listWordBank,
  type PictionaryTier,
} from "@/lib/games";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";
import { parseFlags } from "./parse-flags";

/**
 * Reads and edits the Pictionary word bank — the same use-cases the Configuration
 * screen calls.
 *
 *   npm run cli -- pictionary-words
 *   npm run cli -- pictionary-words --tier hard
 *   npm run cli -- pictionary-words --built-in
 *   npm run cli -- pictionary-words --add "volcano,bicycle,hot air balloon" --tier medium --user 1
 *   npm run cli -- pictionary-words --clear --tier easy
 *
 * With no flags it prints the custom words and a per-tier count. `--built-in` prints the
 * list that ships with the app instead, which is the quick way to see what a tier
 * already covers before adding to it.
 *
 * `--add` takes the same text the textarea does, so the parsing is identical in both —
 * one word per line, or comma-separated, with an optional per-row tier. It needs
 * `--user` because every word records who added it; there is no session on a terminal.
 */
export async function pictionaryWordsCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  const tier = flags.tier ? PICTIONARY_TIERS.find((entry) => entry === flags.tier) : undefined;
  if (flags.tier && !tier) {
    console.error(`--tier must be one of: ${PICTIONARY_TIERS.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  try {
    // `--add` with no value parses as an empty string, which the schema rejects with
    // "Type or paste some words first." — the same message the screen shows.
    if ("add" in flags) {
      addWords(flags.add, tier ?? "easy", flags.user);
      return;
    }

    if ("clear" in flags) {
      const removed = clearCustomWords(deps.pictionaryWordsRepo, tier);
      console.log(`Removed ${removed} word(s)${tier ? ` from ${tier}` : ""}.`);
      return;
    }

    if ("built-in" in flags) {
      printBuiltIn(tier);
      return;
    }

    printCustom(tier);
  } catch (error) {
    // `messageOf` rather than `error.message`: a ZodError's message is the serialized
    // issue array, so printing it dumps JSON at someone who mistyped a flag.
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}

function addWords(text: string, tier: PictionaryTier, user: string | undefined): void {
  const userId = Number(user);
  if (!user || !Number.isInteger(userId) || userId < 1) {
    console.error("--add needs --user <id>: every word records who added it.");
    process.exitCode = 1;
    return;
  }

  const summary = importWords(deps.pictionaryWordsRepo, { text, tier, userId });

  console.log(`Added ${summary.added} word(s) to ${tier}.`);
  if (summary.alreadyPresent > 0) console.log(`${summary.alreadyPresent} already in the bank.`);
  if (summary.duplicatesInPaste > 0) {
    console.log(`${summary.duplicatesInPaste} repeated within the list given.`);
  }

  if (summary.problems.length > 0) {
    console.log("");
    console.log("Could not add:");
    for (const problem of summary.problems) {
      console.log(`  line ${problem.line}: ${problem.value || "(empty)"} — ${problem.reason}`);
    }
    // A partial import is not a failure — the good rows landed — but the exit code says
    // something was rejected, so a script can notice without parsing stdout.
    process.exitCode = 1;
  }
}

function printCustom(tier: PictionaryTier | undefined): void {
  const words = listCustomWords(deps.pictionaryWordsRepo, tier ? { tier } : {});
  const counts = countCustomWords(deps.pictionaryWordsRepo);

  console.log(tier ? `Your Pictionary words — ${tier}` : "Your Pictionary words");
  console.log("-".repeat(28));

  if (words.length === 0) {
    console.log("None added. Games use the built-in list.");
    return;
  }

  for (const word of words) {
    const by = word.createdBy ?? "unknown";
    console.log(
      `${String(word.id).padStart(5)}  ${word.word.padEnd(24).slice(0, 24)} ${word.tier.padEnd(7)} ${by}`,
    );
  }

  console.log("");
  console.log(PICTIONARY_TIERS.map((entry) => `${entry}: ${counts[entry]}`).join("   "));
}

function printBuiltIn(tier: PictionaryTier | undefined): void {
  const words = listWordBank(tier ? { tier } : {});

  console.log(tier ? `Built-in words — ${tier}` : "Built-in words");
  console.log("-".repeat(28));

  for (const word of words) {
    console.log(`${word.word.padEnd(24).slice(0, 24)} ${word.tier}`);
  }

  console.log("");
  console.log(`${words.length} word(s).`);
}
