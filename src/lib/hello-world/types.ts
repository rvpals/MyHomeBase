// Domain models for the "Hello, world!" background job: a message, a cadence the
// reader spells as a number plus a unit, and the resolved settings those produce.
//
// The job exists to prove the scheduler end to end: each run files the configured
// message into the application-wide message queue, so the unread badge in every
// shell's header moves whenever the heartbeat fires. That makes it the cheapest
// possible answer to "is the scheduler actually alive on this install?" -- a
// question that previously could only be answered by watching some other job's side
// effects, or by tailing a log on the NAS.
//
// App-wide settings rather than module settings, for the same reason as the Data
// backup (migrations/0134): the job belongs to no module, so there is no module row
// to hang them off.

/**
 * Every interval unit the settings card offers, in the order it lists them.
 *
 * A closed set rather than a free-form string -- same shape as `REFRESH_INTERVALS`
 * and `BACKUP_INTERVALS` -- so `z.enum` can consume the tuple directly and this list
 * stays the single source of truth for what is representable.
 *
 * `second` is in the list because it was asked for, and it is honest about what it
 * can deliver: the scheduler is a fixed 60s heartbeat, so any cadence under a minute
 * fires once a minute, not faster. `MIN_HEARTBEAT_MINUTES` below is where that is
 * spelled out, and the admin card says so in words rather than silently rounding.
 */
export const INTERVAL_UNITS = ["second", "minute", "hour", "day", "week"] as const;

/** The unit half of the cadence: "every <count> <unit>". */
export type IntervalUnit = (typeof INTERVAL_UNITS)[number];

/**
 * How many minutes one of each unit is.
 *
 * Fractional for `second` on purpose. Rounding it up to 1 here would make
 * `shouldRunNow` agree with the heartbeat by accident; leaving it exact keeps the
 * arithmetic truthful and puts the heartbeat floor in one named place instead.
 */
const UNIT_MINUTES: Record<IntervalUnit, number> = {
  second: 1 / 60,
  minute: 1,
  hour: 60,
  day: 24 * 60,
  week: 7 * 24 * 60,
};

/**
 * The floor the scheduler can actually honour.
 *
 * `src/instrumentation-node.ts` ticks every 60 seconds, so "every 30 seconds" and
 * "every 1 second" both mean "every tick". Stated as a constant rather than enforced
 * by clamping the stored value: the reader's choice is saved as they typed it, and
 * the screen explains the floor. Clamping would silently rewrite their input.
 */
export const MIN_HEARTBEAT_MINUTES = 1;

/** How many minutes a unit means. The only place these numbers exist. */
export function unitToMinutes(unit: IntervalUnit): number {
  return UNIT_MINUTES[unit];
}

/** How each unit is written in the UI. Presentation reads this; it never invents labels. */
export const INTERVAL_UNIT_LABELS: Record<IntervalUnit, string> = {
  second: "second(s)",
  minute: "minute(s)",
  hour: "hour(s)",
  day: "day(s)",
  week: "week(s)",
};

/** The smallest and largest counts the boundary accepts. */
export const MIN_INTERVAL_COUNT = 1;
export const MAX_INTERVAL_COUNT = 1000;

/** How long a message may be. Long enough for a sentence, short enough for one line. */
export const MAX_MESSAGE_LENGTH = 200;

export interface HelloWorldSettings {
  /**
   * Master switch. Off means the server never says hello on its own, whatever the
   * cadence says. It does not gate the manual "Run now" button, which is an
   * explicit request rather than a background pass.
   */
  enabled: boolean;
  /** What the job writes into its run detail. */
  message: string;
  /** The number half of the cadence: "every <count> <unit>". */
  intervalCount: number;
  intervalUnit: IntervalUnit;
}

/**
 * How this job's messages are attributed in the queue.
 *
 * Matches the convention the Investments monitor and watch list set ("Investments
 * monitor", "Investments watch list"): a human-readable name for the thing that
 * filed it, so a reader scanning the queue can tell at a glance which messages are
 * the heartbeat's and purge them as a group.
 */
export const HELLO_WORLD_MESSAGE_SOURCE = "Hello, world!";

/** What one pass did. Returned by the runner and rendered by both front-ends. */
export interface HelloWorldRunSummary {
  /** False when the pass was skipped -- switched off, or not due yet. */
  ran: boolean;
  /** Why it was skipped. Only set when `ran` is false. */
  reason?: string;
  status?: "ok" | "failed";
  /** The one-line summary stored as `detail` and shown in the UI. */
  detail: string;
  /** The queue row this pass filed. Absent when nothing ran. */
  messageId?: number;
}

/**
 * How many runs a cadence produces in a day, for the admin card's warning.
 *
 * Pure arithmetic on the resolved minutes, floored at the heartbeat: the card uses
 * it to state the queue cost of the chosen interval *before* the job is armed,
 * because nothing prunes the message queue on a timer.
 */
export function runsPerDay(intervalMinutes: number): number {
  const effective = Math.max(intervalMinutes, MIN_HEARTBEAT_MINUTES);
  return Math.round((24 * 60) / effective);
}
