// Ticker monitors from the terminal — the same use-cases the ticker viewer's
// Monitor button drives.
//
//   npm run cli -- ticker-monitors list NVDA
//   npm run cli -- ticker-monitors add NVDA gain-amount 10000
//   npm run cli -- ticker-monitors add INTC loss-amount 0
//   npm run cli -- ticker-monitors add NVDA gain-pct 20 --band 3
//   npm run cli -- ticker-monitors enable 4
//   npm run cli -- ticker-monitors disable 4
//   npm run cli -- ticker-monitors delete 4
//   npm run cli -- ticker-monitors run
//
// `run` is the CLI half of the refresh button's monitor step. It evaluates every
// enabled monitor against current stored figures and files a message for each
// one that newly fires — so a cron job can drive it without a browser. Note it
// does **not** fetch prices: pair it with `refresh-positions` for that.

import { formatCents } from "@/lib/shared/money";
import {
  createMonitor,
  deleteMonitor,
  listMonitorsForTicker,
  runMonitors,
  setMonitorEnabled,
  summarizeMonitor,
  valuationForTicker,
  type MonitorType,
  type TickerMonitor,
} from "@/lib/ticker-monitors";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";

const USAGE = `Usage:
  ticker-monitors list <ticker>
  ticker-monitors add <ticker> <gain-amount|loss-amount|gain-pct> <target> [--band <pct>]
  ticker-monitors enable <id>
  ticker-monitors disable <id>
  ticker-monitors delete <id>
  ticker-monitors run

Targets:
  gain-amount / loss-amount  dollars, e.g. 10000   (loss-amount 0 = break-even)
  gain-pct                   percent of cost basis, e.g. 20`;

/** The CLI's kebab names for the three types, kept out of the stored values. */
const TYPE_BY_NAME: Record<string, MonitorType> = {
  "gain-amount": "gain_near_amount",
  "loss-amount": "loss_near_amount",
  "gain-pct": "gain_near_pct_of_cost",
};

function printMonitor(monitor: TickerMonitor): void {
  const state = monitor.isEnabled ? " " : "-";
  const latched = monitor.isTriggered ? " [triggered]" : "";
  console.log(
    `${state} [${monitor.id}] ${monitor.ticker}  ${summarizeMonitor(monitor)}  ±${monitor.bandPct}%${latched}`,
  );
  if (monitor.lastMessage !== "") console.log(`         last: ${monitor.lastMessage}`);
}

export async function tickerMonitorsCommand(args: string[]): Promise<void> {
  const [action, ...rest] = args;

  try {
    switch (action) {
      case undefined:
      case "list": {
        const ticker = rest[0];
        if (!ticker) {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }
        const monitors = listMonitorsForTicker(deps.tickerMonitorRepo, ticker);
        const valuation = valuationForTicker(deps.stockPositionRepo, ticker);
        console.log(
          `${valuation.ticker}: unrealized ${formatCents(valuation.unrealizedGainLossCents)} on a ${formatCents(valuation.costCents)} basis.`,
        );
        if (monitors.length === 0) {
          console.log("No monitors set.");
          return;
        }
        for (const monitor of monitors) printMonitor(monitor);
        return;
      }

      case "add": {
        const [ticker, typeName, target] = rest;
        const monitorType = typeName ? TYPE_BY_NAME[typeName] : undefined;
        if (!ticker || !monitorType || target === undefined) {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }

        const bandIndex = rest.indexOf("--band");
        const bandPct = bandIndex >= 0 ? Number(rest[bandIndex + 1]) : undefined;
        const amount = Number(target);
        if (!Number.isFinite(amount)) {
          console.error(`Not a number: "${target}"`);
          process.exitCode = 1;
          return;
        }

        const isPercent = monitorType === "gain_near_pct_of_cost";
        const monitor = createMonitor(deps.tickerMonitorRepo, {
          ticker,
          monitorType,
          // Dollars in, cents stored — the same conversion the web form makes.
          targetCents: isPercent ? 0 : Math.round(amount * 100),
          targetPct: isPercent ? amount : 0,
          // Left to the schema's default when the flag is absent, rather than
          // repeating the number here where it could drift.
          ...(bandPct === undefined ? {} : { bandPct }),
          isEnabled: true,
        });
        console.log(`Added monitor ${monitor.id}: ${summarizeMonitor(monitor)}`);
        return;
      }

      case "enable":
      case "disable": {
        const id = Number(rest[0]);
        if (!Number.isInteger(id)) {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }
        setMonitorEnabled(deps.tickerMonitorRepo, id, action === "enable");
        console.log(`Monitor ${id} ${action}d.`);
        return;
      }

      case "delete": {
        const id = Number(rest[0]);
        if (!Number.isInteger(id)) {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }
        deleteMonitor(deps.tickerMonitorRepo, id);
        console.log(`Deleted monitor ${id}.`);
        return;
      }

      case "run": {
        const result = runMonitors(
          deps.tickerMonitorRepo,
          deps.stockPositionRepo,
          deps.messageRepo,
        );
        console.log(
          `Evaluated ${result.evaluated} monitor(s): ${result.triggered} triggered, ${result.cleared} re-armed.`,
        );
        if (result.triggeredTickers.length > 0) {
          console.log(`  Triggered: ${result.triggeredTickers.join(", ")}`);
          console.log("  See `messages list` for the filed notices.");
        }
        return;
      }

      default:
        console.error(USAGE);
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}
