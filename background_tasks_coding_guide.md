# Adding a background task

Everything needed to add a job that runs on a timer, shows up on Administration →
Background Tasks, and can be driven from the CLI.

Read this alongside `ARCHITECTURE.md` (the layer rules still apply) and
`coding-guide.md` → *Three channels, and which one you want* (what a job may write).

**The shape to copy:** `src/lib/hello-world/` is the smallest complete job — settings,
runner, timer, admin card, CLI. `src/lib/documents/text-index-*` is the one to copy if
your job is expensive, has a batch size, or belongs to a module. Open one of them beside
this file; every step below names the file it corresponds to.

---

## The split that matters

Every job is **two files**, and keeping them apart is what makes the cadence testable:

| File | Knows about | Holds |
|---|---|---|
| `settings.ts` | nothing — pure | the setting keys, defaults, `resolve…Settings`, `isDue` / `shouldRunNow`, `describe…Interval` |
| `runner.ts` | `deps`, the database | reads the settings, stamps the run, calls the use-case, records the outcome |

`settings.ts` takes `nowMs` as a parameter and never calls `Date.now()` itself. That is
the whole reason a job's cadence can be unit-tested without waiting.

The **work itself** is a third thing — a normal use-case in `lib/`, taking ports and
returning data, with no idea it is being run on a timer. `runTextIndexPass` is one. A job
whose work lives inside its runner cannot be driven from the CLI or tested.

---

## The twelve steps

### 1. Add the job key

`src/lib/scheduled-jobs/types.ts` → `JOB_KEYS`.

```ts
export const JOB_KEYS = {
  // …
  myNewJob: "my_new_job",
} as const;
```

**The string is permanent.** It is written to `sys_scheduled_runs.job_key` and
`sys_scheduled_run_history.job_key`; renaming it orphans every row an install already
has, exactly like an icon slot id. Spell it `snake_case` to match the ones there.

### 2. Add the descriptor

Same file, `JOB_DESCRIPTORS`. One entry, in the order the admin screen should list it.

```ts
{
  key: JOB_KEYS.myNewJob,
  label: "My new job",
  description: "One or two sentences: what a pass actually does, and what it costs.",
  runnable: true,     // can an admin press "Run now"?
  configurable: true, // are the switch and cadence editable on the screen?
}
```

`runnable: false` is for a job with nothing to inspect — the two prunes are false
because a pass *deletes* rows and there is no diagnostic reason to force one.

The admin screen, the CLI and `listScheduledJobs` all iterate this list, so a job with a
descriptor and nothing else already appears on screen as "Never run."

### 3. Decide where the settings live

| Your job… | Settings go in | Example |
|---|---|---|
| belongs to no module | `sys_app_settings` | backup, Hello world! |
| belongs to a module | that module's settings | document text indexing |

App settings need a **seed migration** (see step 4). Module settings do not — they are
created on first save — but they do need the module to exist.

### 4. Write the migration (app settings only)

A numbered `.sql` **and** its `.md` log. Check `ls migrations/` for the highest number
first: **untracked ≠ unapplied**, so if you cannot confirm a number has never run, take
the next one.

```sql
INSERT INTO sys_app_settings (key, value, description) VALUES
  ('my_new_job_enabled', 'false', 'Whether the scheduled "My new job" runs. A manual "Run now" ignores this.'),
  ('my_new_job_interval_count', '1', 'How many of the interval unit between runs.'),
  ('my_new_job_interval_unit', 'hour', 'The interval unit: second, minute, hour, day or week.')
ON CONFLICT(key) DO NOTHING;
```

**Default the switch to `'false'`.** An install that upgrades into your job must not
start doing work nobody asked for — on the NAS that is invisible load on a 2GB box.

**Store a count and a unit, not resolved minutes.** `60 minutes` and `1 hour` are the
same cadence but not the same thing the reader typed, and the screen has to show back
what they chose.

The seed is strictly optional — the settings repository upserts — but it is the only
place the `description` column gets filled, which is what Admin → Configuration shows.

### 5. Add the defaults

`src/lib/settings/defaults.ts`, mirroring the seed exactly. This is what "Reset to
Default" restores; a key missing here silently disappears on a reset.

Import from the **leaf** settings file, not your module's `index.ts` — a barrel that
re-exports a runner drags the composition root into this file.

### 6. Write `settings.ts`

Pure. No `deps`, no I/O, no clock.

```ts
export const MY_JOB_SETTING_KEYS = { enabled: "my_new_job_enabled", /* … */ } as const;

export function resolveMyJobSettings(rows: { key: string; value: string }[]): MyJobSettings
export function isMyJobEnabled(settings: MyJobSettings): boolean
export function shouldRunNow(settings: MyJobSettings, lastRunAtMs: number | undefined, nowMs: number): boolean
export function describeMyJobInterval(settings: MyJobSettings): string
```

