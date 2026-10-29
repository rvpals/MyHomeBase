-- Document Library: filed documents and the attachment files kept for them on the NAS.
--
-- WHY THIS MODULE EXISTS. The household accumulates paperwork that is not a receipt
-- and not a recipe -- a lease, a warranty, an insurance policy, a manual. Each is a
-- *document* with a title, a taxonomy and one or more files, and none of them belong
-- in the Journal (which is what someone wrote) or in Clips (which is content pasted
-- beside an entry). So documents get their own module.
--
-- WHY THE BYTES ARE NOT IN HERE. A scanned lease is megabytes, and a household's
-- paperwork is gigabytes. Migration 0079 already recorded what storing file bytes
-- inline costs when it dropped `jrn_entry_images`. Files live on a configured folder
-- on the NAS; `doc_attachments` is the index to them, exactly as the Household's HSA
-- receipts work (`hsh_hsa_expenses.receipt_path`).
--
-- WHY THERE IS NO DATE COLUMN. Considered and deliberately dropped: nothing here is
-- filed by when it happened. A lease has a term, a warranty has an expiry, a manual
-- has neither, and a single `doc_date` would have meant something different for each.
-- `created_at` records when it was filed, which is the only date this module can state
-- honestly. The folder layout is flat (`doc_<id>/`) as a result -- there is no year to
-- file under, and one folder per document keeps the root to one entry per record.
--
-- WHY `doc_` AND NOT `hsh_`. Documents are not a Household feature. The Household
-- module is recipes, receipts and the HSA; a module is reachable, searchable and
-- taggable on its own. `coding-guide.md`'s rule applies: a prefix is a module
-- namespace, so the Document Library takes its own.
--
-- No DB-level foreign keys, per project convention -- the repository maintains the
-- cascades, and `deleteDocument` removes a document's taxonomy and attachment rows in
-- one transaction.

-- One document. Shared: every reader granted the module sees every document, the same
-- choice `clp_clips` made (migration 0155) and for the same reason -- this is the
-- household's paperwork, not one person's diary.
CREATE TABLE doc_documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Required, unlike a clip's. An untitled clip is a normal thing to jot; an untitled
  -- *document* is unfindable, which defeats the one thing a library is for.
  title        TEXT    NOT NULL,

  -- Free text: what this is, why it was kept, where the original lives. Blank, never
  -- NULL, so no reader has to handle two kinds of nothing.
  description  TEXT    NOT NULL DEFAULT '',

  -- Who filed it, or NULL once that account is gone. Attribution for the household,
  -- never a permission check -- every document is readable and editable by everyone
  -- granted the module, exactly as `clp_clips.created_by` and `tol_todo_items.created_by`
  -- are. Nothing filters on it.
  created_by   INTEGER,                          -- -> sys_users.id

  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The list's only ordering: most recently touched first. The id tiebreaker is not
-- optional -- two documents saved in the same second are ordinary, and without it tied
-- rows come back in an arbitrary order that appears to shuffle between renders. The
-- same lesson `idx_clp_clips_updated` records.
CREATE INDEX idx_doc_documents_updated ON doc_documents (updated_at DESC, id DESC);

CREATE TRIGGER doc_documents_set_updated_at
AFTER UPDATE ON doc_documents
FOR EACH ROW
BEGIN
  UPDATE doc_documents SET updated_at = datetime('now') WHERE id = old.id;
END;

