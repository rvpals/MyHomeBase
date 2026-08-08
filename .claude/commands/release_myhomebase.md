---
description: Release MyHomeBase — pick the target (Synology NAS and/or Windows), back up the production DB, sync the docs, ship the changelog, then commit and push.
---

# Release MyHomeBase

The release checkpoint for this project. Run the steps in order; each one depends on
the one before it. Stop at any step that can't be completed and say why rather than
working around it.

This is the deploy-side counterpart to `/build_project`, which handles the
verification side (typecheck / lint / test / build). If the code hasn't been verified
yet, run that first.

## Two deployment targets

| | Where | Published by |
|---|---|---|
| **Synology NAS** (primary) | `/volume1/app/myhomebase` on `NAS_DS223`, reachable over HTTPS from phones | `REBUILD_PUBLISH_NAS.bat` |
| **Windows** | `C:\webapp\MHB` | `REBUILD_PUBLISH.bat <dest>` |

They run against **separate databases** and can be on different versions. The full NAS
runbook — DSM certificate, reverse proxy, SSH, autostart, troubleshooting — is
`INSTRUCTION_SETUP_SYNOLOGY.md`.

## 1. Ask which target(s), and confirm the publish

Ask the user **which target(s) this release is going to**, and wait for them to confirm
the publish is done before touching anything else. Don't publish it yourself — that's a
manual step outside this repo.

For reference, the NAS publish is:

```powershell
.\REBUILD_PUBLISH_NAS.bat          # build + copy over SMB
```
```bash
cd /volume1/app/myhomebase          # then, over SSH
kill "$(cat app.pid)" 2>/dev/null; sleep 2
node --env-file-if-exists=.env migrate.cjs   # only if this release adds migrations
./start.sh
```

**The NAS keeps serving the old build until it is restarted** — a copy alone is not a
release. If they say it isn't published, stop here.

## 2. Back up the production database

Back up **the target(s) being released**, not both by reflex.

**Synology.** Over SSH — copy all three files, not just the `.db`:

```bash
cd /volume1/app/myhomebase/data
STAMP=$(date +%Y-%m-%dT%H-%M-%S)
cp myhomebase.db     "myhomebase.db.bak-$STAMP"
cp myhomebase.db-wal "myhomebase.db-wal.bak-$STAMP" 2>/dev/null
cp myhomebase.db-shm "myhomebase.db-shm.bak-$STAMP" 2>/dev/null
ls -la *.bak-$STAMP
```

**Windows.** `C:\webapp\MHB\data\myhomebase.db` — the published app's `.env` leaves
`MYHOMEBASE_DB` commented out, so it falls back to `./data` relative to
`C:\webapp\MHB`. (`C:\webapp\MHB_DATA\myhomebase.db` is the *development* DB the repo's
own `.env` points at. Back that one up only if asked.)

```powershell
$stamp = Get-Date -Format "yyyy-MM-ddTHH-mm-ss"
$data = "C:\webapp\MHB\data"
Copy-Item "$data\myhomebase.db"     "$data\myhomebase.db.bak-$stamp"      -Force
Copy-Item "$data\myhomebase.db-wal" "$data\myhomebase.db-wal.bak-$stamp"  -Force -ErrorAction SilentlyContinue
Copy-Item "$data\myhomebase.db-shm" "$data\myhomebase.db-shm.bak-$stamp"  -Force -ErrorAction SilentlyContinue
Get-ChildItem "$data\*.bak-$stamp" | Select-Object Name, Length
```

**Why all three:** the app runs in WAL mode, so committed rows can still be sitting in
`myhomebase.db-wal` and not yet in the `.db` file — a real release saw a 4.5 MB WAL.
Copying the `.db` alone while the server is running (which is what `scripts/migrate.ts`
does for its own backups) can miss the most recent writes. The `-wal`/`-shm` copies are
best-effort: they're absent when the app has checkpointed and shut down cleanly.

For a single self-contained snapshot instead, stop the app and run
`VACUUM INTO '<path>'` — not while the server is running, and don't attempt it inline
in PowerShell without checking the quoting.

Confirm the new files exist and are a plausible size before continuing.

## 3. Update the markdown docs

Go through the `.md` files at the repo root and bring any that are stale into line
with the current state of the app:

- `CHANGE_HISTORY.md` — **write the new dated entry first**, newest at the top, since
  step 4 ships this file and step 5 commits it. Get the date with
  `Get-Date -Format "yyyy-MM-dd HH:mm"`, and base the entry on `git status` /
  `git diff` against `HEAD` plus the conversation for the *why*.
- `components.md` — any new reusable component registered, props still accurate.
- `design.md` — new themes, icon sets, styling rules, phone/desktop behaviour.
- `coding-guide.md` — new tables or prefixes, migration conventions.
- `INSTRUCTION_SETUP_SYNOLOGY.md` — anything that changed about building, deploying or
  running on the NAS.
- `ARCHITECTURE.md`, `CLAUDE.md`, `START_HERE.md` — layering rules, conventions, scripts.

Update what's actually out of date; don't rewrite a file that's still accurate just to
touch it. Say which files were checked and what changed.

## 4. Ship the changelog

The About page reads `CHANGE_HISTORY.md` from the running app's working directory, so
the deployed copy has to be refreshed after step 3.

- **Synology:** `REBUILD_PUBLISH_NAS.bat` already includes it in the package, so a
  republish covers it. If the docs changed *after* that publish, re-run the batch file
  or copy the single file to `\\NAS_DS223\app\myhomebase\`.
- **Windows:**
  ```powershell
  Copy-Item "e:\Code\Claude_Project\MyHomeBase\CHANGE_HISTORY.md" "C:\webapp\MHB\CHANGE_HISTORY.md" -Force
  ```

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

- **Migrations are not run here.** Applying schema changes to a production database is
  part of the publish in step 1. If a new `migrations/*.sql` file is in this release,
  confirm it has been applied to **each target being released** — otherwise the app
  fails with "no such column" on the affected screen. On the NAS that is
  `node --env-file-if-exists=.env migrate.cjs`; on Windows, `node scripts\migrate.js`
  from the destination folder.
- **`dist-nas/` is a disposable build artifact** (gitignored), as is `.next/`. No need
  to clean either up or ask about them.
- `C:\webapp\MHB_ARM` is a separate ARM deployment, superseded by the Synology target.
  It is not touched by this command; mention it only if the user asks.
