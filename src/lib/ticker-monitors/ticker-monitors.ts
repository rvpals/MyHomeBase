import { createMessage, type MessageRepository } from "@/lib/messages";
import { evaluateMonitor, valuationFromHoldings } from "./evaluate";
import type { MonitorPositionReader, TickerMonitorRepository } from "./ports";
import {
  createMonitorSchema,
  monitorIdSchema,
  monitorTickerSchema,
  setMonitorEnabledSchema,
  updateMonitorSchema,
  type CreateMonitorInput,
  type UpdateMonitorInput,
} from "./schema";
import type { MonitorRunResult, TickerMonitor, TickerValuation } from "./types";

/**
 * Ticker monitor use-cases. Each takes its dependencies as arguments and
 * returns data, so the web actions and the CLI drive identical behaviour.
 */

export function listMonitorsForTicker(
  repo: TickerMonitorRepository,
  ticker: string,
): TickerMonitor[] {
  return repo.listByTicker(monitorTickerSchema.parse(ticker));
}

export function listEnabledMonitors(repo: TickerMonitorRepository): TickerMonitor[] {
  return repo.listEnabled();
}

export function getMonitor(
  repo: TickerMonitorRepository,
  id: number,
): TickerMonitor | undefined {
  return repo.getById(monitorIdSchema.parse(id));
}

export function createMonitor(
  repo: TickerMonitorRepository,
  input: CreateMonitorInput,
): TickerMonitor {
  return repo.create(createMonitorSchema.parse(input));
}

export function updateMonitor(
  repo: TickerMonitorRepository,
  input: UpdateMonitorInput,
): TickerMonitor {
  return repo.update(updateMonitorSchema.parse(input));
}

export function setMonitorEnabled(
  repo: TickerMonitorRepository,
  id: number,
  isEnabled: boolean,
): void {
  const input = setMonitorEnabledSchema.parse({ id, isEnabled });
  repo.setEnabled(input.id, input.isEnabled);
}

export function deleteMonitor(repo: TickerMonitorRepository, id: number): void {
  repo.delete(monitorIdSchema.parse(id));
}

/** One ticker's current figures, summed across every account holding it. */
export function valuationForTicker(
  positions: MonitorPositionReader,
  ticker: string,
): TickerValuation {
  const symbol = monitorTickerSchema.parse(ticker);
  return valuationFromHoldings(symbol, positions.listPositionsByTicker(symbol));
}

/**
 * Which of a ticker's monitors are true *right now*.
 *
 * Read-only: it files nothing and touches no latch. This is what the warning
 * icon beside a ticker renders from, so it has to be safe to call on every
 * page render — the firing is `runMonitors`' job alone.
 */
export function activeWarningsForTicker(
  repo: TickerMonitorRepository,
  positions: MonitorPositionReader,
  ticker: string,
): { monitor: TickerMonitor; message: string }[] {
  const symbol = monitorTickerSchema.parse(ticker);
  const valuation = valuationFromHoldings(symbol, positions.listPositionsByTicker(symbol));

  return repo
    .listByTicker(symbol)
    .map((monitor) => ({ monitor, evaluation: evaluateMonitor(monitor, valuation) }))
    .filter((pair) => pair.evaluation.isNear)
    .map((pair) => ({ monitor: pair.monitor, message: pair.evaluation.message }));
}

/**
 * Run every enabled monitor and file a message for each one that newly fired.
 *
 * **This is what a price refresh calls** — `Run_Monitors_Against_my_ticker` in
 * the request. It runs after prices have been written, so it reads the figures
 * the refresh just produced.
 *
 * Three things happen per monitor, and the order matters:
 *
 *   1. Evaluate against the ticker's current, summed holdings.
 *   2. If it newly entered its band, file a message and set the latch.
 *   3. If it has left its band, clear the latch so the next crossing reports.
 *
 * Valuations are computed once per *ticker* rather than once per monitor: two
 * monitors on NVDA are two conditions over the same figures, and reading the
 * positions twice would be the same query for the same answer.
 */
export function runMonitors(
  repo: TickerMonitorRepository,
  positions: MonitorPositionReader,
  messages: MessageRepository,
): MonitorRunResult {
  const monitors = repo.listEnabled();
  const valuations = new Map<string, TickerValuation>();
  const result: MonitorRunResult = {
    evaluated: 0,
    triggered: 0,
    cleared: 0,
    triggeredTickers: [],
  };

  for (const monitor of monitors) {
    let valuation = valuations.get(monitor.ticker);
    if (!valuation) {
      valuation = valuationFromHoldings(
        monitor.ticker,
        positions.listPositionsByTicker(monitor.ticker),
      );
      valuations.set(monitor.ticker, valuation);
    }

    const evaluation = evaluateMonitor(monitor, valuation);
    result.evaluated += 1;

    if (evaluation.shouldNotify) {
      createMessage(messages, {
        title: `${monitor.ticker}: monitor triggered`,
        body: evaluation.message,
        source: "Investments monitor",
      });
      repo.setTriggered(monitor.id, true, evaluation.message);
      result.triggered += 1;
      if (!result.triggeredTickers.includes(monitor.ticker)) {
        result.triggeredTickers.push(monitor.ticker);
      }
      continue;
    }

    // Left the band — re-arm, so the next crossing reports again. Only written
    // when the latch is actually set, so a quiet monitor costs no writes.
    if (!evaluation.isNear && monitor.isTriggered) {
      repo.setTriggered(monitor.id, false, "");
      result.cleared += 1;
    }
  }

  return result;
}
