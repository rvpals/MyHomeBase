-- Per-slot icon overrides: a user-supplied glyph for one named place in the app,
-- under one icon set. See migrations/0066_create_icon_slot_overrides.md.
--
-- No seed rows. "No override" is the default state, and a slot with no row here
-- renders exactly what it rendered before this table existed — the active icon
-- set's glyph for the slot's default concept.

CREATE TABLE ico_slot_overrides (
  -- An id from ICON_SLOTS in src/lib/icons/slots.ts. Deliberately NOT a foreign key:
  -- the slot registry is code, not data, so there is no table to point at. The
  -- use-case layer checks membership on write, and reads drop rows whose slot has
  -- left the registry.
  slot_id    TEXT NOT NULL,
  -- Which icon set this override belongs to (ICON_SETS in src/lib/settings/icon-sets.ts).
  -- Part of the key so a glyph drawn for one set's style does not leak into the other
  -- twelve.
  set_id     TEXT NOT NULL,

  -- Sanitized INNER svg markup — no outer <svg>, no script, no external refs. Stored as
  -- text rather than bytes because it is inlined into the page, which is what lets a
  -- custom glyph inherit currentColor and tint to the theme accent.
  svg_body   TEXT,
  svg_w      REAL,
  svg_h      REAL,

  -- The raster alternative, served by src/app/api/icons/slots/[slot]/route.ts. Cannot
  -- tint; the UI drops the accent tile for these the same way it does for a colourful set.
  image_data BLOB,
  image_mime TEXT,

  -- Cache-buster for the serving route's ?v= parameter.
  updated_at TEXT NOT NULL,

  PRIMARY KEY (slot_id, set_id),

  -- Exactly one payload. A row carrying both would be ambiguous to render, and a row
  -- carrying neither is just a slower way of saying "no override" — delete it instead.
  CHECK (
    (svg_body IS NOT NULL AND image_data IS NULL AND image_mime IS NULL)
    OR
    (svg_body IS NULL AND svg_w IS NULL AND svg_h IS NULL
     AND image_data IS NOT NULL AND image_mime IS NOT NULL)
  )
);

-- No secondary index. Every read is either the full set (`WHERE set_id = ?`, which the
-- primary key's leading column does not serve, but the table holds one row per
-- overridden slot — tens at most, so a scan is cheaper than an index to maintain) or an
-- exact `(slot_id, set_id)` lookup the primary key already covers.
