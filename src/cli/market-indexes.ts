// The Indexes card from a terminal. Thin adapter: parse argv, hand it to the same
// `loadIndexBoard` use-case the card's Refresh all button calls, print a table.
//
//   npm run cli -- market-indexes
//   npm run cli -- market-indexes --symbols ^GSPC,GC=F
//
// With no flags it fetches the whole board, exactly as the card does.

import {
  loadIndexBoard,
  MARKET_INDEX_SYMBOLS,
  parseIndexSymbols,
  type IndexQuote,
  type IndexUnit,
} from "@/lib/market-indexes";
import { centsToDollars, formatCents } from "@/lib/shared/money";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/** Same unit rules as the card: points bare, commodities in dollars, yields in percent. */
function formatLevel(cents: number, unit: IndexUnit): string {
  const value = centsToDollars(cents);
  if (unit === "currency") return formatCents(cents);
  if (unit === "percent") return `${value.toFixed(2)}%`;
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMove(quote: IndexQuote): string {
  if (quote.previousCloseCents === 0) return "n/a";
  const sign = quote.changeCents >= 0 ? "+" : "-";
  return `${sign}${formatLevel(Math.abs(quote.changeCents), quote.unit)}`;
}

function formatMovePct(quote: IndexQuote): string {
  if (quote.previousCloseCents === 0) return "n/a";
  return `${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%`;
}

function pad(value: string, width: number): string {
  return value.padEnd(width);
}

function padStart(value: string, width: number): string {
  return value.padStart(width);
}

export async function marketIndexesCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  const symbols = flags.symbols
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  let board;
  try {
    // The schema does the validating — an uncatalogued symbol is rejected here
    // exactly as it is in the web action, and `parseIndexSymbols` is what turns
    // argv's raw strings into the typed input without a cast.
    board = await loadIndexBoard(deps.marketDataClient, parseIndexSymbols(symbols));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(`Known symbols: ${MARKET_INDEX_SYMBOLS.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Market indexes — fetched ${board.fetchedAt}`);
  console.log("Levels are in their own units: points, dollars, or percent for a yield.");

  for (const group of board.groups) {
    console.log("");
    console.log(group.label.toUpperCase());
    console.log(
      `  ${pad("SYMBOL", 11)}${pad("NAME", 24)}${padStart("LEVEL", 13)}${padStart("CHANGE", 12)}${padStart("%", 9)}`,
    );
    for (const quote of group.quotes) {
      console.log(
        `  ${pad(quote.symbol, 11)}${pad(quote.label, 24)}${padStart(formatLevel(quote.valueCents, quote.unit), 13)}${padStart(formatMove(quote), 12)}${padStart(formatMovePct(quote), 9)}`,
      );
    }
  }

  if (board.failures.length > 0) {
    console.log("");
    console.log("Unavailable:");
    for (const failure of board.failures) {
      console.log(`  ${pad(failure.symbol, 11)}${failure.label} — ${failure.reason}`);
    }
  }

  // A board where nothing came back is a failed run, not an empty one — the
  // exit code is what a cron job or CI check reads.
  if (board.groups.length === 0) process.exitCode = 1;
}
