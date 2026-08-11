# Admin manual — starting, stopping and switching builds

Day-to-day operator notes for the two places MyHomeBase runs. This is the
"how do I restart it" reference; first-time setup of the NAS lives in
[INSTRUCTION_SETUP_SYNOLOGY.md](INSTRUCTION_SETUP_SYNOLOGY.md).

| | Synology NAS | Windows |
|---|---|---|
| Port | 3000 | 5200 |
| Deploy with | `REBUILD_PUBLISH_NAS.bat` (SMB) | `REBUILD_PUBLISH.bat` |
| Launcher | `start.sh` (DSM Task Scheduler) | `START_PRD.bat` / `start_prd.sh` |
| Supervised? | Yes — restarts itself | No — nothing restarts it |

## Deploying a new build to the NAS — the steps

The short version: **one command on Windows, then wait a minute.**

```powershell
cd E:\Code\Claude_Project\MyHomeBase
.\REBUILD_PUBLISH_NAS.bat
```

That builds for aarch64, mirrors to `\\NAS_DS223\app\myhomebase`, and writes
`deploy.trigger`. The keepalive task picks the trigger up on its next run and
switches to the new build. Nothing else is required — **no SSH, no manual
restart.**

In full:

1. **Verify first.** `npm run verify` — typecheck, lint, tests, migration
   dry-run and a browser sweep. The publish does a production build but no
   testing.
2. **If the release adds a migration**, apply it over SSH *before* the switch:
   `cd /volume1/app/myhomebase && node --env-file-if-exists=.env migrate.cjs`
3. **Publish:** `.\REBUILD_PUBLISH_NAS.bat`
4. **Wait a minute**, or force it: DSM → Task Scheduler → "MyHomeBase
   keepalive" → **Run**.
5. **Check it came back** — load the site; `app.log` in the app folder holds the
   startup output if it didn't.

Committing and pushing the source is a separate ritual — see
`/release`, which also covers the Windows target, or `manual_release.bat` for a
no-Claude version of the same mechanical steps.

### Two things that must be true first

These are one-time, from setup, and a release quietly does nothing without them:

- **`start.sh` on the NAS must be the version that understands
  `deploy.trigger`.** It is deliberately not shipped by the publish (see the last
  section), so it does not update itself. Check with
  `grep -c deploy.trigger /volume1/app/myhomebase/start.sh` — `0` means it is the
  old one, and copying a build in will change nothing. Re-copy it from the repo
  root and `chmod +x` it.

  The same applies to **any** later edit of `start.sh`, and the file has grown a
  second job: after a trigger-driven restart it runs `set-startup-message.cjs`,
  which puts "A new deployment is published on …" in front of the next person to
  reach the home screen. Check that half with
  `grep -c set-startup-message /volume1/app/myhomebase/start.sh` — `0` means
  publishes will go out silently. Nothing else breaks; the banner just never
  appears.
- **The keepalive task must be running every minute.** That interval *is* how
  long a release takes to go live.

## The NAS restarts itself, but only for two reasons

`start.sh` runs every minute from the "MyHomeBase keepalive" task. On each run it
restarts the app if — and only if:

1. **`deploy.trigger` exists** in `/volume1/app/myhomebase`. It kills the old
   PID, waits 3 seconds for port 3000 to be released, deletes the trigger, and
   starts the new build.
2. **The process is gone** — no `app.pid`, or the PID in it is dead.

Only the first of those announces a deployment. `start.sh` sets the home-screen
banner from inside the trigger branch, so a crash-restart brings the app back
without claiming a release happened.

### Copying a new build in is *not* one of those reasons

This is the thing that catches people out. Files landing on disk do not restart
anything: if the process is alive and there's no trigger, `start.sh` sees a live
PID and exits immediately. The running Node process already has `server.js`
loaded in memory, so **the NAS keeps serving the old build indefinitely** while
the new one sits on disk next to it.

- **Deployed with `REBUILD_PUBLISH_NAS.bat`?** Nothing to do. It writes
  `deploy.trigger` itself, last, after the copy has fully landed — so the app
  can't come back up on a half-copied build. The switch happens within a minute.
- **Hand-copied over SMB or File Station?** Create the trigger yourself: drop any
  file named `deploy.trigger` into the app folder (contents don't matter, an
  empty file is fine). The next scheduled run picks it up. No SSH needed.

To switch over **immediately** instead of waiting out the minute:
DSM → Task Scheduler → select "MyHomeBase keepalive" → Run.

### If the release adds a migration

Apply it over SSH *before* the restart, or the new build starts against the old
schema:

```sh
cd /volume1/app/myhomebase && node --env-file-if-exists=.env migrate.cjs
```

## Stopping the app

**On the NAS**, prefer the trigger over killing the process. `deploy.trigger`
routes through `start.sh`'s own stop-then-start, which includes the 3-second port
release; killing the process by hand just leaves the keepalive task to restart it
whenever it next runs.

