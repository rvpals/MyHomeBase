// Ticker monitors from the terminal — the same use-cases the ticker viewer's
// Monitor button drives.
//
//   npm run cli -- ticker-monitors list NVDA
//   npm run cli -- ticker-monitors add NVDA gain-amount 10000
//   npm run cli -- ticker-monitors add INTC loss-amount 0
//   npm run cli -- ticker-monitors add NVDA gain-pct 20 --band 3
//   npm run cli -- ticker-monitors add BMY price 45 --band 1
//   npm run cli -- ticker-monitors add BMY day-move 3 --down
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
  usesBand,
  valuationForTicker,
  type MonitorType,
  type MoveDirection,
  type TickerMonitor,
} from "@/lib/ticker-monitors";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";

const USAGE = `Usage:
  ticker-monitors list <ticker>
  ticker-monitors add <ticker> <gain-amount|loss-amount|gain-pct|price|day-move> <target>
                     [--band <pct>] [--up|--down]
  ticker-monitors enable <id>
  ticker-monitors disable <id>
  ticker-monitors delete <id>
  ticker-monitors run

Targets:
  gain-amount / loss-amount  dollars, e.g. 10000   (loss-amount 0 = break-even)
  gain-pct                   percent of cost basis, e.g. 20
  price                      dollars per share, e.g. 45   (fires either side of the band)
  day-move                   percent moved in a day, e.g. 3; needs --up or --down,
                             ignores --band (it is a threshold, not a band)`;

/** The CLI's kebab names for the types, kept out of the stored values. */
const TYPE_BY_NAME: Record<string, MonitorType> = {
  "gain-amount": "gain_near_amount",
  "loss-amount": "loss_near_amount",
  "gain-pct": "gain_near_pct_of_cost",
  price: "price_near_amount",
  "day-move": "day_move_pct",
};

/** Which types read `targetPct` rather than `targetCents`. Mirrors the dialog. */
function usesPercentTarget(monitorType: MonitorType): boolean {
  return monitorType === "gain_near_pct_of_cost" || monitorType === "day_move_pct";
}

function printMonitor(monitor: TickerMonitor): void {
  const state = monitor.isEnabled ? " " : "-";
  const latched = monitor.isTriggered ? " [triggered]" : "";
  // No ± for the threshold type: it stores a band nothing reads, and printing
  // one would describe behaviour the monitor does not have.
  const band = usesBand(monitor.monitorType) ? `  ±${monitor.bandPct}%` : "";
  console.log(
    `${state} [${monitor.id}] ${monitor.ticker}  ${summarizeMonitor(monitor)}${band}${latched}`,
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
        // The figures the price types are judged against. "unknown" rather than
        // a 0 or a 0.00%, which would read as a real price and a flat day.
        const priceText =
          valuation.pricePerShareCents > 0
            ? formatCents(valuation.pricePerShareCents)
            : "unknown";
        const moveText =
          valuation.dayChangePct === undefined
            ? "no previous close"
            : `${valuation.dayChangePct >= 0 ? "+" : ""}${valuation.dayChangePct.toFixed(2)}% today`;
        console.log(`${" ".repeat(valuation.ticker.length)}  ${priceText} per share, ${moveText}.`);
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

        // --up / --down, for the day-move type. Defaulting to "up" would
        // silently store the opposite of what someone who forgot --down meant,
        // so an absent flag stays absent and the schema refuses it by name.
        const isDayMove = monitorType === "day_move_pct";
        let direction: MoveDirection | "" = "";
        if (rest.includes("--down")) direction = "down";
        else if (rest.includes("--up")) direction = "up";

        const isPercent = usesPercentTarget(monitorType);
        const monitor = createMonitor(deps.tickerMonitorRepo, {
          ticker,
          monitorType,
          // Dollars in, cents stored — the same conversion the web form makes.
          targetCents: isPercent ? 0 : Math.round(amount * 100),
          targetPct: isPercent ? amount : 0,
          // Left to the schema's default when the flag is absent, rather than
          // repeating the number here where it could drift. The threshold type
          // reads no band, so --band is not passed on for it at all.
          ...(bandPct === undefined || isDayMove ? {} : { bandPct }),
          direction,
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
