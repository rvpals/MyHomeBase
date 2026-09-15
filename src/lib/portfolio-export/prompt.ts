/**
 * The instructions wrapped around the payload.
 *
 * This is the part that decides how useful the answer is, so it does more than
 * name a role. It states what the numbers mean, what is deliberately missing
 * and why, which analyses were asked for, and what shape the reply should take.
 * The alternative — "act as a portfolio analyst" over a wall of JSON — invites
 * a model to guess at the gaps, and the gaps here are load-bearing: two thirds
 * of the owner's retirement money is out of scope by design, and no expense
 * ratio is tracked anywhere in the app.
 */

import { ANALYSIS_FOCUSES, type AnalysisFocus, type PortfolioExportPayload } from "./types";

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

/** The role line and the standing rules that apply to every analysis. */
function roleBlock(payload: PortfolioExportPayload): string {
  const { summary } = payload;
  return [
    "You are an experienced portfolio analyst. Review the holdings below and give",
    "the owner a clear, specific read on what they hold and what to do about it.",
    "",
    "Ground every claim in the supplied numbers. Where you rely on knowledge that is",
    "not in the payload — a fund's expense ratio, what an ETF actually holds, a",
    "company's sector — say so explicitly and flag that it should be verified. Do not",
    "invent figures that are marked unavailable.",
    "",
    `The portfolio is worth ${formatUsd(summary.totalMarketValue)} across`,
    `${summary.holdingCount} distinct positions in ${summary.accountCount} accounts, valued as of ${payload.asOf}.`,
  ].join("\n");
}

/** What the reader must know to interpret the payload correctly. */
function contextBlock(payload: PortfolioExportPayload): string {
  const lines: string[] = ["IMPORTANT CONTEXT", ""];

  if (payload.excludedAccounts.length > 0) {
    const kinds = [...new Set(payload.excludedAccounts.map((account) => account.label))];
    lines.push(
      `- Accounts NOT included: ${kinds.join(", ")}. These hold a balance but no`,
      "  individual positions, so they cannot be analysed at the holding level. The owner",
      "  DOES have retirement savings outside what you can see — do not conclude otherwise,",
      "  and do not recommend opening accounts they may already have.",
    );
  }

  lines.push(
    "- Expense ratios are not tracked by this application and are reported as null.",
    "  Supply them from your own knowledge where you need them, and mark them as such.",
  );

  if (payload.summary.unclassifiedHoldingCount > 0) {
    lines.push(
      `- ${payload.summary.unclassifiedHoldingCount} holdings have no sector. Funds genuinely have none`,
      '  (shown as "ETFs & funds"); treat sector weights as covering direct equity only.',
    );
  }

  if (payload.summary.missingCostBasisCount > 0) {
    lines.push(
      `- ${payload.summary.missingCostBasisCount} holdings report no cost basis. Their gain/loss is null,`,
      "  not zero — exclude them from return figures rather than counting them as flat.",
    );
  }

  lines.push(
    "- Account names are replaced with their tax treatment on purpose. Reason about",
    "  placement from the treatment; do not ask which broker holds what.",
  );

  // Only worth saying when the reader actually asked for the correlation work.
  if (payload.focus.includes("diversification")) {
    const insight = payload.correlation;

    if (!insight) {
      lines.push(
        "- No correlation matrix is available, so the diversification analysis below has no",
        "  measured correlations to work from. Reason about diversification from the sector",
        "  weights and holdings instead, and say clearly that your correlation claims are",
        "  estimates from your own knowledge rather than measurements of this portfolio.",
      );
    } else {
      lines.push(
        `- The correlation figures are Pearson coefficients over one year of daily returns,`,
        `  computed ${insight.ageDays === null ? "at an unknown date" : `${insight.ageDays} day(s) ago`} and covering ${insight.tickerCount} of the holdings.`,
        "  Only Stock and ETF positions are covered — mutual funds, bonds, crypto and cash",
        "  are absent from the matrix by design, so their absence there is not a statement",
        "  about them.",
      );

      if (insight.isStale) {
        lines.push(
          "- That matrix is more than a week old. Correlations move slowly, so it is still",
          "  usable, but treat a borderline figure as approximate.",
        );
      }

      if (!insight.hasInverseCorrelation) {
        lines.push(
          "- NOTHING in this portfolio is inversely correlated with anything else in it:",
          `  every measured pair is positive, averaging ${insight.averagePairwiseCorrelation.toFixed(2)}. Do not describe any`,
          '  existing pair as a hedge. The least-correlated pairs are the *weakest* links,',
          "  not opposing ones, and in a market-wide fall these holdings drop together.",
        );
      }

      if (insight.excludedTickers.length > 0) {
        lines.push(
          `- ${insight.excludedTickers.length} holding(s) had no fetchable price history when the matrix was`,
          `  computed (${insight.excludedTickers.join(", ")}) and are missing from it.`,
        );
      }
    }
  }

  return lines.join("\n");
}

