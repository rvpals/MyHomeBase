// Consult AI about one ticker, from a terminal. Thin adapter: parse argv, validate
// with the module's zod schema, call the same `buildTickerConsult` use-case the
// viewer's dialog calls, print the prompt to stdout.
//
//   npm run cli -- consult-ticker AAPL
//   npm run cli -- consult-ticker aapl --band 10
//   npm run cli -- consult-ticker AAPL --no-quote      # skip the provider call
//   npm run cli -- consult-ticker AAPL > aapl-consult.md
//
// Piping to a file is the point of having it here: the same text the dialog puts on
// the clipboard, available to a script without a browser. Adding this command
// required zero changes to src/lib.

import { todayIsoLocal } from "@/lib/shared/date";
import { buildTickerConsult, tickerConsultOptionsSchema } from "@/lib/ticker-consult";
import { getTickerOwnData, getTickerQuote } from "@/lib/ticker-overview";
import { loadSectorMap, NO_SECTOR_LABEL, resolveSector } from "@/lib/ticker-profiles";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";

/** `--flag value` pairs and bare `--flag` switches. */
function parseArgs(args: string[]): Record<string, string | true> {
  const parsed: Record<string, string | true> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

export async function consultTickerCommand(args: string[]): Promise<void> {
  const flags = parseArgs(args);
  const positional = args.find((arg) => !arg.startsWith("--"));

  const parsed = tickerConsultOptionsSchema.safeParse({
    ticker: positional ?? "",
    // Only pass what was supplied, so the schema's own default applies.
    ...(typeof flags.band === "string" ? { tolerancePct: Number(flags.band) } : {}),
  });

  if (!parsed.success) {
    console.error(`Invalid options: ${parsed.error.issues[0]?.message ?? "unknown"}`);
    console.error("Usage: consult-ticker <TICKER> [--band 15] [--no-quote]");
    process.exitCode = 1;
    return;
  }

  const { ticker, tolerancePct } = parsed.data;

  try {
    const ownData = getTickerOwnData(
      { ticker },
      {
        positions: deps.stockPositionRepo,
        accounts: deps.investmentAccountRepo,
        watchLists: deps.stockWatchListRepo,
      },
    );

    // The provider call is the only slow part, and the prompt has an honest
    // branch for its absence — so it is skippable. Progress and failures go to
    // stderr so `consult-ticker AAPL > file.md` still produces a clean file.
    let quote;
    if (!flags["no-quote"]) {
      try {
        quote = await getTickerQuote(deps.marketDataClient, { ticker });
      } catch (error) {
        console.error(`Could not read a live quote (${messageOf(error)}); using recorded prices.`);
      }
    }

    // The cached profile rather than a second provider round-trip, and the same
    // source the portfolio export reads — so the CLI and the web app agree about
    // a hand-set sector. The fallback label means "we have no sector", which the
    // prompt must see as absent rather than as a sector called "Unclassified".
    const sector = resolveSector(loadSectorMap(deps.tickerProfileRepo).get(ticker));

    const consult = buildTickerConsult({
      ticker,
      ownData,
      quote,
      sector: sector === NO_SECTOR_LABEL ? undefined : sector,
      tolerancePct,
    });

    console.error(`Consult prompt for ${ticker} as of ${todayIsoLocal()} — ${consult.fileName}`);
    console.log(consult.content);
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}
