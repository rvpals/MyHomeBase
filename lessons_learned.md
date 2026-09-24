# Lessons learned

Incidents that cost real time or real data, written down so the next session
doesn't repeat them. Newest first.

---

## 2026-09-23 — `rm -rf` on a typo'd path wiped the entire repo

**Severity:** total loss of the local working tree, including `.git`.
**Recovered:** yes, from GitHub. Nothing committed was lost.

### What happened

All times local (UTC-4). The session was `3e126ae4-e80d-44d3-b1d4-fabb5c011ed2`,
planning and scaffolding a new system message queue feature.

| Time | Event |
|---|---|
| 16:04 | Min commits and pushes `6d9514a` — "Release 2026-09-23: Investments rename, rule types, visit signals". This push is what later saved the project. |
| 22:40:38 | The session writes `schema.ts` to `C:\git\MyHomEBase\src\lib\messages\schema.ts` — note the capital **E** in `MyHomEBase`. A typo in the path. |
| 22:40:41 | It notices the typo and decides to clean up: *"I typo'd the path (`MyHomEBase`), creating a stray directory outside the repo. Let me remove it and write the file correctly."* |
| 22:40:42 | It runs `cd /c/git && rm -rf "/c/git/MyHomEBase" 2>/dev/null; ls /c/git/ \| head`, described in the permission prompt as **"Remove mistyped directory"**. Min clicks Allow — the description sounds harmless and accurate. |
| 22:41:05 | **The repo is destroyed.** Windows filesystems are case-insensitive, so `MyHomEBase` and `MyHomeBase` are the same directory. The `rm -rf` deleted the entire working tree, `node_modules`, `.next`, and `.git`. |
| 22:41:07 | The follow-up `ls` still lists `MyHomeBase` (the now-empty folder), so the session reports *"Stray directory removed; only `MyHomeBase` remains."* **The cleanup appears to have succeeded.** |
| 22:41:16 / 22:41:24 | Unaware, it writes `schema.ts` and `ports.ts` into the now-empty repo. These two files become the only contents of `C:\git\MyHomeBase`. |
| 22:41:28 | A `grep` against `src/lib/stock-watchlist/repository.ts` fails — "No such file or directory". First symptom. |
| 22:41:43 | A `Glob` for `src/lib/stock-watchlist/*.ts` returns nothing, contradicting files it had read minutes earlier. |
| 22:41:58 | It works out the cause: *"My `rm -rf` ran against the real repo, not the typo'd path."* |
| 22:42:00 | Damage assessment begins; confirms `.git` is gone along with the working tree. |
| 22:43:54 | **The session dies mid-assessment** — `Tool permission stream closed before response received`. Min is left with an empty project folder and no explanation. |

### Why it wasn't caught

Four things lined up:

1. **Case-insensitivity.** The command was correct on Linux and catastrophic on
   Windows. `rm -rf "/c/git/MyHomEBase"` resolved to `/c/git/MyHomeBase`.
2. **`2>/dev/null` hid the evidence.** Any error or warning went to the void.
3. **The verification step was fooled.** `ls /c/git/` showed `MyHomeBase` still
   present, which read as "the stray one is gone, the real one is fine." The folder
   existed — it was just empty. Listing a parent directory cannot distinguish
   "intact" from "emptied".
4. **The permission prompt was accurate to intent, not to effect.** "Remove
   mistyped directory" is exactly what the session was trying to do. Nothing in the
   prompt surfaced that the target resolved to the real repo.

### How it was resolved

A later session (`95e417e3`) traced and repaired it. Sequence:

1. **Diagnosed from the filesystem first.** `stat` showed `C:\git\MyHomeBase` had
   **Birth: 2026-08-10 14:29** — the original folder, not a recreated one — while
   `src/`, `ports.ts` and `schema.ts` all had Birth timestamps of **22:41 tonight**.
   That proved the folder was Min's and its contents were new, i.e. a deletion.
2. **Checked the Recycle Bin.** Empty of anything recent — the delete bypassed it.
3. **Confirmed the remote was intact** with `git ls-remote`, then cloned to a
   scratchpad and verified: HEAD `6d9514a`, **1,529 tracked files**, clean history.
4. **Traced the cause** in `~/.claude/projects/c--git-MyHomeBase/*.jsonl`. Found the
   session last written at 22:43, grepped its tool calls for destructive git/shell
   commands, and extracted the exact `rm -rf` with its timestamp and surrounding
   reasoning. **The transcripts are a full forensic record — use them.**
5. **Backed up the two scaffold files** to the scratchpad before touching anything.
6. **Restored without running a single delete:** cloned the remote into a *sibling*
   folder `C:\git\MyHomeBase_restore`, then used `mv -n` to move its contents into
   the real folder, descending one level at a time where names collided
   (`src/`, then `src/lib/`). `mv -n` never overwrites.
7. **Restored `.env`** from `//NAS_DS223/app/myhomebase/.env` (it is gitignored, so
   the repo had only `.env.example`).
8. **Verified:** `git status` clean, 1,529 files tracked, HEAD back at `6d9514a`.

### What was actually lost

Only uncommitted work from the 16:04 push to the 22:40 delete — which in this case
was just the two scaffold files, since that session had been planning and reading
rather than editing. Plus `node_modules` and `.next`, both regenerable.

**The 16:04 push is the only reason this was a scare and not a disaster.**

### Rules adopted

- **Never run `rm`, `rm -rf`, or any recursive/forced delete.** Not even to clean up
  a file or directory Claude itself just created by mistake. If something needs
  deleting, name the full path and let Min run it. Recorded in Claude's memory as
  `never-run-rm`.
- **A path Claude typed wrong is precisely the path it cannot trust.** The mistake
  that creates the stray directory is the same mistake that can mistarget the
  cleanup. This is the *worst* case for an automated delete, not an exception.
- **Windows paths are case-insensitive.** Two strings that differ only in case are
  the same directory. Never reason about them as distinct.
- **Never suppress stderr on a destructive command.** `2>/dev/null` turned a
  recoverable mistake into a silent one.
- **Listing a parent directory does not verify a delete.** The folder name survives.
  Check the target's *contents*.
- **Restore by moving, never by clearing.** Clone to a sibling and `mv -n` into
  place, so a second mistake can't compound the first.

### Recovery reference

If this happens again:

- **Remote:** `https://github.com/rvpals/MyHomeBase.git`
- **`.env`:** copy from `//NAS_DS223/app/myhomebase/.env` — gitignored, not in the repo.
  Note its `MYHOMEBASE_DB` points at the NAS path `/volume1/app/myhomebase/data/myhomebase.db`
  and needs changing for local dev.
- **Database:** never at risk here — the live DB is on the NAS at
  `//NAS_DS223/app/myhomebase/data/` and was untouched.
- **Session transcripts:** `C:\Users\rvpals\.claude\projects\c--git-MyHomeBase\*.jsonl`,
  one per session, containing every tool call with timestamps in UTC. Match a file by
  its mtime, then grep its `tool_use` blocks.
- **`node_modules`:** `npm install`, not in git.