/** The per-focus instructions. Only the ticked ones are emitted. */
const FOCUS_INSTRUCTIONS: Record<AnalysisFocus, string[]> = {
  allocation: [
    "ASSET ALLOCATION & OVERLAP",
    "- Judge how concentrated the portfolio is. Name any single position above 5% of the",
    "  total, and any sector above 30%, and say plainly whether that is a risk worth acting on.",
    "- Identify overlap between funds, and between funds and the direct equity holdings —",
    "  a large-cap index fund held alongside its own biggest constituents is the common case.",
    "  Estimate the true combined exposure to any company held both ways.",
    "- Comment on what is missing as well as what is present: geography, market cap, bonds.",
  ],
  fees: [
    "FEE DRAG & EXPENSE RATIOS",
    "- For each fund, state its expense ratio from your own knowledge, marked as unverified.",
    "- Compute the approximate annual cost in dollars, using the market values supplied.",
    "- Name a cheaper, substantially equivalent fund wherever one exists, and quantify the",
    "  annual saving. Be honest when a switch would save trivially little, or when the",
    "  taxable gain from switching would outweigh years of saved fees.",
  ],
  diversification: [
    "DIVERSIFICATION & ALTERNATIVES",
    "- Read the correlation tables as the measured starting point. Name the pairs that are",
    "  effectively the same bet — high correlation AND a large combined weight — and say",
    "  which one of each pair you would keep, and why.",
    "- State plainly how much genuine diversification the portfolio already has. If the",
    "  least-correlated pairs are still positively correlated, say so: that means these",
    "  holdings fall together, and no amount of adding more of the same fixes it.",
    "- Then recommend specific alternatives. For each sector listed as absent or thin,",
    "  name two or three concrete tickers — an ETF for broad exposure, and an individual",
    "  company if one is clearly the sector's quality name. For every ticker you name:",
    "    (a) state why it belongs to that sector,",
    "    (b) estimate its correlation to THIS portfolio's largest holdings and to SPY,",
    "        using the market correlations supplied as your reference point,",
    "    (c) mark the estimate as unverified, because it is your knowledge and not",
    "        measured from the data above,",
    "    (d) give a rough sizing — what percent of the portfolio would meaningfully",
    "        change its behaviour without becoming a new concentration.",
    "- Rank your suggestions by how much they would reduce the portfolio's overall",
    "  correlation, not by how attractive the company is on its own.",
    "- Be honest about the limits of the idea: a genuinely inversely correlated asset is",
    "  usually a bond, a commodity, gold or cash, not another equity. If that is the real",
    "  answer here, say it rather than forcing an equity suggestion.",
  ],
  tax: [
    "TAX EFFICIENCY & REBALANCING",
    "- Assess placement: income-heavy and tax-inefficient holdings belong in the Roth or",
    "  IRA; long-term growth and already-appreciated positions are usually fine in taxable.",
    "  Call out anything that is clearly in the wrong account, and what it would cost to move.",
    "- Flag positions with large unrealised gains where selling has a real tax cost, and",
    "  distinguish them from positions that can be trimmed cheaply.",
    "- Where you recommend rebalancing, prefer routes that avoid realising gains: new",
    "  contributions, dividend redirection, and selling inside the tax-advantaged account first.",
  ],
};

/** How the answer should be laid out. */
const OUTPUT_BLOCK = [
  "HOW TO ANSWER",
  "",
  "1. Open with the three findings that matter most, each in one sentence, ordered by",
  "   how much money is at stake.",
  "2. Then work through each analysis section above, citing the specific tickers and",
  "   figures that support what you say.",
  "3. Close with a short, prioritised action list. Mark each action as one that can be",
  "   taken immediately, or one that has a tax consequence to weigh first.",
  "",
  "Be direct about risk. If the portfolio is concentrated or expensive, say so in plain",
  "words rather than softening it. Equally, do not manufacture problems that the numbers",
  "do not support — if something is already well constructed, say that too.",
].join("\n");

/**
 * The full prompt that precedes the payload.
 *
 * Focus sections appear in a fixed order regardless of the order they were
 * ticked, so the same selection always produces the same prompt.
 */
export function buildAnalystPrompt(payload: PortfolioExportPayload): string {
  const ordered: AnalysisFocus[] = ANALYSIS_FOCUSES.filter((focus) =>
    payload.focus.includes(focus),
  );

  const sections = [roleBlock(payload), contextBlock(payload)];

  if (ordered.length > 0) {
    const analyses = ordered.map((focus, index) => {
      const [heading, ...rest] = FOCUS_INSTRUCTIONS[focus];
      return [`${index + 1}. ${heading}`, ...rest].join("\n");
    });
    sections.push(["WHAT TO ANALYSE", "", ...analyses].join("\n\n"));
  } else {
    // Nothing ticked is a legitimate choice: the reader wants an open review
    // rather than three specific lenses, so the prompt asks for one.
    sections.push(
      [
        "WHAT TO ANALYSE",
        "",
        "No specific focus was requested. Give a general review covering allocation,",
        "concentration, cost, tax placement and diversification, and lead with whichever",
        "of those the numbers say matters most here.",
      ].join("\n"),
    );
  }

  sections.push(OUTPUT_BLOCK);
  return sections.join("\n\n");
}
