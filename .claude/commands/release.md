---
description: Release MyHomeBase to NAS — back up the production DB, sync the docs, ship the changelog, then commit and push.
model: sonnet
---

# Release
# Only used by MyHomeBase Project

Run the steps in order; each depends on the one before. Stop at any step that can't be
completed and say why rather than working around it.

**Never run a quality gate here** — no typecheck, lint, test, build, migration dry-run
or browser run. `/build_project` and `/verify` are Min's to invoke.

**No PowerShell.** The harness denies any command naming `powershell`/`pwsh`, so every
step below uses Node or plain `cp`. SMB itself works fine via `ls`/`cp` — if a copy
fails, it's not the share.

**Mechanical alternative:** `manual_release.bat` (→ `scripts/manual-release.ps1`) does
steps 2, 5 and 6 without a session, but writes a placeholder changelog entry. Prefer
this command when the changes deserve a real one. Keep the two in step — a change here
belongs in the script, and vice versa. Same for
[scripts/backup-nas-db.mjs](scripts/backup-nas-db.mjs), which mirrors the script's backup.

**Target:** Synology NAS, `/volume1/app/myhomebase` on `NAS_DS223`. Setup is
`INSTRUCTION_SETUP_SYNOLOGY.md`; deploy/restart/stop is `ADMIN_MANUAL.md`. (Windows was
retired — for that, `manual_release.bat -Target Windows`.)

## 1. Back up the NAS production database

```bash
npm run backup:nas              # add -- --dry-run to see what it would copy
```

**All three files, not just the `.db`.** The app runs in WAL mode, so committed rows can
still be in `myhomebase.db-wal` — real releases have seen a 4.5 MB WAL. The `-wal`/`-shm`
copies are best-effort; they're absent after a clean checkpoint and shutdown.

**A migration's own backup is not a substitute.** `scripts/migrate.ts` copies the `.db`
alone, with a UTC stamp (`…bak-2026-09-25T15-17-39-410Z`) rather than this step's local
one, and only runs when the release has a migration.

Confirm the new files exist at a plausible size before continuing — the script prints
each name and size, and exits non-zero if the `.db` couldn't be copied.

## 2. Update the markdown docs

Bring any stale root `.md` file into line with the app. Base this on `git status` /
`git diff` against `HEAD`, plus the conversation for the *why*.

- `CHANGE_HISTORY.md` — **write the new dated entry first**, newest at top; step 5 ships
  this file and step 6 commits it. Date via `node -e "console.log(new Date().toLocaleString())"`.
- `components.md` — new reusable components, props still accurate.
- `design.md` — new themes, icon sets, styling rules, phone/desktop behaviour.
- `coding-guide.md` — new tables or prefixes, migration conventions.
- `INSTRUCTION_SETUP_SYNOLOGY.md` — anything about building, deploying or running on NAS.
- `ARCHITECTURE.md`, `CLAUDE.md`, `START_HERE.md` — layering rules, conventions, scripts.

Update what's actually out of date. Say which files were checked and what changed.

## 3. Add this release's changes to `TEST_LIST.md`

`CHANGE_HISTORY.md` records what was *written*; `TEST_LIST.md` records what has been
*tried*, and only the second survives the gap between sessions. Add items to the top
under a heading for this release's date, from the same evidence as step 3:

```markdown
## 2026-09-23 — Release

- [ ] **1.** Investments: the module formerly called Stocks & ETFs
- [ ] **2.** Investments: every section loads under the new /modules/investments URL
```

- **One line per testable behaviour, not per commit.** Omit pure-infrastructure work —
  a doc catch-up, a lint fix — because there is nothing to click.
- **Leave every item unticked.** They're tested after the release is on the NAS; ticking
  one here records a test that never happened.
- **Renumber the whole file.** Items are numbered newest-first, so inserting at the top
  shifts everything below.
- **Name the risky ones** — needs a migration applied, phone-only — in one line under
  the release heading.

Phrase each item as the behaviour a person would go and look at, not the code changed.

## 4. Ship the changelog to NAS

The About page reads `CHANGE_HISTORY.md` from the running app's working directory, so the
deployed copy needs refreshing after step 3. `REBUILD_PUBLISH_NAS.bat` includes it, so a
republish covers it; if the docs changed after that publish, copy the one file:

```bash
cp CHANGE_HISTORY.md //NAS_DS223/app/myhomebase/CHANGE_HISTORY.md
ls -la //NAS_DS223/app/myhomebase/CHANGE_HISTORY.md
head -3 //NAS_DS223/app/myhomebase/CHANGE_HISTORY.md
```

## 5. Commit and push

- Review `git status` / `git diff` once more so nothing unexpected (secrets, debug files,
  scratch scripts) is staged.
- Stage everything — code, `CHANGE_HISTORY.md`, `TEST_LIST.md`, the step 3 docs — so code
  and docs land together.
- Commit with a message summarising the release, sourced from the new changelog entry. If
  the tree holds several unrelated bodies of work, ask whether to split them first.
- Push to `origin/main` (`https://github.com/rvpals/MyHomeBase.git`).

## Notes

- **Migrations are not run here.** Applying them is part of the publish in step 1. If
  this release adds a `migrations/*.sql`, confirm it was applied on the NAS
  (`node --env-file-if-exists=.env migrate.cjs`) — otherwise the affected screen fails
  with "no such column".
- **`dist-nas/` and `.next/` are disposable build artifacts** (gitignored). No need to
  clean them up or ask about them.
