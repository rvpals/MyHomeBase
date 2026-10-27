-- Clips become a board: pinned clips, a card colour, and tickable checklist items.
--
-- WHAT THIS ADDS AND WHY IT IS ONE MIGRATION. Three changes that only make sense
-- together -- a board that could not pin, could not colour, and could not hold a
-- checklist would be the list it already is, drawn in columns. They share one
-- migration because they ship as one screen; splitting them would leave two of the
-- three as dead columns nothing reads.
--
-- WHAT IS DELIBERATELY NOT HERE. The card's excerpt length is a *preference*, not a
-- column: it lives in `sys_module_settings` under the Clips module, the same
-- key/value storage the Journal's `photo_root` and Household's `hsa_receipt_root`
-- use. Adding a settings row needs no migration, which is the whole point of that
-- table -- see src/lib/clips/settings.ts.

-- ---------------------------------------------------------------------------
-- 1. Pinning
-- ---------------------------------------------------------------------------
--
-- WHY A COLUMN AND NOT A SEPARATE TABLE. A pin is a property of the clip, not a
-- relationship: it is shared exactly as the clip is (migration 0155 records that
-- every reader granted the module sees every clip), so there is no per-user pin to
-- key a second table by. One integer on the row is the whole feature.
--
-- WHY STORED POSITIVE AND DEFAULTED OFF. `is_pinned` follows the convention
-- migration 0154 spelled out for `is_enabled`: every flag in this database is stored
-- positive. The default differs because the sensible resting state differs -- a quote
-- is in rotation until taken out, whereas a clip is ordinary until someone pins it.
-- DEFAULT 0 is already right for every existing row, so this migration needs no
-- backfill and no UPDATE: a household upgrading sees the list exactly as it was.
ALTER TABLE clp_clips ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2. Card colour
-- ---------------------------------------------------------------------------
--
-- WHY THIS STORES A KEY AND NEVER A HEX. `design.md` forbids a literal colour
-- anywhere structural, because all nine theme tokens are swappable at runtime
-- (Admin -> Configuration -> Color Themes) and there are eight shipped themes, two of
-- them light. A stored `#fecaca` would be a pink card in every one of them --
-- unreadable on Daybreak, wrong against every accent. A stored `'rose'` is resolved
-- to a tint built from the current theme's own tokens, so a coloured card recolours
-- with the rest of the app instead of fighting it.
--
-- THE KEYS ARE PERMANENT, like an icon slot id. They are written into this column on
-- every coloured clip, so renaming one silently blanks those cards back to the
-- default. The seven are fixed in src/lib/clips/schema.ts (CLIP_CARD_COLORS) and
-- validated by zod at the boundary -- the same choice migration 0142 made for
-- sys_messages.module and 0155 made for clp_clip_links.target_module: an unknown
-- value fails loudly at the edge instead of being stored and found later by a reader
-- that cannot draw it.
--
-- WHY '' AND NOT NULL for "no colour chosen". Blank, never NULL, so no reader has to
-- handle two kinds of nothing -- the mapping clp_clips.title already uses and that
-- migration 0155 names explicitly.
ALTER TABLE clp_clips ADD COLUMN card_color TEXT NOT NULL DEFAULT '';

-- The board's ordering: pinned clips first, then most recently touched. The id
-- tiebreaker is not optional, for the reason idx_clp_clips_updated already records --
-- two clips saved in the same second are ordinary, and without it tied rows come back
-- in an arbitrary order that appears to shuffle between renders.
--
-- This index REPLACES idx_clp_clips_updated as the list's covering index rather than
-- sitting beside it: a leading `is_pinned DESC` still serves an unpinned-first read,
-- and keeping both would mean two indexes maintained on every write for one query.
-- The old one is dropped below.
CREATE INDEX idx_clp_clips_pinned_updated
  ON clp_clips (is_pinned DESC, updated_at DESC, id DESC);

DROP INDEX IF EXISTS idx_clp_clips_updated;

-- ---------------------------------------------------------------------------
-- 3. Checklist items
-- ---------------------------------------------------------------------------
--
-- WHY A TABLE AND NOT CHECKBOXES IN content_html. This is the load-bearing decision
-- in this migration, so it is written down rather than left to be rediscovered.
--
-- A clip's body is sanitized HTML (src/lib/clips/sanitize-html.ts), and that
-- sanitizer removes `<input>` *with its contents* and refuses `style` outright. Both
-- are deliberate: a clip body is pasted email, and a working form inside this app's
-- own origin is worse than one in a mail client. Storing checklists as checkbox
-- markup would mean punching a hole in the one security control this module has, and
-- failing closed is exactly what makes that allowlist defensible.
--
-- It would also be wrong mechanically. Ticking a box would have to rewrite the entire
-- content_html column -- a pasted email, hundreds of kilobytes -- on every click, and
-- re-run the sanitizer over it each time, with the tick surviving only if the
-- round trip happened to preserve it.
--
-- So an item is a row, a tick is one UPDATE, and the body stays prose. A clip has
-- both: the card draws the body and then the items.
--
-- SHAPE MIRRORS tol_todo_items (migration 0123) on purpose -- same columns, same
-- meanings, same `done_at` nullability -- because it is the same idea and a reader who
-- knows one should not have to learn the other. No FK, per project convention: the
-- cascade is maintained by the repository, which already deletes a clip's taxonomy,
-- images and links in one transaction and now deletes its items there too.
CREATE TABLE clp_clip_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id    INTEGER NOT NULL,

  -- What the line says. Never blank -- an item with no text is not an item, which the
  -- zod schema enforces at the boundary rather than a CHECK here, matching how every
  -- other text field in this module is validated.
  text       TEXT    NOT NULL,

  -- Ticking does not delete. The completed half of the list stays visible, collapsed,
  -- exactly as the TODO module's board renders it.
  is_done    INTEGER NOT NULL DEFAULT 0,

  -- ISO 8601 when it was ticked, or NULL while outstanding. The one nullable column
  -- here, and nullable for a reason migration 0123 already gave for tol_todo_items:
  -- "not completed" genuinely has no timestamp, where a sentinel date would read as a
  -- real completion. Cleared again when an item is un-ticked.
  done_at    TEXT,

  -- Position among the items, as arranged by whoever wrote the clip. Ignored for the
  -- completed half, which the board orders by most recently ticked instead -- that
  -- split is a domain rule and lives in src/lib/clips/board.ts, not in a view.
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Every read of this table is "the items on this clip, in order". One index serves it
-- whole; the id tiebreaker keeps equal sort_orders stable between renders for the same
-- reason the clips list needs one.
CREATE INDEX idx_clp_clip_items_clip ON clp_clip_items (clip_id, sort_order, id);
