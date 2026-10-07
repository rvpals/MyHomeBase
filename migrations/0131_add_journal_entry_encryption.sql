-- Per-entry encryption for journal entries.
--
-- An encrypted entry keeps its date, time, place, weather, categories, tags and
-- locations in the clear -- those are what the lists, the calendar and the
-- filters are built from. Its **title and content** move into the two blob
-- columns below and the plaintext columns are overwritten with ''.
--
-- Each blob is `v1:salt:iv:tag:ciphertext`, all hex: scrypt-derived AES-256-GCM
-- with a fresh 16-byte salt and 12-byte IV per encryption. Title and content are
-- encrypted separately under the same password, each with its own salt and IV.
--
-- NOTE: `is_locked` is untouched and unrelated. It guards *editing* only and has
-- never encrypted anything; an entry can be locked, encrypted, both or neither.

-- 0 = a normal entry, 1 = title and content live in the blob columns.
ALTER TABLE jrn_entries ADD COLUMN is_encrypted INTEGER NOT NULL DEFAULT 0;

-- The two blobs. '' on every row written before this migration, and on every
-- entry that is not encrypted.
ALTER TABLE jrn_entries ADD COLUMN title_encrypted TEXT NOT NULL DEFAULT '';
ALTER TABLE jrn_entries ADD COLUMN content_encrypted TEXT NOT NULL DEFAULT '';

-- PLAINTEXT, deliberately: the hint has to be readable before anything can be
-- decrypted, so it cannot itself be encrypted. '' = no hint. The UI warns that
-- this is stored in the clear and must not contain the password.
ALTER TABLE jrn_entries ADD COLUMN password_hint TEXT NOT NULL DEFAULT '';

-- Encrypted entries are excluded from search, word stats, duplicate detection
-- and the importer's match key, so every one of those filters on this column.
CREATE INDEX IF NOT EXISTS idx_jrn_entries_is_encrypted
  ON jrn_entries (is_encrypted);

-- The recycle bin (migration 0079) must carry the same four columns.
--
-- Without them, binning an encrypted entry would copy only its blanked title and
-- content and the ciphertext would be dropped on the floor -- the entry would
-- restore as permanently unreadable, with no error at any point to say so. The
-- bin is a move, so it has to move everything.
ALTER TABLE jrn_recycled_entries ADD COLUMN is_encrypted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jrn_recycled_entries ADD COLUMN title_encrypted TEXT NOT NULL DEFAULT '';
ALTER TABLE jrn_recycled_entries ADD COLUMN content_encrypted TEXT NOT NULL DEFAULT '';
ALTER TABLE jrn_recycled_entries ADD COLUMN password_hint TEXT NOT NULL DEFAULT '';
