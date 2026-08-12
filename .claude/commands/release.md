---
description: Release MyHomeBase to NAS — back up the production DB, sync the docs, ship the changelog, then commit and push.
---

# Release
# Only used by MyHomeBase Project

The release checkpoint for this project. Run the steps in order; each one depends on
the one before it. Stop at any step that can't be completed and say why rather than
working around it.

This is the deploy-side counterpart to `/build_project`, which handles the
verification side (typecheck / lint / test / build). If the code hasn't been verified
yet, run that first.

**There is a no-Claude version of the mechanical steps:** `manual_release.bat`
(→ `scripts/manual-release.ps1`) does the backup, changelog stamp, changelog ship,
commit and push without a session. It writes a placeholder changelog entry rather than
a described one, so it's for releases not worth narrating — a dependency bump, a config
tweak. Prefer this command when the changes deserve a real entry. Keep the two in step:
a change to the steps below should be reflected in the script, and vice versa.

## Deployment target

**Synology NAS** (primary) — `/volume1/app/myhomebase` on `NAS_DS223`, reachable
over HTTPS from phones. Published by `REBUILD_PUBLISH_NAS.bat`. First-time NAS
setup — DSM certificate, reverse proxy, SSH, autostart, troubleshooting — is
`INSTRUCTION_SETUP_SYNOLOGY.md`; the day-to-day deploy/restart/stop steps are
`ADMIN_MANUAL.md`.

(Windows target was retired; for that deployment use `manual_release.bat -Target Windows`.)

## 1. Confirm the NAS publish is done

Wait for confirmation that the publish completed before touching anything else.
Don't publish it yourself — that's a manual step outside this repo.

The NAS publish sequence is:

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
release. If it isn't published, stop here.

## 2. Back up the NAS production database

Over SMB — copy all three files, not just the `.db`:

```powershell
$stamp = Get-Date -Format "yyyy-MM-ddTHH-mm-ss"
$data = "\\NAS_DS223\app\myhomebase\data"
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

## 4. Ship the changelog to NAS

The About page reads `CHANGE_HISTORY.md` from the running app's working directory, so
the deployed copy has to be refreshed after step 3. `REBUILD_PUBLISH_NAS.bat` already
includes it in the package, so a republish covers it. If the docs changed *after* that
publish, re-run the batch file or copy the single file over SMB:

```powershell
Copy-Item "CHANGE_HISTORY.md" "\\NAS_DS223\app\myhomebase\CHANGE_HISTORY.md" -Force
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
  confirm it has been applied to the NAS — otherwise the app fails with "no such column"
  on the affected screen. On the NAS that is `node --env-file-if-exists=.env migrate.cjs`.
- **`dist-nas/` is a disposable build artifact** (gitignored), as is `.next/`. No need
  to clean either up or ask about them.
