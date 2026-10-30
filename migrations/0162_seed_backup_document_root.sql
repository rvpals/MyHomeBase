-- Where the Data backup copies the Document Library's files
-- (Administration -> Configuration -> Backup Data -> Attachment files -> Document Library).
--
-- Seeded for the `description` column only: `SqliteSettingsRepository.updateAll`
-- upserts, so saving works without it (see migrations/0134). `none` is the "no folder
-- chosen" sentinel, mapped back to "" by `resolveBackupSettings`.

INSERT INTO sys_app_settings (key, value, description) VALUES
  ('backup_document_root', 'none',
   'Folder that Document Library files are backed up into. "none" means not set.')
ON CONFLICT(key) DO NOTHING;