To actually keep it **down**, disable the "MyHomeBase keepalive" task first
(DSM → Task Scheduler → uncheck it) — otherwise it's back inside a minute. Then:

```sh
cd /volume1/app/myhomebase
kill "$(cat app.pid)" && rm -f app.pid
```

Re-enable the task to bring it back.

**On Windows** there's no supervisor, so the app stays down once stopped — and
you rarely need to stop it deliberately, because both launchers free the port
before binding: `START_PRD.bat` does a `netstat` + `taskkill` sweep, and
`start_prd.sh` tries `fuser`/`lsof`/`ss`/`netstat` in turn. Just re-run the
launcher after a deploy. To stop it outright, Ctrl-C the console window, or:

```
netstat -aon | findstr ":5200 " | findstr LISTENING
taskkill /F /PID <pid>
```

## Scripts you can run without Claude

Both of these exist to keep routine work out of a Claude session — the gates and
the release mechanics are deterministic, and streaming their output through a
model costs tokens for nothing. Each is a `.bat` wrapper at the repo root over a
`.ps1` in `scripts/`; the wrapper picks `pwsh` and falls back to `powershell`,
and passes every argument straight through, so use whichever you prefer.

| File | What it does |
|---|---|
| `full_test.bat` → `scripts/full-test.ps1` | Every quality gate from `/verify`, in the same order |
| `manual_release.bat` → `scripts/manual-release.ps1` | The mechanical steps of `/release` — backup, changelog, commit, push |

### `full_test.bat` — the whole quality gate

Runs the stages from `.claude/commands/verify.md`: clear `.next` → typecheck →
lint → library boundary → unit tests → migration dry-run → Playwright sweep.

Unlike `npm run verify`, **a failing stage does not stop the ones after it**, so
one run reports every problem instead of just the first. Full transcripts land in
`.verify/logs/`, and the summary prints the first few error lines per failure so
the cause is visible without opening a log. Exit code is 0 only if every stage
that ran passed.

```powershell
.\full_test.bat                  # everything
.\full_test.bat -SkipE2e         # skip the browser sweep (the slow stage)
.\full_test.bat -StopOnFirst     # classic fail-fast, like `npm run verify`
```

### `manual_release.bat` — release without a Claude session

The five mechanical steps of `/release`: confirm the publish → back up the
production database → stamp `CHANGE_HISTORY.md` → ship that file to the deployed
app → commit and push. Prints a pass/fail summary; exit code 0 only if every step
passed.

```powershell
.\manual_release.bat                    # NAS (default)
.\manual_release.bat -Target Windows    # or -Target Both
.\manual_release.bat -DryRun            # print every action, change nothing
.\manual_release.bat -NoPush            # commit but don't push
.\manual_release.bat -Yes               # no confirmation prompts
```

**It never publishes.** Step 1 stops and asks you to run
`REBUILD_PUBLISH_NAS.bat` yourself, then waits for confirmation — same as
`/release`, and for the same reason: the publish is a manual step outside this
repo, and the NAS serves the old build until it restarts.

Two things it does that are easy to get wrong by hand:

- **The backup copies `-wal` and `-shm`, not just the `.db`.** The app runs in
  WAL mode, so committed rows can still be in the WAL and not yet in the `.db` —
  a `.db`-only copy of a running server can miss the newest writes. It reads the
  NAS data folder over SMB (`\\NAS_DS223\app\myhomebase\data`), so no SSH is
  needed. A failed backup aborts before anything is committed.
- **The changelog is shipped *after* it's stamped.** The publish in step 1
  happens before the stamp in step 3, so the deployed copy is one entry stale;
  step 4 copies the single file over. The About page reads it from the running
  app's working directory.

**What it deliberately doesn't do:** write a real changelog entry. It inserts a
placeholder — `## <date> - Manual release` — and nothing else. That's the right
trade for a dependency bump or a config tweak, and the wrong one for a release
worth describing: the *why* behind a change isn't recoverable from the diff
later. Use `/release` when the release deserves a written entry. It also doesn't
run any gates — run `full_test.bat` first.

## What a publish never overwrites

Both batch files mirror with robocopy `/MIR`, which deletes files that vanished
from the build — except anything matched by `/XD` or `/XF`. Those exclusions are
what keeps a release from destroying live state:

- `data\` — the production database
- `.env` — secrets
- NAS only: `start.sh`, `app.log`, `app.pid`, `deploy.trigger`

`start.sh` is deliberately *not* shipped by the publish. It's created once on the
NAS by hand, so a republish can't clobber the file the boot task runs or strip
its `+x` bit. If `REBUILD_PUBLISH_NAS.bat` warns that there's no `start.sh` in
the destination, see Part 6 of the setup instructions.