**Every field degrades to a default rather than throwing.** This is read inside a timer
callback where a throw is invisible, so a hand-edited row saying "every 0 hours" has to
fall back to a safe cadence rather than spin the job or kill the scheduler.

**`lastRunAtMs === undefined` counts as due.** A freshly enabled job should run at the
next tick, not after a first full interval of silence.

Colocate `settings.test.ts`. The cadence boundaries are the thing worth testing, and they
are testable precisely because `nowMs` is an argument.

### 7. Write `runner.ts`

Knows about `deps`. The contract is **it never throws** — a scheduled job that takes the
server down is worse than one that skips a pass.

```ts
export const MY_JOB_KEY = JOB_KEYS.myNewJob;

export async function runMyJobNow(options: { force?: boolean } = {}): Promise<MyJobRunSummary> {
  const skipped = (reason: string) => ({ ran: false, reason, detail: reason });

  try {
    const settings = loadMyJobSettings();

    if (!options.force) {
      if (!settings.enabled) return skipped("My new job is switched off.");
      if (!shouldRunNow(settings, lastRunAtMs(loadLastMyJobRun()), Date.now())) {
        return skipped("Not due yet.");
      }
    }

    // Anything that makes the job unable to work is checked BEFORE the stamp:
    // a job that cannot run should not record a run it did not do.
    if (somethingIsMissing) return skipped("No folder is set, so there is nothing to do.");

    // Stamped BEFORE the work. The repository derives the history row from the
    // start/finish pair, so stamping only at the end leaves no history at all —
    // and the screen should say "running" rather than "last run: hours ago".
    deps.scheduledRunRepo.start(MY_JOB_KEY, toSqliteTimestampUtc(new Date()));

    const result = await doTheActualWork(/* ports from deps */);

    const detail = describeMyJobPass(result);           // one line for the admin card
    const status: ScheduledRunStatus = result.failed > 0 ? "partial" : "ok";
    deps.scheduledRunRepo.finish(MY_JOB_KEY, status, detail);
    return { ran: true, status, detail };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error.";
    try {
      deps.scheduledRunRepo.finish(MY_JOB_KEY, "failed", detail);
    } catch {
      // The run table itself is unavailable. Swallowing is the whole contract.
    }
    return { ran: false, status: "failed", detail };
  }
}
```

Three details that are easy to get wrong:

- **`force` skips the switch and the cadence but still stamps.** That is what "Run now"
  passes, so pressing the button also postpones the next scheduled pass.
- **Parse the stored timestamp as UTC.** `sys_scheduled_runs.last_run_at` is a
  SQLite-style stamp, and `Date.parse` reads it as *local* time without the `Z`:
  `Date.parse(\`${run.lastRunAt.replace(" ", "T")}Z\`)`. Getting this wrong makes the
  cadence look hours off on a NAS that is not on UTC. Copy `lastRunAtMs` verbatim.
- **`partial` vs `failed`.** `partial` means the pass worked and some items did not —
  a document whose file was moved by hand. `failed` means the pass itself broke. Using
  `failed` for the first cries wolf on the admin card.

### 8. Arm the timer

`src/instrumentation-node.ts`. Copy `armDocumentTextIndex` and add your call to `armAll()`.

```ts
async function armMyNewJob() {
  if (globalForAutoImport.__myNewJobStarted) return;
  globalForAutoImport.__myNewJobStarted = true;

  // Lazily imported so the Edge/build passes never pull in better-sqlite3 — and so a
  // heavy dependency never loads on an install that leaves the job off.
  const { runMyJobNow } = await import("@/lib/my-job/runner");

  const tick = async () => {
    try {
      const summary = await runMyJobNow();
      // Silent unless a pass actually ran, so an idle scheduler does not write a
      // line a minute saying "not due yet".
      if (summary.ran) console.log(`[my job] ${summary.detail}`);
    } catch (error) {
      // Belt and braces: the runner swallows its own errors, but an unhandled
      // rejection in a timer callback can take the server down.
      console.error("[my job] tick failed:", error);
    }
  };

  const timer = setInterval(tick, HEARTBEAT_MS);
  timer.unref?.();
  console.log("[my job] scheduler armed (60s heartbeat).");
}
```

**Every job shares one 60s heartbeat** and re-reads its settings on every tick. That is
what makes a cadence change in the UI take effect within a minute with no restart and no
timer to rebuild. Do not add a timer at your job's own interval.

