/**
 * The prompt the reader pastes into their AI of choice.
 *
 * Two questions, deliberately and only two: what else could be bought instead
 * of this, in the same sector, and what else could be bought instead of this,
 * somewhere else entirely — both at a price within a band of what this costs
 * today. The price band is the whole constraint that makes the answer usable: a
 * reader holding 40 shares of a $180 stock can act on a $165-$205 suggestion and
 * cannot act on a $900 one.
 *
 * Written the same way `lib/portfolio-export/prompt.ts` is, and for the same
 * reason: a prompt that only names a role invites a model to guess at the gaps,
 * and the gaps here are load-bearing. This app tracks no sector for a symbol it
 * has never fetched a profile for, no expense ratio anywhere, and no price at
 * all for a symbol that is watched and not held.
 */

import { centsToDollars } from "@/lib/shared/money";
import type { ReferencePriceSource, TickerConsultInput } from "./types";

function usd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centsToDollars(cents));
}

/** Whole dollars — for a total where the cents are noise. */
function usdRound(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(centsToDollars(cents));
}

function shares(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

function pct(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

/** How the reference price should be described, in words the model can act on. */
const PRICE_SOURCE_WORDING: Record<ReferencePriceSource, string> = {
  intraday:
    "a live intraday quote — the market was still open when this was read, so the price is provisional and the band below moves with it",
  close: "the last settled closing price",
  recorded:
    "the price last recorded in the owner's own records, NOT a live quote — it may be several days old, so treat the band below as approximate",
};

/** The role line, and what this consult is actually for. */
function roleBlock(input: TickerConsultInput): string {
  const { ticker, name } = input;
  const label = name ? `${ticker} (${name})` : ticker;

  return [
    "You are an experienced equity analyst. The owner holds — or is watching — the",
    `position in ${label} described below, and wants to know what else they could buy`,
    "instead of it, at a price they can actually act on.",
    "",
    "Ground every claim about the owner's position in the numbers supplied. Where you",
    "rely on your own knowledge — a company's sector, its current share price, what an",
    "ETF holds — say so explicitly and mark it as unverified, because none of that is in",
    "the data below and prices move after your training data ends. Do not invent figures",
    "for anything marked unavailable.",
  ].join("\n");
}

/** The reference price and the band every suggestion has to fall inside. */
function priceBlock(input: TickerConsultInput): string {
  const { referencePrice, band } = input;
  const lines: string[] = ["REFERENCE PRICE AND THE PRICE BAND", ""];

  if (referencePrice.cents <= 0) {
    lines.push(
      "- **No price is available for this symbol.** The owner's records carry no current",
      "  price and no live quote could be read, so there is no band to screen against.",
      `  Establish ${input.ticker}'s approximate current price from your own knowledge, say`,
      "  clearly that you have done so and that it is unverified, and then apply a ±",
      `  ${band.tolerancePct}% band around that figure instead. Say plainly that the owner`,
      "  should check the real price before acting on anything below.",
    );
    return lines.join("\n");
  }

  lines.push(
    `- ${input.ticker} is ${usd(referencePrice.cents)} per share, as of ${referencePrice.asOf}.`,
    `  This figure is ${PRICE_SOURCE_WORDING[referencePrice.source]}.`,
    "",
    `- **Every alternative you name must trade between ${usd(band.lowCents)} and ${usd(band.highCents)}**`,
    `  per share — that is ±${band.tolerancePct}% of the price above. This is a hard constraint, not a`,
    "  preference. A company you rate highly whose shares cost four times as much is not an",
    "  answer to the question being asked.",
    "",
    "- Share prices are the one thing you are most likely to be wrong about, so for each",
    "  candidate: state the price you believe it trades at, mark it unverified, and say",
    "  whether it sits in the band. If you are unsure whether a candidate clears the band,",
    "  include it and say so rather than silently dropping it — but never claim a price you",
    "  are not reasonably confident in. If a genuinely better answer sits just outside the",
    "  band, you may name it separately, clearly labelled as out of band.",
  );

  return lines.join("\n");
}

/** The position: shares, basis, value, weight, per account. */
function positionBlock(input: TickerConsultInput): string {
  const { position } = input;
  const lines: string[] = ["THE OWNER'S POSITION", ""];

  if (!position.isHeld) {
    lines.push(
      position.isWatched
        ? `- ${input.ticker} is on the owner's watchlist and is NOT held. There are no shares, no`
        : `- ${input.ticker} is not held and not watched. There are no shares, no`,
      "  cost basis and no gain to reason about — so treat this as a candidate the owner is",
      "  considering rather than a position to replace, and skip any advice about selling.",
    );
  } else {
    lines.push(
      `- Shares held: ${shares(position.quantity)}, across ${position.accountCount} account(s).`,
      `- Market value: ${usdRound(position.valueCents)}.`,
    );

    if (position.hasCostBasis) {
      lines.push(
        `- Total cost basis: ${usdRound(position.costCents)} (average ${usd(position.averageUnitCostCents)} per share).`,
        `- Unrealised gain/loss: ${usdRound(position.unrealizedGainLossCents)} (${pct(position.totalReturnPct)}).`,
      );
    } else {
      lines.push(
        "- **Cost basis: not recorded.** The gain/loss on this position is therefore unknown,",
        "  not zero. Do not state or imply a return figure for it, and do not reason about",
        "  the tax consequence of selling — you cannot know whether it is at a gain or a loss.",
      );
    }

    if (position.portfolioWeightPct > 0) {
      lines.push(
        `- This is ${position.portfolioWeightPct.toFixed(2)}% of everything the owner holds, by value.`,
      );
    }

    if (position.holdings.length > 1) {
      lines.push("", "Per account:", "");
      lines.push("| Account | Shares | Cost basis | Avg cost/share | Value |");
      lines.push("|---|---|---|---|---|");
      for (const holding of position.holdings) {
        lines.push(
          `| ${holding.accountName} | ${shares(holding.quantity)} | ${
            holding.costCents > 0 ? usdRound(holding.costCents) : "not recorded"
          } | ${holding.unitCostCents > 0 ? usd(holding.unitCostCents) : "—"} | ${usdRound(
            holding.valueCents,
          )} |`,
        );
      }
    }
  }

  return lines.join("\n");
}

/** Every recorded trade, oldest first, plus the totals. */
function historyBlock(input: TickerConsultInput): string {
  const { history } = input;
  const lines: string[] = ["EVERY RECORDED TRANSACTION", ""];

  if (history.trades.length === 0) {
    lines.push(
      "- **No transactions are recorded for this symbol.** The owner may well have bought it",
      "  outside what this application tracks, so do not conclude the position was never",
      "  traded or infer anything about their timing or conviction from the absence.",
    );
    return lines.join("\n");
  }

  lines.push(
    "Oldest first. Every trade the application has a record of, in full.",
    "",
    "| Date | Action | Shares | Price/share | Total | Brokerage |",
    "|---|---|---|---|---|---|",
  );

  for (const trade of history.trades) {
    lines.push(
      `| ${trade.date} | ${trade.action} | ${shares(trade.numberOfShares)} | ${usd(
        trade.pricePerShareCents,
      )} | ${usdRound(trade.totalAmountCents)} | ${trade.brokerageFirm || "not recorded"} |`,
    );
  }

  lines.push(
    "",
    `- ${history.buyCount} buy(s) totalling ${shares(history.sharesBought)} shares for ${usdRound(history.totalBoughtCents)}.`,
  );

  if (history.sellCount > 0) {
    lines.push(
      `- ${history.sellCount} sell(s) totalling ${shares(history.sharesSold)} shares for ${usdRound(history.totalSoldCents)}.`,
    );
  } else {
    lines.push("- Nothing has been sold — the position has only ever been added to.");
  }

  if (history.firstTradeDate && history.lastTradeDate) {
    lines.push(
      history.firstTradeDate === history.lastTradeDate
        ? `- All activity is on one date: ${history.firstTradeDate}.`
        : `- Activity runs from ${history.firstTradeDate} to ${history.lastTradeDate}.`,
    );
  }

  lines.push(
    "",
    "Use these trades to judge how the position was built — averaging in over time, one",
    "lump, or buying into a fall — and let that inform how you size your suggestions. Do",
    "not assume the trade prices are adjusted for any split.",
  );

  return lines.join("\n");
}

/** What is known about the symbol's sector, and what to do when nothing is. */
function sectorBlock(input: TickerConsultInput): string {
  const lines: string[] = ["SECTOR", ""];

  if (input.sector) {
    lines.push(
      `- The provider classifies ${input.ticker} as **${input.sector}**${
        input.industry ? ` (industry: ${input.industry})` : ""
      }.`,
      "  Take this as the sector for the purposes of the first question below.",
    );
  } else {
    lines.push(
      `- **No sector is recorded for ${input.ticker}.** Either the provider has never been asked`,
      "  for its profile, or it genuinely has none — an ETF or a fund does not have one.",
      "  Determine the sector yourself from your own knowledge, state what you decided and",
      "  mark it unverified. If the symbol is a fund rather than a single company, say so and",
      "  treat its dominant sector exposure as the sector for question 1.",
    );
  }

  return lines.join("\n");
}

/** The two questions. This is what the button exists for. */
function questionsBlock(input: TickerConsultInput): string {
  const { band } = input;
  const inBand =
    band.highCents > 0 ? `${usd(band.lowCents)}-${usd(band.highCents)}` : "the band established above";

  return [
    "WHAT TO ANALYSE",
    "",
    `1. ALTERNATIVES IN THE SAME SECTOR`,
    `   - Name three to five alternatives to ${input.ticker} within its own sector, each trading`,
    `     in ${inBand}.`,
    "   - For each: the ticker, the company or fund name, your unverified price, and why it is",
    "     a credible substitute for this specific holding rather than merely a good company.",
    "   - Say what the owner would actually be changing by switching — a different bet on the",
    "     same theme, a cheaper or more expensive valuation, more or less dividend income,",
    "     a larger or smaller company. Be concrete about the trade-off.",
    `   - Say plainly if ${input.ticker} is already the strongest name in its sector at this price.`,
    "     'Keep what you have' is a legitimate answer and is more useful than a forced switch.",
    "",
    "2. ALTERNATIVES IN A DIFFERENT SECTOR",
    "   - Choose one or two sectors *other* than this holding's, and say why those sectors in",
    "     particular — what they do that this one does not, especially where they would hold up",
    "     when this sector falls.",
    `   - Then name two to four specific alternatives in those sectors, again trading in ${inBand}.`,
    "   - For each: the ticker, the name, your unverified price, the sector it belongs to and",
    "     why, and an estimate of how correlated it is to this holding. Mark the correlation as",
    "     an estimate from your own knowledge — nothing below measures it.",
    "   - Be honest about what changing sector actually buys the owner, and about what it gives",
    "     up. If the real diversifier here is a bond, a commodity, gold or cash rather than",
    "     another equity, say that instead of forcing an equity answer.",
  ].join("\n");
}

/** How the answer should be laid out. */
const OUTPUT_BLOCK = [
  "HOW TO ANSWER",
  "",
  "1. Open with a two-or-three sentence read on the position as it stands — size, how it was",
  "   built, and whether it looks like something to keep, trim or replace.",
  "2. Answer question 1, then question 2. Use a table for the candidates in each, with the",
  "   price and its in-band status as columns, and put your reasoning underneath rather than",
  "   inside the cells.",
  "3. Close with a short ranked shortlist across both questions — at most five names, best",
  "   first — and one sentence each on what would have to be true for that name to be the",
  "   right move.",
  "",
  "Keep every price claim flagged as unverified and tell the owner to check the current",
  "quote before acting. This is analysis, not advice, and you do not know their tax",
  "situation, their income, their timeframe or what else they hold beyond the one figure",
  "given above.",
].join("\n");

/**
 * The full consult prompt for one ticker.
 *
 * Section order is fixed, so the same records always produce the same text —
 * which is what lets the CLI command be used as a check on the dialog.
 */
export function buildTickerConsultPrompt(input: TickerConsultInput): string {
  return [
    roleBlock(input),
    priceBlock(input),
    sectorBlock(input),
    positionBlock(input),
    historyBlock(input),
    questionsBlock(input),
    OUTPUT_BLOCK,
  ].join("\n\n");
}
