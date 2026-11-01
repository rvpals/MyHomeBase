// The Document Library's background text-indexing job: its settings, and the
// "is it time yet?" decision.
//
// Pure. No `deps`, no timers, no I/O — which is what makes the cadence testable
// without waiting for a clock. `text-index-runner.ts` is the half that knows about
// the composition root, the same split `hello-world/settings.ts` and its runner use.
//
// ## Why this job exists
//
// Reading a document's text is cheap for a digital PDF (~170ms) and expensive for a
// scan (seconds a page, ~320MB of RSS). Doing it in front of a reader is fine once,
// from the OCR button. Doing it for a whole library has to happen when nobody is
// waiting — which is this.
//
// ## Why it is safe to run on a timer
//
// Migration 0166. A file is read once: it returns to the work list only if its bytes
// change, and a scan OCR has already failed to read is never retried. Without that
// the job would re-recognise every unreadable page on every pass, forever.

/**
 * The job's keys in the Document Library's module settings.
 *
 * Module settings rather than `sys_app_settings` because this job belongs to a
 * module — unlike the backup or "Hello, world!", which belong to no module and so
 * live app-wide. Spelled once here: these are a key column, so renaming one orphans
 * stored state, the same rule as the icon slot ids.
 */
export const TEXT_INDEX_SETTING_KEYS = {
  enabled: "document_text_index_enabled",
  intervalHours: "document_text_index_interval_hours",
  /** Whether a pass may run OCR, or only read embedded text layers. */
  ocrEnabled: "document_text_index_ocr",
  /** How many files one pass will look at. */
  batchSize: "document_text_index_batch",
} as const;

/**
 * Off by default.
 *
 * An install that upgrades into this job must not start OCR'ing a library nobody
 * asked it to touch — on a 2GB NAS that is a visible slowdown arriving unannounced.
 * Turning it on is a deliberate act.
 */
export const DEFAULT_TEXT_INDEX_ENABLED = false;

/**
 * Six hours, not sixty seconds.
 *
 * The work is finite and self-limiting: once a library is indexed, every later pass
 * finds nothing and costs one query. The interval only governs how quickly newly
 * filed documents become searchable, and "within a few hours" is the right answer for
 * paperwork. A tighter cadence would mean the NAS waking to do nothing all day.
 */
export const DEFAULT_TEXT_INDEX_INTERVAL_HOURS = 6;

/** OCR on by default — a job that skipped every scan would miss the point. */
export const DEFAULT_TEXT_INDEX_OCR = true;

/**
 * How many files one pass looks at.
 *
 * **This is the only brake on the job's cost.** It was chosen deliberately unthrottled
 * per page: a pass drains up to this many files in one go rather than recognising a
 * fixed number of pages and stopping. On the DS223, 25 scanned files could occupy the
 * box for several minutes, and OCR holds ~320MB of RSS while it works.
 *
 * That is a considered trade — a library reaches "fully indexed" in a few passes
 * instead of many — but it is the number to lower first if the NAS feels sluggish
 * while the job runs.
 */
export const DEFAULT_TEXT_INDEX_BATCH = 25;

const MIN_INTERVAL_HOURS = 1;
const MAX_INTERVAL_HOURS = 24 * 7;
const MIN_BATCH = 1;
const MAX_BATCH = 500;

export interface TextIndexJobSettings {
  enabled: boolean;
  intervalHours: number;
  ocrEnabled: boolean;
  batchSize: number;
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Parses the stored rows into typed values.
 *
 * Every field degrades to a safe default rather than throwing. This runs inside a
 * background tick where a throw is invisible, so a hand-edited row saying "every 0
 * hours" has to fall back to the safe cadence rather than spin the job or kill the
 * scheduler. Same forgiving shape, and the same reason, as the Hello, world! job's.
 */
export function resolveTextIndexJobSettings(
  rows: { key: string; value: string }[],
): TextIndexJobSettings {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return {
    enabled: byKey.get(TEXT_INDEX_SETTING_KEYS.enabled) === "1",
    intervalHours: clamp(
      Number(byKey.get(TEXT_INDEX_SETTING_KEYS.intervalHours)),
      MIN_INTERVAL_HOURS,
      MAX_INTERVAL_HOURS,
      DEFAULT_TEXT_INDEX_INTERVAL_HOURS,
    ),
    // Absent means the default (on); only an explicit "0" turns it off, so an install
    // that never set the key gets a job that actually reads its scans.
    ocrEnabled: (byKey.get(TEXT_INDEX_SETTING_KEYS.ocrEnabled) ?? "1") !== "0",
    batchSize: clamp(
      Number(byKey.get(TEXT_INDEX_SETTING_KEYS.batchSize)),
      MIN_BATCH,
      MAX_BATCH,
      DEFAULT_TEXT_INDEX_BATCH,
    ),
  };
}

/** Whether the switch is on. Separate so a caller can check it without the cadence. */
export function isTextIndexJobEnabled(settings: TextIndexJobSettings): boolean {
  return settings.enabled;
}

/**
 * Whether a pass is due.
 *
 * `lastRunAtMs` is `undefined` when the job has never run, which counts as due: a
 * freshly enabled job should index at the next tick rather than after a first full
 * interval of silence.
 *
 * Takes the clock as an argument rather than calling `Date.now()` so the decision is
 * testable, the same shape as `shouldRunNow` in the Hello, world! job.
 */
export function isTextIndexPassDue(
  settings: TextIndexJobSettings,
  lastRunAtMs: number | undefined,
  nowMs: number,
): boolean {
  if (!settings.enabled) return false;
  if (lastRunAtMs === undefined) return true;
  return nowMs - lastRunAtMs >= settings.intervalHours * 60 * 60 * 1000;
}

/** "every 6 hours" — the cadence as the admin card prints it. */
export function describeTextIndexInterval(settings: TextIndexJobSettings): string {
  const hours = settings.intervalHours;
  if (hours === 1) return "every hour";
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? "every day" : `every ${days} days`;
  }
  return `every ${hours} hours`;
}

/**
 * The settings rows this job reads, for a caller assembling a settings screen.
 *
 * Exported so the Configuration view and the admin card name the same keys the
 * resolver does, rather than each spelling them out.
 */
export const TEXT_INDEX_SETTING_KEY_LIST = [
  TEXT_INDEX_SETTING_KEYS.enabled,
  TEXT_INDEX_SETTING_KEYS.intervalHours,
  TEXT_INDEX_SETTING_KEYS.ocrEnabled,
  TEXT_INDEX_SETTING_KEYS.batchSize,
] as const;
