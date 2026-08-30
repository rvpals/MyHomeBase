-- Color themes as DATA rather than code. See migrations/0076_create_color_themes.md.
--
-- Before this table, COLOR_THEMES in src/lib/settings/themes.ts was the only source of
-- themes, and `sys_app_settings.color_theme` held the id of whichever one was picked.
-- The array stays, but only as the RESET BASELINE for the eight built-ins seeded below —
-- theme resolution reads this table.

CREATE TABLE sys_color_themes (
  -- A slug, and the value that lands in `sys_app_settings.color_theme`. Deliberately not
  -- an autoincrement id: the setting already stores ids like 'signal-deck', and every
  -- install that ever picked a theme has one of those strings in it. A numeric key would
  -- orphan that value on the first migration.
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',

  -- The nine token slots, one column each, matching ColorThemeTokens field for field.
  -- Spelled out rather than a single JSON blob so a bad theme is unrepresentable: the
  -- CHECKs below reject anything that is not a 6-digit hex color, which a JSON text
  -- column could not do. It also means SQL can read one token without parsing.
  paper         TEXT NOT NULL CHECK (paper         GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  paper_raised  TEXT NOT NULL CHECK (paper_raised  GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  ink           TEXT NOT NULL CHECK (ink           GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  line          TEXT NOT NULL CHECK (line          GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  muted         TEXT NOT NULL CHECK (muted         GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  muted_inverse TEXT NOT NULL CHECK (muted_inverse GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  brass         TEXT NOT NULL CHECK (brass         GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  brass_dark    TEXT NOT NULL CHECK (brass_dark    GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  brass_soft    TEXT NOT NULL CHECK (brass_soft    GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),

  -- One of the seven FontKey values in src/lib/settings/themes.ts. Not a foreign key for
  -- the same reason ico_slot_overrides.slot_id is not one: the font registry is code, not
  -- data, because each face has to be loaded by a next/font/google call in
  -- src/app/layout.tsx. A row naming a font nothing loads would render as the fallback,
  -- so the use-case layer checks membership on write.
  font_display  TEXT NOT NULL,
  font_body     TEXT NOT NULL,
  font_mono     TEXT NOT NULL,

  -- 1 for the eight themes seeded below. Two consequences, both enforced in the
  -- use-cases rather than here: a built-in cannot be deleted, and a built-in can be
  -- RESET to its code definition in themes.ts. Editing one is an ordinary UPDATE —
  -- built-in means "has a definition to fall back to", not "read-only".
  is_builtin    INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),

  -- Display order on the picker. The built-ins keep the order they had in the array;
  -- user themes default to 100 and therefore sort after them, then by name.
  sort_order    INTEGER NOT NULL DEFAULT 100,

  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER color_themes_set_updated_at
AFTER UPDATE ON sys_color_themes
FOR EACH ROW
BEGIN
  UPDATE sys_color_themes SET updated_at = datetime('now') WHERE id = old.id;
END;

-- The eight built-ins, copied verbatim from COLOR_THEMES as of this migration.
INSERT INTO sys_color_themes
  (id, name, description, paper, paper_raised, ink, line, muted, muted_inverse,
   brass, brass_dark, brass_soft, font_display, font_body, font_mono, is_builtin, sort_order)
VALUES
  ('signal-deck', 'Signal Deck', 'Graphite console with a teal signal accent.',
   '#12161A', '#1A1F26', '#EEF2F3', '#2B323B', '#8B96A1', '#5B6470',
   '#33E2B8', '#1C8A71', '#15332D', 'space-grotesk', 'manrope', 'jetbrains-mono', 1, 10),
  ('ember-ledger', 'Ember Ledger', 'Ink navy with a warm amber accent.',
   '#11131B', '#171A25', '#F4EEE3', '#2A2D3D', '#9992A3', '#655F70',
   '#E79355', '#A35C2B', '#3A2A1C', 'sora', 'manrope', 'ibm-plex-mono', 1, 20),
  ('aurora-deck', 'Aurora Deck', 'Near-black with a violet and cyan duo-tone accent.',
   '#0D0E14', '#15171F', '#F5F6FA', '#262A38', '#8A8EA3', '#4D5166',
   '#7C5CFF', '#29B6E0', '#1C2036', 'familjen-grotesk', 'inter', 'jetbrains-mono', 1, 30),
  ('bms', 'BMS', 'Bristol Myers Squibb brand purple on charcoal gray.',
   '#1A1818', '#221F1F', '#F2F0F0', '#3A3636', '#9B9494', '#6B6565',
   '#BE2BBB', '#7D1B7A', '#2A172A', 'sora', 'manrope', 'ibm-plex-mono', 1, 40),
  ('daybreak', 'Daybreak', 'Warm daylight paper with a rose signal accent.',
   '#F4F1F2', '#FFFFFF', '#232830', '#E7E2E4', '#6B7280', '#9AA1AC',
   '#F43F5E', '#C21E48', '#FCE4EA', 'space-grotesk', 'manrope', 'jetbrains-mono', 1, 50),
  ('sea-glass', 'Sea Glass', 'Cool off-white paper with a deep teal accent.',
   '#F5F7F6', '#FFFFFF', '#17262B', '#D6DEDC', '#5F7377', '#93A5A8',
   '#0F766E', '#0B534E', '#D3E9E5', 'familjen-grotesk', 'inter', 'ibm-plex-mono', 1, 60),
  ('midnight-slate', 'Midnight Slate', 'Deep blue-slate console with a cool ice-blue accent.',
   '#0F141C', '#171E28', '#E8EEF5', '#28303D', '#8794A5', '#5A6675',
   '#5AB3F0', '#2E7DB4', '#12293B', 'sora', 'inter', 'jetbrains-mono', 1, 70),
  ('copper-vault', 'Copper Vault', 'Near-black ledger with a polished copper accent.',
   '#14100E', '#1D1815', '#F2EBE4', '#33291F', '#9C8B7C', '#6B5D51',
   '#C87F4A', '#9A5B2E', '#33210F', 'space-grotesk', 'manrope', 'ibm-plex-mono', 1, 80);

-- Fixes a five-year-old lie. Migration 0004 seeded `color_theme = 'brass'`, an id that no
-- theme has ever had since the themes were renamed; `getColorTheme` quietly returned
-- COLOR_THEMES[0] for it. That fallback still exists, but leaving the bad value here
-- would now mean the picker highlights nothing and the built-in reset has no target.
UPDATE sys_app_settings
   SET value = 'signal-deck'
 WHERE key = 'color_theme'
   AND value NOT IN (SELECT id FROM sys_color_themes);
