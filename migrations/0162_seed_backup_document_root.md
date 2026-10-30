# Migration 0162: Document Library backup folder setting

**Date:** 2026-10-29
**Type:** one seed row in `sys_app_settings`, no new tables, no changes to existing objects

## What this does

Seeds `backup_document_root` (`none`) — the NAS folder the Data backup copies the
Document Library's files into. The source is the Document Library's own `document_root`
module setting; it is not duplicated here.

## Why it exists

Optional, as with migration 0134: `updateAll` upserts, so saving works without the row.
It is here for the `description` column. `ON CONFLICT(key) DO NOTHING` so a re-run cannot
overwrite a configured folder.

## Effect on an existing install

Unlike the other folders, **this one is required**: the backup now refuses to run until
it is set (and until the Document Library folder itself is set). An install that already
had a working backup will report "No document backup folder is set." until an admin
chooses one on Backup Data. `DEFAULT_MODULES` is unchanged.
