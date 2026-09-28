-- My Shortcuts: a per-person list of jump-off points on the home screen.
--
-- A shortcut is three things the reader supplies -- an icon, a name and a
-- destination -- and the destination comes in two flavours: an arbitrary URL, or
-- a place inside this app (a module, or one section within a module).
--
-- WHY `sys_` AND NOT A NEW PREFIX. `coding-guide.md` prescribes `sys_` for a
-- "Platform / cross-cutting" table. A home-screen widget is platform furniture:
-- it is owned by no feature module, it can point *at* any module, and it sits
-- beside the other home cards. This is the same call migration 0095
-- (sys_calculator_history) and 0096 (sys_scratchpad_notes) made for the floating
-- components, which are furniture in exactly the same sense. A `sho_` namespace
-- was considered and rejected on the rule a prefix must still fit the second
-- table: there is no second table coming, because a shortcut has no sub-entity.
--
-- PER-USER, AND THAT IS THE CENTRAL DECISION. `user_id` is mandatory and part of
-- every query's identity. A shortcut list is a personal workspace -- the pages
-- one person jumps to are not the pages anyone else does -- so this follows
-- `sys_scratchpad_notes` (private content) and NOT `sys_scratchpad_categories`
-- (shared structure an admin configures). There is deliberately no repository
-- method that reads a shortcut across users.
--
-- Note the asymmetry with the *widget* itself: whether the My Shortcuts card is
-- shown at all remains an app-wide admin setting (`home_widgets`, migration
-- 0067), because that is which cards exist. What goes *in* the card is personal.
-- Which cards exist vs. what they contain is the same line 0096 drew between
-- categories and notes.
--
-- No DB-level foreign keys, per project convention. `user_id` points at
-- sys_users.id and the repository maintains the link; a deleted user leaves rows
-- that nothing can read, since every read is scoped by the session's user id.
CREATE TABLE sys_user_shortcuts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id     INTEGER NOT NULL,              -- -> sys_users.id. The owner, always.

  -- 'url' or 'section'. A CHECK rather than a lookup table: this is a closed set
  -- of two that the code switches on exhaustively, not a list anyone extends at
  -- runtime. The constraint is what stops a typo'd kind becoming a row the
  -- renderer cannot draw.
  --
  -- 'section' covers BOTH a module root and a section inside it -- see
  -- section_id below. There is no third kind for "module", deliberately: both
  -- resolve through the same navigation tree and differ only in depth.
  kind        TEXT    NOT NULL CHECK (kind IN ('url', 'section')),

  -- What the tile reads. The reader's own wording, not derived from the target:
  -- a shortcut to the Journal's photo section might be called "Holiday pics",
  -- and re-deriving the label from the tree would overwrite that on every render.
  name        TEXT    NOT NULL,

  -- A glyph concept name from TREE_ICONS (e.g. 'rocket', 'map', 'chart'), chosen
  -- by the reader from a picker.
  --
  -- NOT an icon slot id, and this is worth being explicit about. A slot is a
  -- stable id for a FIXED position in the app, registered at build time in
  -- ICON_SLOTS; there is no way to register one per user-created row, and the
  -- ids must be static because they are persisted in ico_slot_overrides. A
  -- shortcut's glyph is user *data* -- the same kind of thing as the name beside
  -- it -- so it is stored as the concept name and rendered with TreeIcon.
  --
  -- An unrecognised concept (one retired from TREE_ICONS in a later release)
  -- falls back to a default glyph at render time rather than throwing, the same
  -- tolerance resolveHomeWidgets shows an unknown widget id.
  --
  -- ALWAYS SET, even when the reader has uploaded a picture: it is what the tile
  -- falls back to if the upload is later removed, so there is no state in which
  -- a shortcut has no icon at all. The upload columns arrive in 0115.
  icon        TEXT    NOT NULL DEFAULT 'rocket',

  -- kind='url' only; empty otherwise. Stored exactly as the reader typed it
  -- after the schema has normalised the protocol, and validated as http/https
  -- on the way in -- see the schema, which rejects javascript: and data: URLs.
  -- Not NULL-able, because "no URL" and "empty URL" are the same state here and
  -- two ways to spell one absence is a branch every reader would have to write.
  url         TEXT    NOT NULL DEFAULT '',

  -- kind='section' only; empty otherwise.
  --
  -- The TARGET IS STORED AS ITS COORDINATES, not as a resolved path, and that is
  -- the decision this pair of columns exists to make. An href like
  -- `/modules/journal/photos` would rot silently the day a route moves, leaving
  -- a tile that 404s with nothing to repair it from. A (module_slug, section_id)
  -- pair is re-resolved against the live navigation tree on every render, so a
  -- moved route follows automatically and a *deleted* one can be detected and
  -- reported instead of drawn.
  --
  -- It is also what makes the access re-check possible: a reader who loses
  -- access to a module must stop seeing their shortcut into it, and that
  -- question can only be asked of a slug, never of a path.
  --
  -- section_id EMPTY WITH A NON-EMPTY module_slug means the module root itself
  -- ("shortcut to Journal"), which is why there is no separate 'module' kind.
  module_slug TEXT    NOT NULL DEFAULT '',
  section_id  TEXT    NOT NULL DEFAULT '',

  -- Tile order within one person's card, left to right. An explicit column
  -- rather than sorting by name or id: the reader arranges these deliberately,
  -- and sorting by id would mean a newly added shortcut could never be anything
  -- but last. Gaps and ties are tolerated -- the read orders by
  -- (sort_order, id), so a tie falls back to insertion order rather than being
  -- arbitrary, exactly as sys_scratchpad_categories does.
  sort_order  INTEGER NOT NULL DEFAULT 0,

  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The card's only read: one person's shortcuts, in their chosen order. Covers
-- the cap's COUNT too, which filters on user_id alone.
CREATE INDEX idx_sys_user_shortcuts_owner
  ON sys_user_shortcuts (user_id, sort_order, id);

-- The usual updated_at stamp, so the writer cannot forget it. Guarded on the
-- column's own value so the reorder path -- which writes sort_order for several
-- rows at once -- does not recurse.
CREATE TRIGGER sys_user_shortcuts_set_updated_at
AFTER UPDATE ON sys_user_shortcuts
FOR EACH ROW
WHEN old.updated_at = new.updated_at
BEGIN
  UPDATE sys_user_shortcuts SET updated_at = datetime('now') WHERE id = old.id;
END;
