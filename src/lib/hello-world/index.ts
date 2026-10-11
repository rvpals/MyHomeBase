// The public surface of the "Hello, world!" module.
//
// NOTE ON IMPORTING THIS FROM A CLIENT COMPONENT: don't. `runner.ts` reaches into
// the composition root, which opens the SQLite connection, so pulling this index
// into a `"use client"` file drags better-sqlite3 into the browser bundle and the
// build fails. Client components import the types straight from `./types` -- same
// rule, and the same reason, as `src/lib/backup/index.ts`.

export type {
  HelloWorldRunSummary,
  HelloWorldSettings,
  IntervalUnit,
} from "./types";
export {
  HELLO_WORLD_MESSAGE_SOURCE,
  INTERVAL_UNIT_LABELS,
  INTERVAL_UNITS,
  MAX_INTERVAL_COUNT,
  MAX_MESSAGE_LENGTH,
  MIN_HEARTBEAT_MINUTES,
  MIN_INTERVAL_COUNT,
  runsPerDay,
  unitToMinutes,
} from "./types";

export {
  helloWorldSettingsInputSchema,
  helloWorldMessageSchema,
  intervalCountSchema,
  intervalUnitSchema,
  type HelloWorldSettingsInput,
} from "./schema";

export {
  DEFAULT_INTERVAL_COUNT,
  DEFAULT_INTERVAL_UNIT,
  DEFAULT_MESSAGE,
  HELLO_WORLD_SETTING_KEYS,
  describeInterval,
  helloWorldSettingsToEntries,
  intervalToMinutes,
  isHelloWorldEnabled,
  nextRunDueAtMs,
  resolveHelloWorldSettings,
  shouldRunNow,
} from "./settings";

export {
  HELLO_WORLD_JOB_KEY,
  describeHelloWorldSchedule,
  loadHelloWorldSettings,
  loadLastHelloWorldRun,
  runHelloWorldNow,
} from "./runner";
