# 0185 — Server-side thumbnail resizing becomes a switch

One row in `sys_app_settings`: `photo_thumbnail_resize`, defaulting to `'true'`.

An **app** setting, not a module setting. The thumbnail route is reached from the
Journal, from Picture Gallery's Albums/Favorites/Magic screens and from the Random
Photo card, so hanging the switch off one module would leave the others reading a
setting that belongs to something else. Same reasoning as the system log's keys in
`0168` and the backup's in `0134`.

## What it actually gates — narrower than the name suggests

`readPhotoThumbnail` tries three sources in order:

1. the camera's embedded EXIF preview (a 128KB partial read, no decode),
2. the original, shrunk by `sharp` (a full read, behind the shared gate),
3. the original as-is, when image processing is unavailable.

**This switch controls only step 2.** Step 1 is always used when a preview exists,
because it is the thing that makes the strip quick: measured on the NAS at **8.7x
to 13.3x faster** than shrinking the original, for an output within 4% of the same
size. Turning that off would be turning off the feature.

So in practice the switch only affects photos carrying **no embedded preview** —
about **2 in 700** in this household's archive (a scan, a screenshot, or a file
whose metadata was stripped). With it off, those tiles fall back to step 3, which
is exactly what the strip served before 2026-11-17.

## Why it defaults to on

Resizing is what currently ships, and the measurements support it: `sharp` 0.35.5
/ libvips 8.18.7 on linux arm64, a 160px resize of a 3.35MB photo in 135ms and of
a 7.25MB one in 168ms.

The switch is an **escape hatch, not a feature flag waiting to be enabled** — it is
there so an administrator can turn resizing off without a deploy if the NAS
struggles, or if the native module breaks on an upgrade. `sharp` failing already
degrades to step 3 on its own; this makes that choice deliberate rather than
accidental.

## Conventions

- `'true'`/`'false'` spelled out, matching `system_log_debug` (`0168`) and
  `hello_world_enabled` (`0136`), not the `'1'`/`'0'` the Document Library's
  **module** settings use. Both conventions exist in this database; app settings
  use this one.
- `ON CONFLICT(key) DO NOTHING`, so re-running is safe and an administrator who
  has already turned it off does not get it switched back on.
- The seed is strictly optional — `SqliteSettingsRepository` upserts, and
  `resolvePhotoThumbnailSettings` treats a missing or unparseable row as **on**.
  It is here for the `description` column, which the upsert leaves alone and which
  is the only record inside the database of what the key means.
- The key is listed in `src/lib/settings/defaults.ts` as well, so **Reset to
  Default** restores the switch rather than dropping the row entirely. Same reason
  as the backup keys.

**The key name is permanent.** It is a primary key in `sys_app_settings`; renaming
it orphans an administrator's stored choice. Same rule as the icon slot ids.

## Where it is edited

Administration → Configuration → Application Configuration, below the system log's
switches.
