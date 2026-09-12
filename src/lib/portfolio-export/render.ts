/**
 * The two renderings of one payload.
 *
 * Both are prompt + data in a single block of text, because that is how it gets
 * used: the reader copies the whole thing into a chat window. Splitting them
 * would mean two copy buttons and an easy mistake.
 */

import { buildAnalystPrompt } from "./prompt";
import type { PortfolioExportPayload } from "./types";

function usd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function pct(value: number): string {
  return `${value.toFixed(2)}%`;
}

/** A cell that may legitimately have no value. Never renders a misleading 0. */
function orDash(value: number | null, format: (value: number) => string): string {
  return value === null ? "—" : format(value);
}

/** Escapes a pipe so a fund name with one in it can't break the table. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

/** Human-readable: summary, tables, and the caveats spelled out. */
export function renderMarkdown(payload: PortfolioExportPayload): string {
  const { summary } = payload;
  const lines: string[] = [];

  lines.push(buildAnalystPrompt(payload));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`# Portfolio as of ${payload.asOf}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Total market value:** ${usd(summary.totalMarketValue)}`);
  lines.push(`- **Total cost basis:** ${usd(summary.totalCostBasis)}`);
  lines.push(
    `- **Unrealised gain/loss:** ${usd(summary.totalUnrealizedGainLoss)} (${pct(summary.totalUnrealizedGainLossPct)})`,
  );
  lines.push(
    `- **Positions:** ${summary.holdingCount} across ${summary.accountCount} ${
      summary.accountCount === 1 ? "account" : "accounts"
    }`,
  );
  lines.push(`- **Cash allocation:** ${pct(summary.cashAllocationPct)}`);
  lines.push("");

  if (summary.topSectors.length > 0) {
    lines.push("### Top sectors");
    lines.push("");
    lines.push("| Sector | Market value | Weight |");
    lines.push("|---|---:|---:|");
    for (const sector of summary.topSectors) {
      lines.push(`| ${cell(sector.sector)} | ${usd(sector.marketValue)} | ${pct(sector.weightPct)} |`);
    }
    lines.push("");
  }

  if (summary.byAccountKind.length > 0) {
    lines.push("### By account type");
    lines.push("");
    lines.push("| Account type | Market value | Weight | Positions |");
    lines.push("|---|---:|---:|---:|");
    for (const kind of summary.byAccountKind) {
      lines.push(
        `| ${cell(kind.kind)} | ${usd(kind.marketValue)} | ${pct(kind.weightPct)} | ${kind.holdingCount} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Holdings");
  lines.push("");
  if (payload.holdings.length === 0) {
    lines.push("_No holdings in the exported accounts._");
    lines.push("");
  } else {
    lines.push(
      "| Ticker | Name | Type | Accounts | Qty | Avg cost | Price | Market value | Gain/loss | Gain/loss % | Weight | Sector | Expense ratio |",
    );
    lines.push("|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|");
    for (const holding of payload.holdings) {
      lines.push(
        [
          "",
          cell(holding.ticker),
          cell(holding.name),
          cell(holding.vehicle),
          cell(holding.accounts.join(", ")),
          String(holding.quantity),
          orDash(holding.averageCostBasis, usd),
          usd(holding.currentPrice),
          usd(holding.marketValue),
          orDash(holding.unrealizedGainLoss, usd),
          orDash(holding.unrealizedGainLossPct, pct),
          pct(holding.weightPct),
          cell(holding.sector),
          orDash(holding.expenseRatio, (value) => pct(value)),
          "",
        ].join(" | ").trim(),
      );
    }
    lines.push("");
  }

  if (payload.excludedAccounts.length > 0) {
    lines.push("## Excluded from this export");
    lines.push("");
    // Grouped by kind: three employer plans produce three identical sentences,
    // and a repeated line reads as a rendering fault rather than as three
    // accounts. The count is what actually carries information here.
    const byLabel = new Map<string, { count: number; reason: string }>();
    for (const account of payload.excludedAccounts) {
      const entry = byLabel.get(account.label);
      if (entry) entry.count += 1;
      else byLabel.set(account.label, { count: 1, reason: account.reason });
    }
    for (const [label, entry] of byLabel) {
      const suffix = entry.count > 1 ? ` (${entry.count} accounts)` : "";
      lines.push(`- **${cell(label)}**${suffix} — ${entry.reason}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Machine-readable: the prompt as a string field beside the structured data, so
 * one paste carries both and a programmatic caller can drop the prompt.
 */
export function renderJson(payload: PortfolioExportPayload): string {
  return JSON.stringify(
    {
      prompt: buildAnalystPrompt(payload),
      asOf: payload.asOf,
      summary: payload.summary,
      holdings: payload.holdings,
      excludedAccounts: payload.excludedAccounts,
      notes: {
        expenseRatio: "Not tracked by this application; always null.",
        accountNames: "Replaced with tax treatment. No institution or personal name is included.",
      },
    },
    null,
    2,
  );
}

/** Renders whichever format was asked for. */
export function renderExport(payload: PortfolioExportPayload, format: "markdown" | "json"): string {
  return format === "json" ? renderJson(payload) : renderMarkdown(payload);
}

/** The download filename for a rendering. */
export function exportFileName(payload: PortfolioExportPayload, format: "markdown" | "json"): string {
  return `portfolio-ai-export-${payload.asOf}.${format === "json" ? "json" : "md"}`;
}
