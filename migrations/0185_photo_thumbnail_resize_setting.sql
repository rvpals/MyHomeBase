-- The switch for resizing a photo on the server to make a strip thumbnail.
--
-- The thumbnail route itself (2026-11-17) needed no migration -- nothing is stored,
-- every request builds its answer in memory. This is the first row it has ever
-- needed, and it makes the expensive half of that route optional.
--
-- An app setting rather than a module setting: the thumbnail route is reached
-- from the Journal, from Picture Gallery and from the Random Photo card, so
-- hanging the switch off one module would leave the others reading a setting that
-- belongs to something else. Same reasoning as the system log's keys in 0168 and
-- the backup's in 0134.
--
-- WHAT IT ACTUALLY GATES, which is narrower than its name suggests. The route
-- tries three sources in order: the camera's embedded EXIF preview, then the
-- original shrunk by sharp, then the original as-is. This switch controls only the
-- MIDDLE one. The embedded preview is always used when there is one -- it is a
-- 128KB partial read with no decode, measured at 8.7x to 13.3x faster than
-- shrinking the original for an output within 4% of the same size -- and turning
-- that off would be turning off the thing that makes the strip quick.
--
-- So in practice this only affects photos that carry NO embedded preview. In this
-- household's archive that is about 2 in 700: a scan, a screenshot, or an edited
-- file whose metadata was stripped. With the switch off, those tiles fall back to
-- the original as-is, which is exactly what the strip served before 2026-11-17.
--
-- WHY IT DEFAULTS TO ON. Resizing is what currently ships, and the measurements
-- on the NAS support it (sharp 0.35.5 / libvips 8.18.7 on linux arm64; a 1024px
-- resize of a 3.35MB photo in 290ms, a 160px one in 135ms). The switch exists so
-- an administrator can turn it OFF if the NAS struggles -- a failing or
-- newly-broken native module, or a CPU busy with something else -- without a
-- deploy. It is an escape hatch, not a feature flag waiting to be enabled.
--
-- 'true'/'false' spelled out, matching `system_log_debug` (0168) and
-- `hello_world_enabled` (0136) rather than the '1'/'0' the Document Library's
-- module settings use. Both conventions exist in this database; app settings use
-- this one.
--
-- Strictly this seed is optional: `SqliteSettingsRepository` upserts, so a write
-- works against a key that was never stored, and `resolvePhotoThumbnailSettings`
-- treats a missing row as ON. It is here for the `description` column, which the
-- upsert leaves alone and which is the only record inside the database of what the
-- key means.
--
-- WHERE IT IS EDITED: Administration -> Configuration -> Application
-- Configuration, below the system log's switches.

INSERT INTO sys_app_settings (key, value, description) VALUES
  ('photo_thumbnail_resize', 'true',
   'Whether the server shrinks a photo with sharp to make a strip thumbnail. Only affects photos with no embedded EXIF preview (about 2 in 700); with it off those fall back to the original as-is. The embedded preview is always used when present.')
ON CONFLICT(key) DO NOTHING;
