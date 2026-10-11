# Migration 0134: Data backup settings

**Date:** 2026-10-09
**Type:** six seed rows in `sys_app_settings`, no new tables, no changes to existing objects

## What this does

Seeds the six settings behind **Administration → Configuration → Backup Data** and the
new **Data backup** background job: where attachment files are copied, where compressed
database archives are written, how many archives to keep, and when the job runs.

| Key | Seeded value | Meaning |
|---|---|---|
| `backup_enabled` | `false` | Whether the scheduled pass runs. A manual run ignores it |
| `backup_attachment_root` | `none` | Folder attachment files are copied into |
| `backup_database_root` | `none` | Folder database archives are written to |
| `backup_keep_count` | `7` | How many archives to keep; older ones are deleted after a good write |
| `backup_interval` | `daily` | `hourly`, `daily`, `weekly` or `monthly` |
| `backup_start_time` | `02:00` | The time of day the cadence is anchored to, `HH:MM` local |

## Why app settings and not module settings

The job belongs to no module, so there is no module row to hang its settings off. The
other two configurable jobs store theirs on `investments` and `expense` respectively;
both runners already carry a `module ? … : []` fallback for a missing module, and for a
backup job that fallback would be the *normal* path rather than the edge case.
`sys_app_settings` (migrations/0002) is the app-wide key/value store and takes arbitrary
keys.

## Why this migration is optional, and why it exists anyway

`SqliteSettingsRepository.updateAll` **upserts**, so saving works against keys that have
never been stored — the nav-texture settings have no seed migration for exactly this
reason. This one exists for the `description` column, which the upsert deliberately
leaves alone and which is the only record inside the database of what each key means.

`ON CONFLICT(key) DO NOTHING` so re-running it cannot overwrite a reader's configured
folders with the defaults.

## The `none` sentinel

`settingUpdateSchema` requires a non-empty value, so a blank path **cannot** be written
to this table at all. `none` is the stored stand-in for "no folder chosen";
`resolveBackupSettings` maps it back to `""` so nothing above the settings layer ever
sees it. Same trick as `NO_NAV_TEXTURE`.

## Effect on an existing install

**Applying this migration changes no screen and starts no backup.** The job seeds
switched off with no folders set, so it reports "not configured" on the Background Tasks
screen until an admin chooses both folders. `DEFAULT_MODULES` is unchanged — no new
module.
