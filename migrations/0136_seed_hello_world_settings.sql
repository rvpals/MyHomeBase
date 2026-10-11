-- The "Hello, world!" background job's settings (Administration -> Background Tasks
-- -> Configuration -> Hello, world!).
--
-- App settings rather than module settings: this job belongs to no module, so there
-- is no module row to hang them off. `sys_app_settings` is the app-wide key/value
-- store (migrations/0002). Same reasoning as the Data backup's keys in 0134.
--
-- Strictly speaking this seed is optional -- `SqliteSettingsRepository.updateAll`
-- upserts, so saving works against keys that have never been stored. It is here for
-- the `description` column, which the upsert deliberately leaves alone and which is
-- the only in-database record of what each key means.
--
-- The cadence is stored as a COUNT and a UNIT rather than as a number of minutes,
-- because that is what the reader types: "1" and "minute". Resolving the pair to
-- minutes is `intervalToMinutes` in src/lib/hello-world/settings.ts, and keeping the
-- two halves separate is what lets the screen show back exactly what was chosen
-- rather than a normalised figure the reader never entered.
--
-- Each run files one message into the queue (sys_messages, migrations/0109) so the
-- header's unread badge moves whenever the scheduler fires -- that visibility is the
-- whole reason the job exists. Nothing prunes that queue on a timer, so the cadence is
-- also a decision about how fast it fills: every 1 minute is ~1,440 messages a day.
--
-- Defaults are deliberately switched OFF: an install that upgrades into this job
-- must not start filling its message queue with a heartbeat nobody asked for.

INSERT INTO sys_app_settings (key, value, description) VALUES
  ('hello_world_enabled', 'false',
   'Whether the scheduled "Hello, world!" job runs. A manual "Run now" ignores this.'),
  ('hello_world_message', 'Hello, world!',
   'Filed as the title of the message each run puts in the queue (sys_messages).'),
  ('hello_world_interval_count', '1',
   'How many of the interval unit between runs. With the unit, "every 1 minute".'),
  ('hello_world_interval_unit', 'minute',
   'The interval unit: second, minute, hour, day or week. Under a minute runs once a minute -- the scheduler checks every 60s.')
ON CONFLICT(key) DO NOTHING;
