-- The Data backup's cadence becomes a COUNT plus a UNIT, replacing the fixed enum.
--
-- Before this, `backup_interval` held one of hourly/daily/weekly/monthly. That is
-- four cadences, and there was no way to ask for "every 6 hours" or "every 3 days".
-- The "Hello, world!" job (migrations/0136) already stores its cadence as a count
-- and a unit for exactly the reason that is better: it is what the reader types.
-- The backup now uses the same pair, and the same vocabulary of units -- the lib
-- re-exports them from src/lib/hello-world/types.ts rather than keeping a copy.
--
-- `backup_start_time` is NOT superseded. It still anchors the first run, which is
-- what makes "every 1 day" mean 02:00 rather than "24h after whenever the switch
-- was flipped". A fixed enum needed an anchor and a flexible cadence still does.
--
-- `backup_interval` is left in place rather than deleted. It is no longer read by
-- any code -- `resolveBackupSettings` reads the two new keys -- but its row carries
-- the only in-database record of what the old setting meant, and dropping it would
-- make a rollback silently fall back to a default instead of the reader's choice.
--
-- The UPDATE below carries an existing choice across rather than letting every
-- install that had configured a backup come up as "every 1 day". It runs before
-- the INSERT so that a seeded default never shadows a real stored value: the
-- INSERT's ON CONFLICT DO NOTHING then only fills in what the UPDATE did not.
--
-- Monthly maps to 30 days, which is exactly what the old INTERVAL_MINUTES table
-- meant by "monthly" -- calendar months were never tracked, so this loses nothing.

-- Carry an already-configured cadence across. Harmless on a fresh install, where
-- `backup_interval` is the seeded 'daily' and these land on the same values the
-- INSERT below would have written anyway.
INSERT INTO sys_app_settings (key, value, description)
SELECT
  'backup_interval_count',
  CASE (SELECT value FROM sys_app_settings WHERE key = 'backup_interval')
    WHEN 'hourly'  THEN '1'
    WHEN 'daily'   THEN '1'
    WHEN 'weekly'  THEN '1'
    WHEN 'monthly' THEN '30'
    ELSE '1'
  END,
  'How many of the interval unit between backups. With the unit, "every 1 day".'
WHERE EXISTS (SELECT 1 FROM sys_app_settings WHERE key = 'backup_interval')
ON CONFLICT(key) DO NOTHING;

INSERT INTO sys_app_settings (key, value, description)
SELECT
  'backup_interval_unit',
  CASE (SELECT value FROM sys_app_settings WHERE key = 'backup_interval')
    WHEN 'hourly'  THEN 'hour'
    WHEN 'daily'   THEN 'day'
    WHEN 'weekly'  THEN 'week'
    WHEN 'monthly' THEN 'day'
    ELSE 'day'
  END,
  'The interval unit: second, minute, hour, day or week. Under a minute runs once a minute -- the scheduler checks every 60s.'
WHERE EXISTS (SELECT 1 FROM sys_app_settings WHERE key = 'backup_interval')
ON CONFLICT(key) DO NOTHING;

-- The defaults, for an install that never had a `backup_interval` row at all.
INSERT INTO sys_app_settings (key, value, description) VALUES
  ('backup_interval_count', '1',
   'How many of the interval unit between backups. With the unit, "every 1 day".'),
  ('backup_interval_unit', 'day',
   'The interval unit: second, minute, hour, day or week. Under a minute runs once a minute -- the scheduler checks every 60s.')
ON CONFLICT(key) DO NOTHING;

-- Mark the old key as superseded, so a reader of the table is not left guessing
-- why nothing reads it. The value is deliberately untouched.
UPDATE sys_app_settings
SET description = 'SUPERSEDED by backup_interval_count and backup_interval_unit (migrations/0138). No longer read. Kept as the record of the pre-0138 cadence.'
WHERE key = 'backup_interval';
