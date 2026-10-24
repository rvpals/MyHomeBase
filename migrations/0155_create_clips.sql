-- Clips: rich-text notes that stand on their own and can be referenced from
-- elsewhere in the app.
--
-- WHY THIS MODULE EXISTS. A journal entry sometimes needs supporting material --
-- the email it refers to, a quoted thread, a table someone sent. Pasting that into
-- the entry's own `content` would bury it: the entry is what the writer wrote, and
-- the email is evidence beside it. So a clip is a separate record with its own
-- taxonomy, its own screen, and a link back to whatever it supports.
--
-- WHY `clp_` AND NOT A NEW MEANING FOR `jrn_`. Clips are not a Journal feature.
-- The Journal is one of several things a clip can be attached to, and the module
-- is reachable, searchable and taggable on its own -- a clip with no link at all is
-- a normal clip. `coding-guide.md`'s rule applies: a prefix is a module namespace,
-- so Clips takes its own.
--
-- No DB-level foreign keys, per project convention -- the repository maintains the
-- links, and `deleteClip` removes a clip's taxonomy, images and links in one
-- transaction.

-- One clip. Shared: every reader granted the module sees every clip.
CREATE TABLE clp_clips (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Optional. An untitled clip is a normal thing to jot, and forcing a title would
  -- only produce a list of "Untitled" rows. Blank, never NULL, so no reader has to
  -- handle two kinds of nothing -- the same mapping `tol_todo_items.notes` uses.
  title           TEXT    NOT NULL DEFAULT '',

  -- The body, as **sanitized** HTML. Never raw paste input: `sanitizeClipHtml`
  -- reduces whatever arrived to an allowlist of elements and attributes before the
  -- repository ever sees it. See src/lib/clips/sanitize-html.ts for why that is an
  -- allowlist and not a strip-the-bad-parts pass.
  --
  -- Images do NOT live in here as base64 data URLs. They are extracted to
  -- clp_clip_images and referenced as /api/clips/images/<id>. That is the one
  -- lesson migration 0079 recorded when it dropped `jrn_entry_images`: inline
  -- base64 inflates the stored bytes by a third and lands every image in every
  -- read of the row.
  content_html    TEXT    NOT NULL DEFAULT '',

  -- Per-clip encryption, mirroring jrn_entries (migration 0131) exactly, including
  -- that the taxonomy below stays plaintext so a sealed clip still appears under
  -- its categories and tags.
  --
  -- ONE DIFFERENCE, AND IT MATTERS. A journal entry belongs to one person. A clip
  -- is shared, so the password is the only gate: anyone who has it can open the
  -- clip, and anyone who forgets it loses the clip *for everyone*. There is no
  -- recovery -- no admin override, no reset, no backdoor. The UI says so before
  -- sealing anything.
  is_encrypted    INTEGER NOT NULL DEFAULT 0,

  -- `v1:salt:iv:tag:ciphertext`, hex, written by @/lib/shared/encryption. Blank
  -- while the clip is open. Title and body are separate blobs under the same
  -- password, each with its own salt and IV -- never one key, two plaintexts, one IV.
  title_encrypted   TEXT NOT NULL DEFAULT '',
  content_encrypted TEXT NOT NULL DEFAULT '',

  -- Stored in the CLEAR, which is what makes it readable before decryption and also
  -- what makes it dangerous: it must never contain the password. The schema refuses
  -- the obvious case (the hint containing the password verbatim); it cannot catch a
  -- paraphrase, so the dialog says it in words too.
  password_hint   TEXT    NOT NULL DEFAULT '',

  -- Who wrote it, or NULL once that account is gone. Attribution for the household,
  -- never a permission check -- every clip is readable and editable by everyone
  -- granted the module, exactly as `tol_todo_items.created_by` is (migration 0123).
  -- Nothing filters on it.
  created_by      INTEGER,                          -- -> sys_users.id

  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The list's only ordering: most recently touched first. The id tiebreaker is not
-- optional -- two clips saved in the same second are ordinary, and without it tied
-- rows come back in an arbitrary order that appears to shuffle between renders.
CREATE INDEX idx_clp_clips_updated ON clp_clips (updated_at DESC, id DESC);

CREATE INDEX idx_clp_clips_is_encrypted ON clp_clips (is_encrypted);

CREATE TRIGGER clp_clips_set_updated_at
AFTER UPDATE ON clp_clips
FOR EACH ROW
BEGIN
  UPDATE clp_clips SET updated_at = datetime('now') WHERE id = old.id;
END;

-- Managed category list. Keyed by name, the same natural-key precedent as
-- jrn_categories: the pairing tables reference the name, not a surrogate id.
--
-- Categories and tags are two lists on purpose, mirroring the Journal. A category
-- says what KIND of thing the clip is (Correspondence, Receipt, Reference); a tag
-- says what it is ABOUT. modules.md records the same distinction for the Journal's
-- entry taxonomy and again for saved locations.
CREATE TABLE clp_categories (
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

-- One category per name, case-insensitively. COLLATE NOCASE on the index rather
-- than on the column so the stored value keeps the reader's own capitalisation
-- ("Receipts", not "receipts") while still rejecting a near-duplicate -- two chips
-- reading "Work" and "work" are indistinguishable at a glance.
CREATE UNIQUE INDEX idx_clp_categories_name ON clp_categories (name COLLATE NOCASE);

CREATE TRIGGER clp_categories_set_updated_at
AFTER UPDATE ON clp_categories
FOR EACH ROW
BEGIN
  UPDATE clp_categories SET updated_at = datetime('now') WHERE name = old.name;
END;

-- Managed tag list. Same shape and same reasoning as the categories above.
CREATE TABLE clp_tags (
  name                 TEXT PRIMARY KEY,
  description          TEXT NOT NULL DEFAULT '',
  icon_image           BLOB,
  icon_image_mime_type TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_clp_tags_name ON clp_tags (name COLLATE NOCASE);

CREATE TRIGGER clp_tags_set_updated_at
AFTER UPDATE ON clp_tags
FOR EACH ROW
BEGIN
  UPDATE clp_tags SET updated_at = datetime('now') WHERE name = old.name;
END;

-- Clip <-> category pairings (many-to-many). No FK: the repository deletes a
-- clip's pairings in the same transaction as the clip. Same shape as
-- jrn_entry_categories.
CREATE TABLE clp_clip_categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id       INTEGER NOT NULL,
  category_name TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_clp_clip_categories_unique
  ON clp_clip_categories (clip_id, category_name);
CREATE INDEX idx_clp_clip_categories_clip ON clp_clip_categories (clip_id);
CREATE INDEX idx_clp_clip_categories_name ON clp_clip_categories (category_name);

CREATE TABLE clp_clip_tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id    INTEGER NOT NULL,
  tag_name   TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_clp_clip_tags_unique ON clp_clip_tags (clip_id, tag_name);
CREATE INDEX idx_clp_clip_tags_clip ON clp_clip_tags (clip_id);
CREATE INDEX idx_clp_clip_tags_name ON clp_clip_tags (tag_name);

-- An image pasted into a clip.
--
-- Bytes in a BLOB, served by /api/clips/images/[id] -- never a base64 data URL
-- inside content_html. See the note on clp_clips.content_html, and migration 0079,
-- which dropped jrn_entry_images for doing exactly that.
CREATE TABLE clp_clip_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id    INTEGER NOT NULL,

  image_data BLOB    NOT NULL,
  mime_type  TEXT    NOT NULL,

  -- Stored so the editor can reserve the right space before the bytes arrive, and
  -- so a clip's size is answerable without reading any image. Recorded AFTER the
  -- resize, so they describe what is actually stored rather than what was pasted.
  width      INTEGER NOT NULL DEFAULT 0,
  height     INTEGER NOT NULL DEFAULT 0,
  byte_size  INTEGER NOT NULL DEFAULT 0,

  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_clp_clip_images_clip ON clp_clip_images (clip_id, sort_order, id);

-- A clip attached to a record in another module.
--
-- WHY A LINK TABLE AND NOT A COLUMN ON THE TARGET. Putting `clip_id` on
-- jrn_entries would drag in the recycle-bin mirror (jrn_recycled_entries copies
-- columns by name, and migration 0089 records that a column missing from the
-- mirror is silently dropped on the way back in), the encryption columns, and the
-- ~16 action files that name the journal slug. A separate table keeps the whole
-- feature inside this module and lets one clip support several entries -- which is
-- the real case: one email thread can bear on two days' entries.
--
-- WHY THE DIRECTION IS ONE-WAY. A clip knows what it is attached to; the Journal
-- does not know clips exist. src/lib/journal therefore has no dependency on
-- src/lib/clips, which would otherwise be the import cycle ARCHITECTURE.md
-- forbids. The journal's badge is composed in the presentation layer, which may
-- read both modules.
--
-- WHY `target_module` IS AN ENUM IN CODE AND A PLAIN TEXT COLUMN HERE. The same
-- choice migration 0142 made for sys_messages.module: the set of linkable modules
-- is validated by zod at the boundary, not by a lookup against sys_modules. An
-- unknown value fails loudly at the edge instead of being stored and discovered
-- later by a join that returns nothing. `journal` is the only member today.
--
-- WHAT HAPPENS WHEN THE TARGET GOES. Nothing, to the clip. A clip exists
-- independently and is only *referenced* -- deleting a journal entry must never
-- delete the supporting email someone pasted. Restoring a recycled entry normally
-- reconnects the link by itself, because restoreRecycledEntries reinserts at the
-- ORIGINAL id specifically so existing references keep working; only when that id
-- has been taken does it fall back to a fresh one, and then the link is left
-- pointing at nothing. The viewer renders that as "the linked record is gone",
-- which is a normal state here and not an error.
CREATE TABLE clp_clip_links (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id       INTEGER NOT NULL,

  target_module TEXT    NOT NULL,                   -- 'journal'
  target_id     INTEGER NOT NULL,                   -- -> jrn_entries.id

  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Makes "attach" idempotent: INSERT OR IGNORE turns a repeat press into a no-op
-- rather than a second row or an error in the reader's face.
CREATE UNIQUE INDEX idx_clp_clip_links_unique
  ON clp_clip_links (clip_id, target_module, target_id);

-- The journal's read: "how many clips are on these entries", one query for a whole
-- page of entries. target_module leads because every read filters on it first.
CREATE INDEX idx_clp_clip_links_target ON clp_clip_links (target_module, target_id);

CREATE INDEX idx_clp_clip_links_clip ON clp_clip_links (clip_id);
