-- Content hashes, bulk operations and a recycle bin for the Document Library.
--
-- Three features, one migration, because they land in the same module and two of
-- them share the bin's tables. Taken apart they would be three migrations touching
-- doc_attachments in sequence, which is more churn for no more safety.
--
--   1. `content_hash` on doc_attachments        -- duplicate detection
--   2. the four doc_recycled_* tables           -- the bin
--   3. (bulk operations need no schema at all)  -- see the .md log
--
-- WHY MIRROR TABLES AND NOT A `deleted_at` FLAG ON doc_documents.
--
-- The same reasoning migration 0161 recorded for clips and 0079 for the journal,
-- and it applies here unchanged. A flag is the smaller migration and the worse
-- design: every existing read in this module -- the list, the filter, the taxonomy
-- pairings, the attachment aggregate behind DocumentSummary's count and total size
-- -- would have to learn to exclude binned rows, and ONE missed WHERE silently
-- serves a deleted document as though nothing happened. A separate table cannot be
-- read by accident: code that does not name it cannot see a binned document.
--
-- WHY ALL FOUR TABLES.
--
-- A document is not one row. Its attachments, its categories and its tags live in
-- three child tables. A bin that copied only doc_documents would restore a document
-- stripped of its files and its filing -- silent data loss wearing a safety
-- feature's clothes. So every table a document owns gets a mirror.
--
-- HOW THIS BIN DIFFERS FROM THE CLIPS BIN: THE FILES ARE NOT IN THE DATABASE.
--
-- A clip's images are BLOBs, so binning a clip moves every byte it owns into the
-- mirror tables and a restore is purely a database operation. A document's bytes
-- live on the NAS and doc_attachments is only the index to them.
--
-- That was already half-solved before this migration: `deleteDocument` called
-- `moveToDeleted`, which renames `doc_17/` to `_deleted/doc_17_<timestamp>/`. The
-- bytes already survived a delete. What did NOT survive was the index -- the rows
-- saying which file was which, what it was originally called and what it was
-- attached to -- so the surviving folder was a pile of files nobody could identify.
-- This bin preserves the index, and `deleted_folder` below records which stamped
-- folder the bytes went to so a restore can find them again.

-- ---------------------------------------------------------------------------
-- 1. Content hashes
-- ---------------------------------------------------------------------------
--
-- SHA-256 of the file's bytes, lowercase hex, computed at upload from the buffer
-- the upload already holds in memory. Node's built-in crypto -- no dependency.
--
-- DEFAULT '' means "never hashed", which is every row that exists today. That is
-- deliberately not an error state: backfilling would mean reading every file on the
-- share over SMB, which does not belong in a migration that must run fast and
-- offline. Un-hashed rows simply do not take part in duplicate detection until the
-- backfill CLI is run over them.
ALTER TABLE doc_attachments ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';

-- Partial, because the blank rows are the ones we never want back from this index
-- and (until a backfill runs) they are most of the table. Every duplicate lookup
-- filters `content_hash != ''`, so the partial index matches the query exactly.
CREATE INDEX idx_doc_attachments_hash
  ON doc_attachments(content_hash)
  WHERE content_hash != '';

-- ---------------------------------------------------------------------------
-- 2. The binned document
-- ---------------------------------------------------------------------------
--
-- Mirrors doc_documents column for column, with three additions:
--
--   * `id` is this table's own surrogate key, because the same original document
--     can be recycled, restored, and recycled again.
--   * `document_id` remembers the id it had in doc_documents. A restore aims to put
--     it back at that id -- see below for why that matters more here than it does
--     for a clip.
--   * `deleted_at` is when it went into the bin: the sort order of the list.
--   * `deleted_folder` is the stamped `_deleted/doc_17_2026-10-30T...` folder its
--     files were moved to, relative to the root, or '' when it had no files.
--
-- WHY `deleted_folder` HAS TO BE STORED RATHER THAN DERIVED.
--
-- `moveToDeleted` stamps the destination with a timestamp, because deleting a
-- document, re-filing it and deleting it again would otherwise collide on
-- `_deleted/doc_17` -- and on Windows a rename onto an existing non-empty folder
-- fails. That stamp is generated at the moment of the move and recorded nowhere
-- else. Without this column a restore would have to guess which of
-- `doc_17_2026-01-01...`, `doc_17_2026-06-14...` belonged to the row it is
-- restoring, and with two deletes of the same document in the bin it would be a
-- coin flip. So the move returns where it put the folder and we write it down.
CREATE TABLE doc_recycled_documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id     INTEGER NOT NULL,          -- the id it had in doc_documents

  title           TEXT    NOT NULL DEFAULT '',
  description     TEXT    NOT NULL DEFAULT '',

  created_by      INTEGER,                   -- NULL once that account is gone
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,

  deleted_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  -- '' when the document had no attachments, so nothing was moved.
  deleted_folder  TEXT    NOT NULL DEFAULT ''
);

-- The list is "newest deleted first" and nothing else, so one index covers it.
CREATE INDEX idx_doc_recycled_documents_deleted
  ON doc_recycled_documents(deleted_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- 3. The binned document's attachments
-- ---------------------------------------------------------------------------
--
-- Mirrors doc_attachments, `content_hash` included: a restored document must be
-- duplicate-checkable exactly as it was, and re-hashing on restore would mean
-- reading every file back off the share.
--
-- `relative_path` is carried VERBATIM -- it still reads `doc_17/lease.pdf` while the
-- bytes sit under `_deleted/doc_17_<stamp>/lease.pdf`. The path is stored as the
-- document's LIVE path, not its binned one, because that is what it must be again
-- after a restore; the bin's own location is `deleted_folder` on the parent. A
-- restore that lands on a different id rewrites these (see the .md log).
CREATE TABLE doc_recycled_attachments (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  recycled_document_id  INTEGER NOT NULL,

  file_name             TEXT    NOT NULL,
  original_name         TEXT    NOT NULL,
  relative_path         TEXT    NOT NULL,
  mime_type             TEXT    NOT NULL DEFAULT '',
  byte_size             INTEGER NOT NULL DEFAULT 0,
  content_hash          TEXT    NOT NULL DEFAULT '',
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL
);

CREATE INDEX idx_doc_recycled_attachments_parent
  ON doc_recycled_attachments(recycled_document_id, sort_order, id);

-- ---------------------------------------------------------------------------
-- 4. The binned document's filing
-- ---------------------------------------------------------------------------
--
-- Categories and tags, mirroring doc_document_categories and doc_document_tags.
--
-- The names are carried as text, exactly as the live pairings hold them, and are
-- NOT re-checked against doc_categories on the way back in. A category deleted
-- while the document sat in the bin is re-created by the restore's INSERT OR IGNORE
-- into the pairing table -- the same forgiving behaviour `upsertCategory` gives
-- inline creation while filing. A restore is not the place to discover that a
-- taxonomy row is missing and fail.
CREATE TABLE doc_recycled_document_categories (
  recycled_document_id  INTEGER NOT NULL,
  category_name         TEXT    NOT NULL,
  PRIMARY KEY (recycled_document_id, category_name)
);

CREATE TABLE doc_recycled_document_tags (
  recycled_document_id  INTEGER NOT NULL,
  tag_name              TEXT    NOT NULL,
  PRIMARY KEY (recycled_document_id, tag_name)
);