-- One file attached to a document.
--
-- THE BYTES ARE NOT HERE. `relative_path` locates the file inside the configured
-- document folder; the file store reads and writes it. See the note at the top.
CREATE TABLE doc_attachments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id    INTEGER NOT NULL,               -- -> doc_documents.id

  -- The name as stored on disk, after sanitising and any collision suffix. This is
  -- the last segment of `relative_path`, kept as its own column so a reader listing
  -- attachments never has to parse a path.
  file_name      TEXT    NOT NULL,

  -- The name the file arrived with, verbatim. What the UI shows and what a download
  -- is named: a reader recognises "Scan 12-03.pdf", not "scan-12-03.pdf".
  original_name  TEXT    NOT NULL,

  -- Where the file sits RELATIVE to the configured root, forward slashes always:
  -- `doc_17/lease-2026.pdf`.
  --
  -- Relative, not absolute, for the same reason the HSA receipts are: pointing the
  -- setting at a copy of the folder keeps every stored path working. It is also the
  -- string that gets resolved through `resolveInside`, which is what stops a crafted
  -- value reaching the rest of the share.
  relative_path  TEXT    NOT NULL,

  -- Derived from the stored EXTENSION, never from what the browser claimed: a client
  -- can send any Content-Type it likes, and this value is what the serving route
  -- hands back. An unknown extension is stored as application/octet-stream, which
  -- makes the browser download it rather than render it.
  mime_type      TEXT    NOT NULL,

  -- Recorded so "how big is this document" is answerable without touching the share.
  byte_size      INTEGER NOT NULL DEFAULT 0,

  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_doc_attachments_document ON doc_attachments (document_id, sort_order, id);

-- Managed category list. Keyed by name, the same natural-key precedent as
-- jrn_categories and clp_categories: the pairing tables reference the name, not a
-- surrogate id.
--
-- Categories and tags are two lists on purpose. A category says what KIND of document
-- this is (Insurance, Warranty, Tax); a tag says what it is ABOUT (car, house, 2026).
-- modules.md records the same distinction for the Journal's entry taxonomy.
CREATE TABLE doc_categories (
  name                 TEXT PRIMARY KEY,
  description          TEXT NOT NULL DEFAULT '',

  -- A small icon per category, so each is recognisable at a glance wherever it is
  -- listed. BLOB + mime type alongside, mirroring jrn_categories.icon_image
  -- (migration 0042): the bytes are served by a dedicated route rather than inlined
  -- as a base64 data URL, so they never bloat a JSON payload and the browser can
  -- cache them.
  --
  -- READS OF THE CATEGORY LIST MUST NAME THEIR COLUMNS and omit icon_image. A
  -- SELECT * here pulls every icon's bytes into memory on every page that lists
  -- categories. TAXONOMY_COLUMNS in the repository exists for exactly this.
  icon_image           BLOB,
  icon_image_mime_type TEXT,

  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One category per name, case-insensitively. COLLATE NOCASE on the index rather than
-- on the column so the stored value keeps the reader's own capitalisation
-- ("Insurance", not "insurance") while still rejecting a near-duplicate -- two chips
-- reading "Tax" and "tax" are indistinguishable at a glance.
CREATE UNIQUE INDEX idx_doc_categories_name ON doc_categories (name COLLATE NOCASE);

CREATE TRIGGER doc_categories_set_updated_at
AFTER UPDATE ON doc_categories
FOR EACH ROW
BEGIN
  UPDATE doc_categories SET updated_at = datetime('now') WHERE name = old.name;
END;

-- Managed tag list. Same shape and same reasoning as the categories above.
CREATE TABLE doc_tags (
  name                 TEXT PRIMARY KEY,
  description          TEXT NOT NULL DEFAULT '',
  icon_image           BLOB,
  icon_image_mime_type TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_doc_tags_name ON doc_tags (name COLLATE NOCASE);

CREATE TRIGGER doc_tags_set_updated_at
AFTER UPDATE ON doc_tags
FOR EACH ROW
BEGIN
  UPDATE doc_tags SET updated_at = datetime('now') WHERE name = old.name;
END;

-- Document <-> category pairings (many-to-many). No FK: the repository deletes a
-- document's pairings in the same transaction as the document. Same shape as
-- jrn_entry_categories and clp_clip_categories.
CREATE TABLE doc_document_categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id   INTEGER NOT NULL,
  category_name TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_doc_document_categories_unique
  ON doc_document_categories (document_id, category_name);
CREATE INDEX idx_doc_document_categories_document ON doc_document_categories (document_id);
CREATE INDEX idx_doc_document_categories_name ON doc_document_categories (category_name);

CREATE TABLE doc_document_tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  tag_name    TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_doc_document_tags_unique ON doc_document_tags (document_id, tag_name);
CREATE INDEX idx_doc_document_tags_document ON doc_document_tags (document_id);
CREATE INDEX idx_doc_document_tags_name ON doc_document_tags (tag_name);
