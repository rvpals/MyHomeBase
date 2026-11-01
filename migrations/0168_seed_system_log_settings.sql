-- The system log's two switches, and its row cap (migrations/0167).
--
-- App settings rather than module settings: the log belongs to no module -- it is
-- written by scheduled jobs, by the composition root and by whatever code is being
-- diagnosed -- so there is no module row to hang them off. Same reasoning as the
-- "Hello, world!" keys in 0136 and the backup's in 0134.
--
-- Strictly this seed is optional: `SqliteSettingsRepository` upserts, so a write
-- works against keys that were never stored. It is here for the `description`
-- column, which the upsert leaves alone and which is the only record inside the
-- database of what each key means.
--
-- WHERE THEY ARE EDITED: Administration -> Configuration -> Application
-- Configuration, beside the upload and document limits. Not on the System Log screen
-- itself, and not on Background Tasks: these are app-wide switches, which is what
-- that screen is for, and keeping the viewer free of its own controls means the log
-- can be read on a phone without a settings panel above it.
--
-- 'true'/'false' spelled out, matching `hello_world_enabled` (0136) rather than the
-- '1'/'0' the Document Library's module settings use. Both conventions exist in this
-- database; this one is what `sys_app_settings` already carries, and a key is read by
-- whichever resolver owns it, so the inconsistency costs nothing and a conversion
-- would be a migration for a cosmetic gain.
--
-- BOTH SWITCHES DEFAULT OFF. An install that upgrades into this feature must not
-- start writing a log nobody asked for -- on the NAS that is disk filling quietly,
-- and with `operational` on the Hello, world! job alone writes ~2,880 rows a day
-- (a trigger line and a finish line, every minute).
--
-- There is deliberately NO auto-off timer. An earlier draft had the switch stamp an
-- expiry and revert itself after a few hours, as a guard against leaving debug on.
-- Rejected: a switch on a configuration screen that silently un-sets itself is more
-- surprising than a log that grew, and the row cap below already bounds the cost.

INSERT INTO sys_app_settings (key, value, description) VALUES
  ('system_log_debug', 'false',
   'Whether DEBUG lines are written to the system log (sys_system_log). Verbose: planted at specific places while something is being diagnosed.'),
  ('system_log_operational', 'false',
   'Whether OPERATIONAL lines are written to the system log (sys_system_log). Routine activity, such as a scheduled job triggering and finishing.'),
  ('system_log_max_rows', '5000',
   'How many lines the system log keeps. The oldest are deleted once it grows past this. 0 or blank falls back to the built-in default.')
ON CONFLICT(key) DO NOTHING;
