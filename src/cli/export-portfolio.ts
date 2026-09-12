// Export for AI Analysis from a terminal. Thin adapter: parse argv, validate with
// the module's zod schema, call the same `buildPortfolioExport` use-case the web
// screen calls, print the rendering to stdout.
//
//   npm run cli -- export-portfolio
//   npm run cli -- export-portfolio --format json
//   npm run cli -- export-portfolio --focus fees,tax
//   npm run cli -- export-portfolio --kinds Taxable
//   npm run cli -- export-portfolio --format json > portfolio.json
//
// Piping to a file is the point of having it here: the same text the modal puts on
// the clipboard, available to a script without a browser. Adding this command
// required zero changes to src/lib.

import { listAccounts } from "@/lib/investment-accounts";
import {
  buildPortfolioExport,
  portfolioExportOptionsSchema,
  renderExport,
} from "@/lib/portfolio-export";
import { todayIsoLocal } from "@/lib/shared/date";
import { listPositions } from "@/lib/stock-positions";
import { loadSectorMap, resolveSector } from "@/lib/ticker-profiles";
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

/** A comma-separated list, trimmed and emptied of blanks. */
function list(value: string | true | undefined): string[] | undefined {
  if (typeof value !== "string") return undefined;
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? entries : undefined;
}

export async function exportPortfolioCommand(args: string[]): Promise<void> {
  const flags = parseArgs(args);

  const parsed = portfolioExportOptionsSchema.safeParse({
    // Only pass what was actually supplied, so the schema's own defaults apply.
    ...(typeof flags.format === "string" ? { format: flags.format } : {}),
    ...(list(flags.focus) ? { focus: list(flags.focus) } : {}),
    ...(list(flags.kinds) ? { includeKinds: list(flags.kinds) } : {}),
  });

  if (!parsed.success) {
    console.error(`Invalid options: ${parsed.error.issues[0]?.message ?? "unknown"}`);
    process.exitCode = 1;
    return;
  }

  try {
    const profiles = loadSectorMap(deps.tickerProfileRepo);
    const sectorsByTicker = new Map<string, string>();
    for (const [ticker, record] of profiles) {
      sectorsByTicker.set(ticker.toUpperCase(), resolveSector(record));
    }

    const payload = buildPortfolioExport({
      positions: listPositions(deps.stockPositionRepo),
      accounts: listAccounts(deps.investmentAccountRepo).map((account) => ({
        id: account.id,
        name: account.name,
      })),
      sectorsByTicker,
      asOf: todayIsoLocal(),
      focus: parsed.data.focus,
      includeKinds: parsed.data.includeKinds,
    });

    console.log(renderExport(payload, parsed.data.format));
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}
