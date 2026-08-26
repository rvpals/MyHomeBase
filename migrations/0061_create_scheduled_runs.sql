-- Last-run bookkeeping for the app's background jobs, plus the two module
-- settings that drive the Stocks & ETFs auto-refresh.
--
-- WHY A TABLE AT ALL. The two background jobs that already exist
-- (`src/instrumentation.ts`: the Expense CSV auto-import and the auth-event
-- prune) keep "when did I last run" on `globalThis`. That is fine for a 60-minute
-- interval: a restart re-runs a little early and nothing is harmed.
--
-- It is NOT fine for a daily interval, which is this job's default. `start.sh`
-- cycles the process on every deploy and has an every-minute keepalive that will
-- restart it after any crash, so in-memory state means "daily" degrades into
-- "on every boot" -- the one reading of the setting the user did not ask for.
-- Persisting the timestamp also makes a missed window self-correcting: the NAS
-- can be asleep or mid-deploy at the appointed hour and the next tick still sees
-- that the interval has elapsed.
--
-- `sys_` prefix, alongside `sys_module_settings` (0006) and
-- `sys_schema_migrations`: this is application plumbing, not domain data.
CREATE TABLE sys_scheduled_runs (
  -- The job's stable name, e.g. 'stock_auto_refresh'. Primary key for the same
  -- reason `stk_ticker_favorites.ticker` is (0058): a job has no identity beyond
  -- its name, there can only be one row per job, and nothing references it by a
  -- surrogate key. That makes a run-stamp a single upsert against a known key.
  job_key     TEXT PRIMARY KEY,

  -- When the job last STARTED, not finished. The runner stamps this before doing
  -- the work, which is what stops a slow pass from overlapping the next tick --
  -- the same ordering the expense importer uses for its in-memory stamp.
  last_run_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- 'ok' | 'partial' | 'failed', written when the pass finishes. Nullable
  -- because a row exists from the moment a run starts, and a process killed
  -- mid-pass should leave the outcome unknown rather than claim success.
  last_status TEXT,

  -- One human-readable line for the settings screen ("38 priced, 1 failed").
  -- Deliberately a rendered string, not a JSON blob: nothing queries it, and a
  -- schema for it would be a schema to migrate.
  last_detail TEXT
);

-- Seeds the auto-refresh switch OFF for the Stocks & ETFs module.
--
-- Off, not on. This job makes outbound calls to a free, unauthenticated Yahoo
-- endpoint, and a deploy that silently starts hitting it on a timer is a
-- surprise -- worse, one whose cost lands on a shared upstream rather than
-- locally. Note this is the opposite default from the expense importer's switch,
-- which defaults ON only because it was retrofitted over installs that were
-- already importing; there is no existing behaviour here to preserve.
--
-- `datetime('now')` and the description text match the shape of the rows the
-- Administration -> Module Configuration screen writes, so a seeded row and a
-- hand-edited one are indistinguishable.
INSERT OR IGNORE INTO sys_module_settings (module_id, setting_key, setting_value, setting_description)
SELECT id, 'auto_refresh_enabled', 'false',
       'When on, the server refreshes all prices, sectors and today''s snapshot on the interval below.'
FROM sys_modules WHERE slug = 'stock-etfs';

-- The interval. Stored as a token ('hourly' | 'half-daily' | 'daily') rather
-- than a number of minutes, unlike the expense importer's free-text minutes,
-- because the UI offers exactly three choices -- so the storage should not be
-- able to represent "every 7 minutes" and force every reader to decide whether
-- that is legal.
--
-- 'daily' is the default: prices that matter for a portfolio move once a day,
-- and the codebase already warns (src/lib/ticker-profiles/ticker-profiles.ts)
-- that hammering this provider is how a free endpoint starts answering 429.
INSERT OR IGNORE INTO sys_module_settings (module_id, setting_key, setting_value, setting_description)
SELECT id, 'auto_refresh_interval', 'daily',
       'How often the scheduled refresh runs: hourly, half-daily or daily.'
FROM sys_modules WHERE slug = 'stock-etfs';
