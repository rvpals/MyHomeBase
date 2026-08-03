---
description: Release MyHomeBase — confirm the publish, back up the production DB, sync the docs, copy the changelog to the server folder, then commit and push.
---

# Release MyHomeBase

The release checkpoint for this project. Run the steps in order; each one depends on
the one before it. Stop at any step that can't be completed and say why rather than
working around it.

This is the deploy-side counterpart to `/build_project`, which handles the
verification side (typecheck / lint / test / build). If the code hasn't been verified
yet, run that first.

## 1. Confirm the app has been rebuilt and published

Ask the user to rebuild and publish the application, and **wait for them to confirm
it's done** before touching anything else. Don't build or publish it yourself — that
is a manual step outside this repo.

If they say it isn't published yet, stop here.

## 2. Back up the production database

The live database is **`C:\webapp\MHB\data\myhomebase.db`** — the published app's
`.env` leaves `MYHOMEBASE_DB` commented out, so it falls back to `./data` relative
to `C:\webapp\MHB`. (`C:\webapp\MHB_DATA\myhomebase.db` is the *development* DB that
the repo's own `.env` points at. Back that one up too only if the user asks.)

Copy **all three** WAL files, not just the `.db`:

```powershell
$stamp = Get-Date -Format "yyyy-MM-ddTHH-mm-ss"
$data = "C:\webapp\MHB\data"
Copy-Item "$data\myhomebase.db"     "$data\myhomebase.db.bak-$stamp"      -Force
Copy-Item "$data\myhomebase.db-wal" "$data\myhomebase.db-wal.bak-$stamp"  -Force -ErrorAction SilentlyContinue
Copy-Item "$data\myhomebase.db-shm" "$data\myhomebase.db-shm.bak-$stamp"  -Force -ErrorAction SilentlyContinue
Get-ChildItem "$data\*.bak-$stamp" | Select-Object Name, Length
```

**Why all three:** the app runs in WAL mode, so committed rows can still be sitting
in `myhomebase.db-wal` and not yet in the `.db` file. Copying the `.db` alone while
the server is running — which is what `scripts/migrate.ts` does for its own backups —
can miss the most recent writes. The `-wal`/`-shm` copies are best-effort
(`-ErrorAction SilentlyContinue`): they're absent when the app has checkpointed and
shut down cleanly, and that's fine.

For a single self-contained snapshot instead, stop the app and run
`VACUUM INTO '<path>'` against the DB — but don't attempt that inline in PowerShell
without checking the quoting, and don't do it while the server is running.

The `.bak-<timestamp>` naming matches the existing files in that folder. Confirm the
new files exist and are a plausible size before continuing.

## 3. Update the markdown docs

Go through the `.md` files at the repo root and bring any that are stale into line
with the current state of the app:

- `CHANGE_HISTORY.md` — **write the new dated entry first**, newest at the top, since
  step 4 copies this file to the server and step 5 commits it. Get the date with
  `Get-Date -Format "yyyy-MM-dd HH:mm"`, and base the entry on `git status` /
  `git diff` against `HEAD` plus the conversation for the *why*.
- `components.md` — any new reusable component registered, props still accurate.
- `design.md` — new themes, icon sets, or styling rules.
- `coding-guide.md` — new tables or prefixes, migration conventions.
- `ARCHITECTURE.md`, `CLAUDE.md`, `START_HERE.md` — layering rules, conventions,
  scripts.

Update what's actually out of date; don't rewrite a file that's still accurate just
to touch it. Say which files were checked and what changed.

## 4. Copy the changelog to the server folder

```powershell
Copy-Item "e:\Code\Claude_Project\MyHomeBase\CHANGE_HISTORY.md" "C:\webapp\MHB\CHANGE_HISTORY.md" -Force
```

This overwrites the copy the running app serves, so it must happen *after* step 3.

## 5. Commit and push

- Review `git status` / `git diff` once more so nothing unexpected (secrets, stray
  debug files, scratch scripts) is about to be staged.
- Stage everything including `CHANGE_HISTORY.md` and the doc updates from step 3, so
  code and docs land together.
- Commit with a message summarising the release — the new `CHANGE_HISTORY.md` entry
  is the source for it. If the tree holds several unrelated bodies of work, ask
  whether to split them into separate commits before committing.
- Push to `origin/main` (`https://github.com/rvpals/MyHomeBase.git`).

## Notes

- **Migrations are not run here.** Applying schema changes to the production DB is
  part of the publish in step 1. If a new `migrations/*.sql` file is in this release,
  confirm with the user that it has been applied to
  `C:\webapp\MHB\data\myhomebase.db` — otherwise the app will fail with "no such
  column" on the affected screen.
- `C:\webapp\MHB_ARM` is a separate ARM deployment. It is not touched by this
  command; mention it if a release looks like it should go there too.
- `.next/` is a disposable build artifact — no need to clean it up or ask about it.
