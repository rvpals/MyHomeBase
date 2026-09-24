"use server";

// The ticker monitors' web adapters.
//
// Thin, per ARCHITECTURE.md: authorise on the first line, validate through the
// module's zod schema inside the use-case, call it, return the result. The
// behaviour lives in `src/lib/ticker-monitors` and is driven identically by
// `npm run cli -- ticker-monitors`.

import { revalidatePath } from "next/cache";
import {
  activeWarningsForTicker,
  createMonitor,
  deleteMonitor,
  listMonitorsForTicker,
  runMonitors,
  setMonitorEnabled,
  summarizeMonitor,
  updateMonitor,
  valuationForTicker,
  type CreateMonitorInput,
  type MonitorRunResult,
  type TickerMonitor,
  type UpdateMonitorInput,
} from "@/lib/ticker-monitors";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "investments";

const INVESTMENTS_MODULE_PATH = "/modules/investments";

/** A monitor plus the sentence describing it, which the list renders. */
export interface MonitorRow {
  monitor: TickerMonitor;
  summary: string;
  /** True when this monitor's condition holds right now. */
  isWarning: boolean;
}

/** What the ticker's Monitor screen loads. */
export interface TickerMonitorScreen {
  rows: MonitorRow[];
  /** The figures the monitors are judged against, so the screen can show them. */
  unrealizedGainLossCents: number;
  costCents: number;
}

export async function loadTickerMonitorsAction(ticker: string): Promise<TickerMonitorScreen> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);

  const monitors = listMonitorsForTicker(deps.tickerMonitorRepo, ticker);
  const valuation = valuationForTicker(deps.stockPositionRepo, ticker);
  const warnings = activeWarningsForTicker(
    deps.tickerMonitorRepo,
    deps.stockPositionRepo,
    ticker,
  );
  const warningIds = new Set(warnings.map((warning) => warning.monitor.id));

  return {
    rows: monitors.map((monitor) => ({
      monitor,
      summary: summarizeMonitor(monitor),
      isWarning: warningIds.has(monitor.id),
    })),
    unrealizedGainLossCents: valuation.unrealizedGainLossCents,
    costCents: valuation.costCents,
  };
}

/**
 * The messages for every monitor on this ticker whose condition holds now.
 *
 * Read-only and cheap, so the ticker viewer can call it on open to decide
 * whether to show the warning marker at all. Firing is `runMonitors`' job.
 */
export async function tickerMonitorWarningsAction(ticker: string): Promise<string[]> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  return activeWarningsForTicker(deps.tickerMonitorRepo, deps.stockPositionRepo, ticker).map(
    (warning) => warning.message,
  );
}

export async function createMonitorAction(input: CreateMonitorInput): Promise<TickerMonitor> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const monitor = createMonitor(deps.tickerMonitorRepo, input);
  revalidatePath(INVESTMENTS_MODULE_PATH);
  return monitor;
}

export async function updateMonitorAction(input: UpdateMonitorInput): Promise<TickerMonitor> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const monitor = updateMonitor(deps.tickerMonitorRepo, input);
  revalidatePath(INVESTMENTS_MODULE_PATH);
  return monitor;
}

export async function setMonitorEnabledAction(id: number, isEnabled: boolean): Promise<void> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  setMonitorEnabled(deps.tickerMonitorRepo, id, isEnabled);
  revalidatePath(INVESTMENTS_MODULE_PATH);
}

export async function deleteMonitorAction(id: number): Promise<void> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  deleteMonitor(deps.tickerMonitorRepo, id);
  revalidatePath(INVESTMENTS_MODULE_PATH);
}

/**
 * Run every enabled monitor against current figures and file a message for each
 * one that newly fired.
 *
 * **Called at the end of a price refresh** — this is the request's
 * `Run_Monitors_Against_my_ticker`. It runs after prices are written so it reads
 * the figures the refresh just produced, not the ones it replaced.
 *
 * Never throws: monitors are a courtesy on top of the refresh, and a failure
 * here must not turn a successful price update into an error on the reader's
 * screen. A failed run is reported as zero triggers.
 */
export async function runMonitorsAgainstMyTickerAction(): Promise<MonitorRunResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const result = runMonitors(
      deps.tickerMonitorRepo,
      deps.stockPositionRepo,
      deps.messageRepo,
    );
    if (result.triggered > 0) revalidatePath(INVESTMENTS_MODULE_PATH);
    return result;
  } catch {
    return { evaluated: 0, triggered: 0, cleared: 0, triggeredTickers: [] };
  }
}
