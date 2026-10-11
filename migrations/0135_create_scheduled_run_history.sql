-- Execution history for the background jobs, one row per PASS.
--
-- WHY A SECOND TABLE. `sys_scheduled_runs` (0061) is keyed on `job_key`, so it
-- holds exactly one row per job and `start()` overwrites it on every pass. That is
-- the right shape for the question it answers -- "did this job run, and how did it
-- go?" -- and the wrong shape for "show me the last N runs". It also records only
-- when a pass STARTED; there is nowhere to put a finish time, so a duration cannot
-- be computed from it at all.
--
-- The two tables are kept separate rather than merged. 0061's row is read on every
-- render of the Background Tasks screen and on every scheduling decision (the
-- runners parse `last_run_at` to decide whether an interval has elapsed), and
-- turning that single-row lookup into "the newest of N" would put a sort on the hot
-- path of five jobs' 60s heartbeats to serve a dialog nobody has open.
CREATE TABLE sys_scheduled_run_history (
  -- A surrogate key, unlike 0061's natural one: here a job has MANY rows and the
  -- only thing distinguishing two passes is when they happened. Monotonic, so
  -- `ORDER BY id DESC` is newest-first without parsing a timestamp.
  id          INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Matches `sys_scheduled_runs.job_key`. Deliberately NOT a foreign key: 0061's
  -- row is an upsert target that may not exist when the first history row is
  -- written, and a retired job's history should survive its last-run row being
  -- cleared rather than cascade away.
  job_key     TEXT NOT NULL,

  -- When the pass started, as a SQLite-style UTC timestamp.
  started_at  TEXT NOT NULL,

  -- When it finished. NULL means it did not -- the process was killed mid-pass, or
  -- a deploy cycled the server while it was working. Same reasoning as 0061's
  -- nullable `last_status`: an unknown outcome must read as unknown, never as
  -- success, and this is the column that makes "started but never finished"
  -- visible rather than invisible.
  finished_at TEXT,

  -- 'ok' | 'partial' | 'failed', written when the pass finishes. NULL for the same
  -- reason as `finished_at`, and always NULL exactly when that is.
  status      TEXT,

  -- The same rendered one-liner 0061 stores ("38 priced, 1 failed"). A string, not
  -- a JSON blob: nothing queries it, and a schema for it would be a schema to
  -- migrate.
  detail      TEXT
);

-- Serves both readers of this table, which are the only two there will be: the
-- dialog's "newest 50 for this job", and the prune that runs after every insert.
-- Both are (job_key, newest-first), which is exactly this index.
CREATE INDEX idx_scheduled_run_history_job ON sys_scheduled_run_history (job_key, id DESC);
