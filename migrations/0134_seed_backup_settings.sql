-- The Data backup job's settings (Administration -> Configuration -> Backup Data).
--
-- App settings rather than module settings: this job belongs to no module, so there
-- is no module row to hang them off. `sys_app_settings` is the app-wide key/value
-- store (migrations/0002).
--
-- Strictly speaking this seed is optional -- `SqliteSettingsRepository.updateAll`
-- upserts, so saving works against keys that have never been stored. It is here for
-- the `description` column, which the upsert deliberately leaves alone and which is
-- the only in-database record of what each key means.
--
-- `none` is the sentinel for "no folder chosen": `settingUpdateSchema` requires a
-- non-empty value, so a blank path cannot be written at all. `resolveBackupSettings`
-- maps it back to "".
--
-- Defaults are deliberately switched OFF with no folders: an install that upgrades
-- into this feature must not start writing archives to a folder nobody chose.

INSERT INTO sys_app_settings (key, value, description) VALUES
  ('backup_enabled', 'false',
   'Whether the scheduled Data backup runs. A manual "Run backup now" ignores this.'),
  ('backup_attachment_root', 'none',
   'Folder that attachment files are backed up into. "none" means not set.'),
  ('backup_database_root', 'none',
   'Folder that compressed database archives are written to. "none" means not set.'),
  ('backup_keep_count', '7',
   'How many database archives to keep. Older ones are deleted after a successful backup.'),
  ('backup_interval', 'daily',
   'How often the backup runs: hourly, daily, weekly or monthly.'),
  ('backup_start_time', '02:00',
   'The time of day the schedule is anchored to, as HH:MM in the server''s local time.')
ON CONFLICT(key) DO NOTHING;
