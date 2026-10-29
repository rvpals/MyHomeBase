-- A recycle bin for clips.
--
-- Deleting a clip from the Home screen now MOVES it here instead of destroying
-- it. The Recycled Clips section restores one, purges one, or empties the bin.
-- Only the bin's own purge, and the CLI's `clips delete --forever`, actually
-- remove a clip's bytes.
--
-- WHY MIRROR TABLES AND NOT A `deleted_at` FLAG ON clp_clips.
--
-- A flag is the smaller migration and the worse design here. Every existing read
-- in this module -- the list, the board, the filter chips, the journal's link
-- count, the taxonomy usage counts, `idx_clp_clips_pinned_updated` -- would have
-- to learn to exclude binned rows, and ONE missed WHERE silently serves a
-- deleted clip as though nothing happened. A separate table cannot be read by
-- accident: code that does not name it cannot see a binned clip. That is the
-- same reasoning migration 0079 recorded for jrn_recycled_entries, and this bin
-- is deliberately built to the same pattern so a reader who knows one knows both.
--
-- WHY ALL SIX TABLES.
--
-- A clip is NOT one row. Its categories, tags, images, checklist items and links
-- live in five child tables. A bin that copied only clp_clips would restore a
-- clip stripped of its taxonomy, its pasted screenshots and its checklist --
-- silent data loss wearing a safety feature's clothes, which is exactly what
-- migration 0079 says about the journal. So every table a clip owns gets a mirror
-- with the same columns.

-- ---------------------------------------------------------------------------
-- 1. The binned clip
-- ---------------------------------------------------------------------------
--
-- Mirrors clp_clips column for column, with two additions:
--
--   * `id` is this table's own surrogate key, because the same original clip can
--     be recycled, restored, and recycled again.
--   * `clip_id` remembers the id the clip had in clp_clips. Restore aims to put
--     it back at that id, which is what keeps an existing clp_clip_links row --
--     and the journal badge it draws -- working across a delete and a restore.
--     If something else has taken the id meanwhile, the restore takes a fresh one
--     instead (see recycle.ts).
--   * `deleted_at` is when it went into the bin -- the sort order of the list.
--
-- The encryption columns travel with the clip. Leaving them out would bin the
-- blanked title and content and drop the ciphertext, so a restored clip would be
-- unreadable forever with nothing to say why -- the gap migration 0131 closed for
-- the journal's bin after the fact. A sealed clip is binned sealed and comes back
-- sealed, still needing its password; the bin is not a way around the password.
--
-- is_pinned and card_color are carried for the same reason is_locked is in the
-- journal's bin: they are things a person deliberately set, and a restore that
-- quietly dropped them would undo that work.
CREATE TABLE clp_recycled_clips (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id           INTEGER NOT NULL,               -- the id it had in clp_clips

  title             TEXT    NOT NULL DEFAULT '',
  content_html      TEXT    NOT NULL DEFAULT '',

  is_encrypted      INTEGER NOT NULL DEFAULT 0,
  title_encrypted   TEXT    NOT NULL DEFAULT '',
  content_encrypted TEXT    NOT NULL DEFAULT '',
  password_hint     TEXT    NOT NULL DEFAULT '',

  is_pinned         INTEGER NOT NULL DEFAULT 0,
  card_color        TEXT    NOT NULL DEFAULT '',

  created_by        INTEGER,                        -- -> sys_users.id

  -- The original timestamps, preserved. A restored clip should claim the date it
  -- was written, not the date it came out of the bin.
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,

  deleted_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The list is "newest deleted first", which is what this index serves. The id
-- tiebreaker is not optional: emptying a filter's worth of clips stamps one
-- second on every row, and without it tied rows shuffle between renders.
CREATE INDEX idx_clp_recycled_clips_deleted ON clp_recycled_clips (deleted_at DESC, id DESC);
CREATE INDEX idx_clp_recycled_clips_clip    ON clp_recycled_clips (clip_id);

-- No updated_at trigger, unlike clp_clips. A row in the bin is immutable: it is
-- inserted on delete and removed on restore or purge, never edited. A trigger
-- here would overwrite the original updated_at the restore depends on -- the same
-- note migration 0079 leaves on jrn_recycled_entries.

-- ---------------------------------------------------------------------------
-- 2. The children
-- ---------------------------------------------------------------------------
--
-- Every child points at clp_recycled_clips.id, NOT at the original clip id -- the
-- bin is self-contained, so a purge only has to follow this one key, and a clip
-- recycled twice cannot have its two copies' children run together. No DB-level
-- foreign keys, same as the rest of the module: the repository deletes children
-- in the same transaction as the parent.

CREATE TABLE clp_recycled_clip_categories (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  recycled_clip_id INTEGER NOT NULL,
  category_name    TEXT    NOT NULL,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_clp_recycled_clip_categories_parent
  ON clp_recycled_clip_categories (recycled_clip_id);

CREATE TABLE clp_recycled_clip_tags (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  recycled_clip_id INTEGER NOT NULL,
  tag_name         TEXT    NOT NULL,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_clp_recycled_clip_tags_parent
  ON clp_recycled_clip_tags (recycled_clip_id);

-- The images, BYTES AND ALL.
--
-- This is the one expensive decision in this migration, so it is written down.
-- Copying the BLOBs doubles a clip's stored bytes for as long as it sits in the
-- bin. The cheaper alternative -- leaving the rows in clp_clip_images, orphaned,
-- pointing at a clip that no longer exists -- was rejected because
-- /api/clips/images/[id] serves by image id alone: a deleted clip's screenshots
-- would stay live at a guessable URL, and "delete" would not have deleted the
-- thing most worth deleting. Bytes are cheap; a delete that does not delete is
-- not. Purging the bin reclaims the space.
CREATE TABLE clp_recycled_clip_images (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  recycled_clip_id INTEGER NOT NULL,

  image_data       BLOB    NOT NULL,
  mime_type        TEXT    NOT NULL,

  width            INTEGER NOT NULL DEFAULT 0,
  height           INTEGER NOT NULL DEFAULT 0,
  byte_size        INTEGER NOT NULL DEFAULT 0,

  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_clp_recycled_clip_images_parent
  ON clp_recycled_clip_images (recycled_clip_id, sort_order, id);

-- The checklist. done_at is carried across so a restored clip remembers WHEN each
-- line was ticked, not merely that it was -- the board orders the completed half
-- by that timestamp (src/lib/clips/board.ts), so dropping it would reshuffle a
-- restored clip's list for no reason the reader can see.
CREATE TABLE clp_recycled_clip_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  recycled_clip_id INTEGER NOT NULL,

  text             TEXT    NOT NULL,
  is_done          INTEGER NOT NULL DEFAULT 0,
  done_at          TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,

  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_clp_recycled_clip_items_parent
  ON clp_recycled_clip_items (recycled_clip_id, sort_order, id);

-- The links to other modules' records.
--
-- Binned with the clip rather than dropped, and restored as they were. A link
-- whose target has since gone is a normal state in this module, not an error --
-- clp_clip_links already says so at length, and the viewer renders it as "the
-- linked record is gone". Dropping links here would mean a clip came back
-- detached from the entry it was filed against, which is a worse answer than a
-- link the reader can see is stale.
CREATE TABLE clp_recycled_clip_links (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  recycled_clip_id INTEGER NOT NULL,

  target_module    TEXT    NOT NULL,                -- 'journal'
  target_id        INTEGER NOT NULL,

  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_clp_recycled_clip_links_parent
  ON clp_recycled_clip_links (recycled_clip_id);
