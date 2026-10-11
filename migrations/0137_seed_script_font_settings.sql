-- The two decorative script faces (Administration -> Display Settings -> Script Fonts).
--
-- App settings rather than module settings. The Journal's handwriting FACE is here
-- even though the Journal's handwriting SIZE lives in that module's own settings,
-- and the split is deliberate: the size is a reading-comfort choice about one
-- field, while the face is an appearance choice for the whole application, sitting
-- beside the color theme, the icon set and the chrome style. Same reasoning as 0134
-- and 0136 -- `sys_app_settings` is the app-wide key/value store (migrations/0002).
--
-- Strictly speaking this seed is optional -- `SqliteSettingsRepository.updateAll`
-- upserts, so saving works against keys that have never been stored, and
-- `resolveScriptFont` falls back to Great Vibes for a missing row. It is here for
-- the `description` column, which the upsert deliberately leaves alone and which is
-- the only in-database record of what each key means.
--
-- WHY TWO ROWS AND NOT ONE. Until this shipped, both surfaces read the single
-- `--font-script` token, so they were necessarily the same face. They are different
-- kinds of writing: the Daily Quote is a proclamation you glance at, the Journal
-- sheet is your own hand over a paragraph. Splitting the token lets a reader keep
-- formal copperplate on the quote while writing the journal in something that
-- survives being read at length.
--
-- BOTH DEFAULT TO GREAT VIBES, which is what both surfaces wore before either was
-- configurable -- so an install that upgrades into this picker looks exactly as it
-- did before anybody opens the screen. The ids are permanent: they are resolved to a
-- CSS variable in src/app/layout.tsx via the catalogue in
-- src/lib/settings/script-fonts.ts, and renaming one drops the choice on every
-- install that had picked it.

INSERT INTO sys_app_settings (key, value, description) VALUES
  ('daily_quote_font', 'great-vibes',
   'The script face the Daily Quote card on the home screen is written in. One of the ids in src/lib/settings/script-fonts.ts.'),
  ('journal_handwriting_font', 'great-vibes',
   'The script face the Journal entry form uses when Handwriting is switched on. One of the ids in src/lib/settings/script-fonts.ts.')
ON CONFLICT(key) DO NOTHING;
