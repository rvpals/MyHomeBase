import type { MonitorPositionReader, TickerMonitorRepository } from "./ports";
import type { CreateMonitor, UpdateMonitor } from "./schema";
import { DEFAULT_BAND_PCT, type TickerMonitor } from "./types";

/** An in-memory monitor store for tests. */
export class FakeTickerMonitorRepository implements TickerMonitorRepository {
  readonly monitors: TickerMonitor[] = [];
  private nextId = 1;

  constructor(seed: TickerMonitor[] = []) {
    for (const monitor of seed) {
      this.monitors.push({ ...monitor });
      this.nextId = Math.max(this.nextId, monitor.id + 1);
    }
  }

  listByTicker(ticker: string): TickerMonitor[] {
    return this.monitors.filter((monitor) => monitor.ticker === ticker);
  }

  listEnabled(): TickerMonitor[] {
    return this.monitors.filter((monitor) => monitor.isEnabled);
  }

  getById(id: number): TickerMonitor | undefined {
    return this.monitors.find((monitor) => monitor.id === id);
  }

  create(input: CreateMonitor): TickerMonitor {
    const monitor: TickerMonitor = {
      id: this.nextId++,
      ticker: input.ticker,
      monitorType: input.monitorType,
      targetCents: input.targetCents,
      targetPct: input.targetPct,
      bandPct: input.bandPct,
      isEnabled: input.isEnabled,
      isTriggered: false,
      lastMessage: "",
      createdAt: "2026-01-01 00:00:00",
      updatedAt: "2026-01-01 00:00:00",
    };
    this.monitors.push(monitor);
    return monitor;
  }

  update(input: UpdateMonitor): TickerMonitor {
    const monitor = this.getById(input.id);
    if (!monitor) throw new Error(`No monitor with id ${input.id}.`);
    Object.assign(monitor, {
      ticker: input.ticker,
      monitorType: input.monitorType,
      targetCents: input.targetCents,
      targetPct: input.targetPct,
      bandPct: input.bandPct,
      isEnabled: input.isEnabled,
      // Matches the SQL: an edit re-arms, so the first crossing of a new target
      // is not swallowed by the old one's latch.
      isTriggered: false,
    });
    return monitor;
  }

  setEnabled(id: number, isEnabled: boolean): void {
    const monitor = this.getById(id);
    if (monitor) monitor.isEnabled = isEnabled;
  }

  delete(id: number): void {
    const index = this.monitors.findIndex((monitor) => monitor.id === id);
    if (index >= 0) this.monitors.splice(index, 1);
  }

  setTriggered(id: number, isTriggered: boolean, message: string): void {
    const monitor = this.getById(id);
    if (!monitor) return;
    monitor.isTriggered = isTriggered;
    if (isTriggered) {
      monitor.lastTriggeredAt = "2026-01-02 00:00:00";
      monitor.lastMessage = message;
    }
  }
}

/** A two-line stand-in for the positions side. */
export class FakePositionReader implements MonitorPositionReader {
  constructor(
    private readonly byTicker: Record<
      string,
      { unrealizedGainLossCents: number; costCents: number }[]
    > = {},
  ) {}

  listPositionsByTicker(ticker: string) {
    return this.byTicker[ticker] ?? [];
  }
}

/** Builds a monitor with sensible defaults, so a test states only what it means. */
export function makeMonitor(overrides: Partial<TickerMonitor> = {}): TickerMonitor {
  return {
    id: 1,
    ticker: "NVDA",
    monitorType: "gain_near_amount",
    targetCents: 1_000_000,
    targetPct: 0,
    bandPct: DEFAULT_BAND_PCT,
    isEnabled: true,
    isTriggered: false,
    lastMessage: "",
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-01 00:00:00",
    ...overrides,
  };
}