The `globalForAutoImport.__…Started` guard matters: the hook can fire more than once in
development, and without it you get two timers doing the same work.

### 9. Add it to the Active/Inactive tabs

`src/lib/scheduled-jobs/active-tasks.ts` — the use-case behind the screen's two tabs:
which jobs are actually armed, and *why* an idle one is idle.

Add your settings to `ActiveTaskInputs`, then a branch computing `nextRunDueAtMs` and, for
the inactive case, **one sentence naming what is missing**. "Switched off" and "switched on
but no folder set" are different problems with different fixes, and a reader looking at an
idle job needs to be told which one they have.

A job with no switch (the two prunes) goes in `ALWAYS_ARMED` instead.

### 10. Wire the admin screen

Three files under `src/app/(protected)/admin/background-tasks/`:

- **`page.tsx`** — load your settings, add them to `taskInputs`, pass them to the view.
- **`actions.ts`** — `saveMyJobSettingsAction` and, if `runnable`, `runMyJobNowAction`.
  **Every exported action authorises on its first line** with `requireAdmin()`. An action
  is its own POST endpoint; the `/admin` layout does not protect it.
- **`view.tsx`** — a card with the switch, the cadence and a Run now button.

### 11. Add the CLI command

`src/cli/my-job.ts`, registered in `src/cli/index.ts` and documented in `CLI_registry.md`.

```
npm run cli -- my-job status
npm run cli -- my-job run [--force]
```

**This is not optional.** `ARCHITECTURE.md` requires every use-case to be reachable
identically from the web app and the terminal — and in practice this is how you drive the
job on the NAS without a browser, which is exactly when you need it most.

### 12. Logging — what you get free, and what you add

**Do not log the trigger or the finish.** Every job's start and end is already written as
an OPERATIONAL line by `withSystemLog`, wrapped around `scheduledRunRepo` once in
`wiring.ts`. Your job is covered the moment it calls `start`/`finish`. Adding your own
would produce two lines per pass.

**Do add DEBUG lines inside the work** if a pass is long or opaque. Take an optional
`log?: SystemLogger` in the use-case's deps and pass `deps.systemLogger` from the runner
only:

```ts
log?.debug("my-job", () => `Processed "${name}" — ${count} items in ${elapsed}.`);
```

Use a **thunk** wherever building the line costs anything — it is not called while the
switch is off. See `coding-guide.md` → *The system log*. Leave the OCR button and the
tests passing no logger at all; the unattended pass is the one nobody watches, and the
one worth instrumenting.

**Only file a message if a person must act.** `sys_messages` lights the household's bell
and has no scheduled prune. A job that files one per run is the Hello, world! job, and it
exists to prove the scheduler is alive.

---

## Checklist

```
[ ]  1. JOB_KEYS entry                      src/lib/scheduled-jobs/types.ts
[ ]  2. JOB_DESCRIPTORS entry               src/lib/scheduled-jobs/types.ts
[ ]  3. settings location decided           app settings or module settings
[ ]  4. seed migration .sql + .md           migrations/   (app settings only)
[ ]  5. DEFAULT_APP_SETTINGS entries        src/lib/settings/defaults.ts
[ ]  6. settings.ts + settings.test.ts      src/lib/<job>/
[ ]  7. runner.ts                           src/lib/<job>/
[ ]  8. arm<Job>() + armAll()               src/instrumentation-node.ts
[ ]  9. active/inactive branch              src/lib/scheduled-jobs/active-tasks.ts
[ ] 10. page.tsx, actions.ts, view.tsx      src/app/(protected)/admin/background-tasks/
[ ] 11. CLI command + CLI_registry.md       src/cli/
[ ] 12. DEBUG lines in the work             (operational is already covered)
```

## The traps, in one place

1. **The job key is permanent.** Renaming orphans every stored run.
2. **Default the switch off.** An upgrade must not start doing work unasked.
3. **Stamp before the work, not after**, or there is no history and the screen lies
   about what is running.
4. **Parse `last_run_at` as UTC** with the trailing `Z`, or the cadence is hours off on
   the NAS.
5. **Never throw out of a runner or a tick.** Both layers swallow, deliberately.
6. **One 60s heartbeat for everything.** Your interval is a comparison inside the tick,
   not a second timer.
7. **Check "can this job work?" before stamping** — a job that cannot run must not record
   a run it did not do.
8. **`partial` is not `failed`.** One unreadable item is not a broken pass.
9. **Do not log the trigger yourself** — the decorator already does.
10. **Untracked ≠ unapplied** for a migration number. The NAS has its own
    `sys_schema_migrations`, and it is the one that matters.
