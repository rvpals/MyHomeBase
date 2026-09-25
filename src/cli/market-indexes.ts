// The Indexes card from a terminal. Thin adapter: parse argv, hand it to the same
// `loadIndexBoard` use-case the card's Refresh all button calls, print a table.
//
//   npm run cli -- market-indexes
//   npm run cli -- market-indexes --symbols ^GSPC,GC=F
//   npm run cli -- market-indexes --detail
//
// With no flags it fetches the whole board, exactly as the card does. `--detail`
// asks for the second pass (52-week range, moving averages, all-time high, and
// the day's range) — three times the provider calls, so it is opt-in here just
// as it is in the card.

import {
  loadIndexBoard,
  MARKET_INDEX_SYMBOLS,
  parseIndexSymbols,
  rangePosition,
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

/**
 * The `--detail` figures for one row, as indented lines.
 *
 * Returns nothing at all when the second pass wasn't asked for or brought
 * nothing back, so the plain board prints exactly as it always did. Individual
 * figures that are missing are skipped rather than printed as "n/a" — a
 * terminal has room to simply omit them, unlike the card's fixed grid.
 */
function detailLines(quote: IndexQuote): string[] {
  const detail = quote.detail;
  if (!detail) return [];

  const lines: string[] = [];
  const level = (cents: number) => formatLevel(cents, quote.unit);

  if (quote.dayHighCents > 0 && quote.dayLowCents > 0) {
    lines.push(`      day      ${level(quote.dayLowCents)} — ${level(quote.dayHighCents)}`);
  }

  if (detail.fiftyTwoWeekLowCents !== undefined && detail.fiftyTwoWeekHighCents !== undefined) {
    const position = rangePosition(
      quote.valueCents,
      detail.fiftyTwoWeekLowCents,
      detail.fiftyTwoWeekHighCents,
    );
    const where = position === undefined ? "" : `  (${position.toFixed(0)}% of range)`;
    lines.push(
      `      52-week  ${level(detail.fiftyTwoWeekLowCents)} — ${level(detail.fiftyTwoWeekHighCents)}${where}`,
    );
  }

  if (detail.oneYearChangePct !== undefined) {
    const sign = detail.oneYearChangePct >= 0 ? "+" : "";
    lines.push(`      1-year   ${sign}${detail.oneYearChangePct.toFixed(2)}%`);
  }

  const averages: string[] = [];
  if (detail.fiftyDayAverageCents !== undefined) {
    averages.push(`50d ${level(detail.fiftyDayAverageCents)}`);
  }
  if (detail.twoHundredDayAverageCents !== undefined) {
    averages.push(`200d ${level(detail.twoHundredDayAverageCents)}`);
  }
  if (averages.length > 0) lines.push(`      averages ${averages.join("   ")}`);

  if (detail.allTimeHighCents !== undefined) {
    lines.push(`      all-time high ${level(detail.allTimeHighCents)}`);
  }

  if (detail.intradayCents.length > 0) {
    lines.push(`      intraday ${detail.intradayCents.length} bars`);
  }

  return lines;
}

export async function marketIndexesCommand(args: string[]): Promise<void> {
  // `--detail` is a bare switch, and `parseFlags` only understands `--key value`
  // pairs — it would eat whatever followed. Strip it here and let the shared
  // parser see the rest, so `--detail --symbols ^GSPC` works in either order.
  const wantsDetail = args.includes("--detail");
  const flags = parseFlags(args.filter((arg) => arg !== "--detail"));

  const symbols = flags.symbols
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  let board;
  try {
    // The schema does the validating — an uncatalogued symbol is rejected here
    // exactly as it is in the web action, and `parseIndexSymbols` is what turns
    // argv's raw strings into the typed input without a cast.
    board = await loadIndexBoard(
      deps.marketDataClient,
      parseIndexSymbols(symbols, wantsDetail),
      deps.quoteSummaryClient,
    );
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
      // The extras go underneath rather than into more columns: the row is
      // already 69 characters wide, and six more figures would wrap in any
      // normal terminal. Only printed when `--detail` actually returned them.
      for (const line of detailLines(quote)) console.log(line);
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
