# CLI registry

Reference for driving MyHomeBase from a terminal.

**Part 1** documents the 12 commands that work today.
**Part 2** is the full inventory of library use-cases — what a command *could* call.
**Part 3** summarises the coverage gap.

Everything here is derived from source, not from running the commands.

## How to run

```
npm run cli -- <command> [args]
```

Defined in `package.json` as `tsx --env-file-if-exists=.env src/cli/index.ts`. The
`--` matters: without it `npm run` swallows the flags.

The database comes from `MYHOMEBASE_DB` (see [src/lib/wiring.ts](src/lib/wiring.ts)),
falling back to `<cwd>/data/myhomebase.db`. **A CLI command writes to whatever that
points at.** Set it deliberately before running anything that mutates.

Discovery is currently by failure — `npm run cli` with no arguments prints the
command list and exits 1. There is no `--help`.

---

# Part 1 — Available commands

Twelve commands, registered in [src/cli/index.ts:19-32](src/cli/index.ts#L19-L32).

| Command | Reads / writes | Network |
|---|---|---|
| [`list-users`](#list-users) | read | no |
| [`create-user`](#create-user) | write | no |
| [`list-csv-analytics`](#list-csv-analytics) | read | no |
| [`create-csv-analytics-entry`](#create-csv-analytics-entry) | write (creates a table) | no |
| [`delete-csv-analytics-entry`](#delete-csv-analytics-entry) | write (drops a table) | no |
| [`import-journal-csv`](#import-journal-csv) | write | no |
| [`expense-top-spenders`](#expense-top-spenders) | read | no |
| [`explain-rule`](#explain-rule) | read | no |
| [`refresh-positions`](#refresh-positions) | write | **yes** |
| [`compute-analytics`](#compute-analytics) | write | **yes** |
| [`ticker-overview`](#ticker-overview) | read (`--refresh` writes cache) | with `--market` |
| [`set-startup-message`](#set-startup-message) | write | no |
| [`user-preferences`](#user-preferences) | read (writes with `--favorite`/`--startup`) | no |
| [`magic-playlist`](#magic-playlist) | read (writes with `--save`/`--regenerate`/`--delete`) | no |
| [`play-queue`](#play-queue) | read (writes with every flag except none) | no |

Flag parsing is `--key value` pairs via [parse-flags.ts](src/cli/parse-flags.ts),
except `ticker-overview` and `set-startup-message`, which read positionals and bare
switches.

---

## `list-users`

Every user account with role, status, and linked Google address.

```
npm run cli -- list-users
```

**Input** — none.
**Calls** — `listUsers(deps.userRepo)`.
**Output** — one line per user, then a count:

```
#1 mhuang — Minliang Huang [admin, active], google someone@example.com (created 2026-01-04T…)

1 user(s).
```

Prints `No users yet.` when the table is empty. **Exit** — always 0.
Source: [src/cli/list-users.ts](src/cli/list-users.ts)

---

## `create-user`

Creates a local account with a hashed password.

```
npm run cli -- create-user --username jane --full-name "Jane Doe" --password secret123 --role admin
```

**Input**

| Flag | Type | Required | Notes |
|---|---|---|---|
| `--username` | string | yes | must be unique |
| `--full-name` | string | yes | |
| `--password` | string | yes | min 8 characters |
| `--description` | string | no | |
| `--role` | `admin` \| `user` | no | defaults to `user` |

Missing flags become `""` and fail zod validation rather than prompting.

**Calls** — `createUser(input, deps.userRepo)`, validated by `createUserSchema`.
**Output** — `Created user "jane" (id 4, role admin).`
**Exit** — 0 on success; 1 with the validation or `DuplicateUsernameError` message on stderr.
Source: [src/cli/create-user.ts](src/cli/create-user.ts)

---

## `list-csv-analytics`

Lists the CSV-analytics entries and their backing tables.

```
npm run cli -- list-csv-analytics
```

**Input** — none.
**Calls** — `listEntries(deps.csvAnalyticsRepo)`.
**Output** — `#3 Sales 2026 — table csv_sales_2026, 8 columns, 1420 rows, primary key (id)`
Prints `No CSV analytic entries yet.` when empty. **Exit** — always 0.
Source: [src/cli/list-csv-analytics.ts](src/cli/list-csv-analytics.ts)

---

## `create-csv-analytics-entry`

Reads a CSV from disk, infers a schema, creates a table, and loads the rows.

```
npm run cli -- create-csv-analytics-entry --name "Sales 2026" --table sales_2026 --file ./data/sales.csv --primary-key id
```

**Input**

| Flag | Type | Required | Notes |
|---|---|---|---|
| `--name` | string | yes | display name |
| `--table` | string | yes | base name; prefixed to form the real table name |
| `--file` | path | yes | read with `readFileSync(path, "utf8")` |
| `--primary-key` | string | no | comma-separated column list |
| `--description` | string | no | |

Columns are **not** configurable here — the command takes `preview.suggestedColumns`
from `previewCsvFile` as-is. The web UI lets you adjust them; the CLI doesn't.

**Calls** — `previewCsvFile(fileText)` then `createEntry(deps.csvAnalyticsRepo, …)`, validated by `createCsvAnalyticEntrySchema`.
**Output** — `Created entry "Sales 2026" (id 3) — table csv_sales_2026, 1420 rows.`
**Exit** — 0; 1 on a missing flag (prints usage), unreadable file, or validation failure.
Source: [src/cli/create-csv-analytics-entry.ts](src/cli/create-csv-analytics-entry.ts)

---

## `delete-csv-analytics-entry`

Deletes an entry **and drops its table**. No confirmation prompt.

```
npm run cli -- delete-csv-analytics-entry 3
```

**Input** — one positional integer id (not a flag).
**Calls** — `getEntryById` to resolve the name, then `deleteEntry(deps.csvAnalyticsRepo, id)`.
**Output** — `Deleted entry "Sales 2026" (id 3) and dropped table csv_sales_2026.`
**Exit** — 0; 1 on a non-integer id (prints usage) or an id that doesn't exist.
Source: [src/cli/delete-csv-analytics-entry.ts](src/cli/delete-csv-analytics-entry.ts)

---

## `import-journal-csv`

Imports journal entries from a CSV, using either a saved mapping or auto-mapped headers.

```
npm run cli -- import-journal-csv --file ./journal.csv
npm run cli -- import-journal-csv --file ./journal.csv --mapping "Day One export"
```

**Input**

| Flag | Type | Required | Notes |
|---|---|---|---|
| `--file` | path | yes | |
| `--mapping` | string | no | name of a saved `Journal` mapping; auto-maps from headers when omitted |

**Calls** — `listNamedMappings(deps.csvImportMappingRepo, "Journal")` or
`autoMapJournalHeaders(parseCsv(fileText).headers)`, then
`importJournalCsv(deps.journalRepo, …)`.

**Output** — a count plus a line per skipped row:

```
Imported 118, skipped 2.
  Row 44: missing date
```

Best-effort by design: a bad row is skipped and reported, not fatal.
**Exit** — 0; 1 on missing `--file`, an unknown mapping name, or a read failure.
Source: [src/cli/import-journal-csv.ts](src/cli/import-journal-csv.ts)

---

## `expense-top-spenders`

The two rollups from the Expense dashboard's "Interesting stats" card. Useful for
eyeballing vendor fuzzy-grouping against real data.

```
npm run cli -- expense-top-spenders --limit 10
```

**Input** — `--limit` (positive integer, default **5**).
**Calls** — `totalsByVendor(deps.expenseRepo)` and `totalsByCategory(deps.expenseRepo)`.
**Output** — two blocks, amounts right-aligned:

```
Top 5 by vendor:
      $1,204.55  AMAZON  (37 transaction(s), name derived)

Top 5 by category:
        $890.12  Groceries  (22 transaction(s))
```

Blank vendor renders as `(unknown)`, blank category as `(uncategorised)`.
**Exit** — 0; 1 if `--limit` isn't a positive integer.
Source: [src/cli/expense-top-spenders.ts](src/cli/expense-top-spenders.ts)

---

## `explain-rule`

Answers "my rule matches but nothing happened." Read-only — it calls the same
`listRules` / `planRuleApplication` the real clean-up uses, so its verdict is the
run's verdict. Writes nothing.

```
npm run cli -- explain-rule --id 4231
npm run cli -- explain-rule --description AMAZON
```

**Input** — exactly one of `--id` (transaction id) or `--description` (case-insensitive
substring, capped at **10** matching rows). Neither given is an error.

**Calls** — `listRules`, `listTransactions`, `matchesPattern`, `compilePattern`, `planRuleApplication`.

**Output** — per transaction: current field values, the `processed` flag, every rule in
evaluation order marked `MATCHES` / `no` / `disabled`, then the winning rule and each
field it would set or skip. Values are JSON-quoted so stray whitespace is visible.
It calls out the three things that actually cause the confusion — a `processed = 1` row
is skipped entirely, only the first matching rule applies, and rules only fill blank fields.

**Exit** — 0; 1 when neither flag is given, or nothing matches. Prints
`There are no post-import rules in this database.` and exits 0 when no rules exist.
Source: [src/cli/explain-rule.ts](src/cli/explain-rule.ts)

---

## `refresh-positions`

⚠️ **Network + writes.** One Yahoo Finance quote per position; updates price, day
range, and dividend fields. Cost basis and classification are left alone.

```
npm run cli -- refresh-positions
```

**Input** — none.
**Calls** — `refreshAllPositions(deps.stockPositionRepo, deps.marketDataClient)`.
**Output** — `Refreshed 42 position(s).` plus a stderr line per failed ticker.
**Exit** — 0 if every position refreshed; **1 if any failed** (partial success still
persists the successes). Suitable for a scheduler.
Source: [src/cli/refresh-positions.ts](src/cli/refresh-positions.ts)

---

## `compute-analytics`

⚠️ **Network-heavy + writes.** Recomputes all three analytics caches — the command an
external scheduler calls for a nightly refresh. Roughly one year of daily history per
position, plus the SPY benchmark, so expect N+1 provider calls.

```
npm run cli -- compute-analytics
```

**Input** — none. Sharpe runs with `{}`, i.e. the schema defaults (risk-free rate 0.05, 365-day lookback).

**Calls** — `computeVolatility` per position → `saveVolatilityCache`, then
`computeCorrelationMatrix`, then `computeSharpe`, all against `deps.stockAnalyticsRepo`
and `deps.marketDataClient`.

**Output**

```
Volatility: computed 40/42 position(s).
Correlation: computed for 38 ticker(s).
Sharpe: ratio=1.24, aligned trading days=249.
```

Each of the three legs is independently try/caught — a failure prints to stderr and the
next leg still runs. Correlation needs at least 2 eligible Stock/ETF positions.

**Exit** — **always 0**, even when a leg fails. If you schedule this, check stderr;
don't rely on the exit code.
Source: [src/cli/compute-analytics.ts](src/cli/compute-analytics.ts)

---

## `ticker-overview`

Everything the ticker viewer dialog shows, for one symbol.

```
npm run cli -- ticker-overview AAPL
npm run cli -- ticker-overview AAPL --market
npm run cli -- ticker-overview AAPL --market --refresh
```

**Input** — the ticker is a **bare positional** (first argument not starting with `--`).

| Switch | Effect |
|---|---|
| *(none)* | `OUR DATA` only — holdings, trades, dividends, watchlist entries. No network. |
| `--market` | ⚠️ adds the `MARKET` section: quote, risk, events, news. |
| `--refresh` | recomputes the risk cache — the CLI equivalent of the Recalculate button. Only meaningful with `--market`. |

**Calls** — `getTickerOwnData({ ticker }, { positions, accounts, watchLists })` — note
this use-case takes `(input, deps)`, the reverse of every other module. With `--market`,
adds `getTickerQuote`, `getTickerRisk`, `getTickerEvents`, `getTickerNewsFeed` under
`Promise.allSettled`, so each leg reports independently — a news outage won't hide the quote.

**Output** — `OUR DATA` (holdings per account, trade counts, average basis, dividend
yield-on-cost, watchlist drift) and, with `--market`, quote, volatility with 52-week
range position, SPY correlation, the last year's events capped at 10, and up to 5
stories. Risk prints its `Calculated` date because cached rows never expire.

**Exit** — 0; 1 when no ticker is given. A failed market leg prints to stderr but does
not change the exit code.
Source: [src/cli/ticker-overview.ts](src/cli/ticker-overview.ts)

---

## `set-startup-message`

Sets the one-shot banner the home screen shows. This is what a publish calls, so the
deploy scripts hold no wording of their own.

```
npm run cli -- set-startup-message                 # standard "new deployment" wording
npm run cli -- set-startup-message "Custom text"   # any message
npm run cli -- set-startup-message --clear
npm run cli -- set-startup-message --show
```

**Input** — one optional positional, or `--clear` / `--show` as the first argument.
With no argument, uses `formatDeploymentMessage(new Date())`. Max 2000 characters.

**Calls** — `getStartupMessage` / `setStartupMessage` / `clearStartupMessage` / `formatDeploymentMessage`, all on `deps.settingsRepo`.

**Output** — `Startup message set: …`, `Startup message cleared.`, or the current value
(`(blank — nothing will be shown)` when empty).
**Exit** — always 0.
Source: [src/cli/set-startup-message.ts](src/cli/set-startup-message.ts)

---

## `take-attendance`

Records one attendance session for a class — the same use-case the home screen's
register calls. Each run **appends** a session rather than replacing one, so a class
that meets twice a day keeps both registers.

```
npm run cli -- take-attendance --class "Math 101" --present "3,7,9" --user 1
npm run cli -- take-attendance --class "Math 101" --present all --user 1
npm run cli -- take-attendance --class "Math 101" --date 2026-08-15 --present "3" --user 1
npm run cli -- take-attendance --class "Math 101" --present all --actions "3:L,7:L+EC" --user 1
```

**Input** — `--class <name>` (required, matched case-insensitively) and `--user <id>`
(required; who took the register). `--present` is a comma-separated list of student ids
or `all`; **everyone not listed is recorded absent**, the same rule the UI applies.
`--date YYYY-MM-DD` defaults to today. `--actions` notes student actions as
`studentId:CODE` pairs, `+`-separated for several codes on one student — codes are the
ones on the Student actions screen (`L`, `EC`), matched case-insensitively, because a
catalog id is not something a teacher knows at a terminal.

**Calls** — `listClasses`, `getAttendanceSheet`, `listStudentActions`, `saveAttendance`
on `deps.attendanceRepo`.

**Output** — how many sessions the day already holds (informational, not a warning),
then the saved session's label and counts, then one line per student with their status
and any noted codes in brackets.
**Exit** — 0; 1 when `--class`/`--user` is missing, the class is unknown or empty, an
action code is unknown (the available codes are printed), `--actions` names a student not
enrolled in the class, or the save is rejected.
Source: [src/cli/take-attendance.ts](src/cli/take-attendance.ts)

---

## `attendance-report`

Prints a class's attendance for a day — the terminal counterpart of the Report screen.

```
npm run cli -- attendance-report --class "Math 101"
npm run cli -- attendance-report --class "Math 101" --date 2026-08-15
npm run cli -- attendance-report --class "Math 101" --list-sessions
npm run cli -- attendance-report --class "Math 101" --session 12
```

**Input** — `--class <name>` (required). `--date YYYY-MM-DD` defaults to today.
`--session <recordId>` picks one of the day's registers; without it the **latest** is
printed, since a class may be registered more than once a day. `--list-sessions` lists
every session with its id, date, label and counts instead of printing one
(`--list-dates` is kept as an alias).

**Calls** — `listClasses`, `listSessionsForClass`, `getAttendanceReport` /
`getAttendanceReportById` on `deps.attendanceRepo`.

**Output** — the class, date, session label and recorded timestamp; the present/absent
counts; a one-line tally of any actions noted that session; then the PRESENT and ABSENT
lists, each name followed by its action codes in brackets. Names and codes are as they
were when attendance was taken.
**Exit** — 0 (including when no attendance exists — that's a fact, not an error); 1 when
`--class` is missing or unknown.
Source: [src/cli/attendance-report.ts](src/cli/attendance-report.ts)

---

## `user-preferences`

Reads or writes one user's preferences — the favorite module and whether logging in
opens it. Drives the same use-cases as the My Account screen, so the two can't diverge.

```
npm run cli -- user-preferences --user min                                # show
npm run cli -- user-preferences --user min --favorite journal --startup yes
npm run cli -- user-preferences --user min --favorite ""                  # clear favorite
```

**Input** — `--user <username>` (required). `--favorite <slug|"">` and
`--startup yes|no` are both optional; **omitting one leaves that preference as it is**,
so either can be changed without restating the other. Supplying neither is a read.

**Calls** — `getUserPreferences` / `saveUserPreferences` / `resolveStartupDestination` on
`deps.userPreferencesRepo`, plus `getAccessibleModules` to bound the favorite.

**Output** — the favorite, the startup flag, and the resolved landing place
(`lands on login: /modules/<slug>` or `the home screen`). A favorite the user can't
reach is rejected, and the reachable module slugs are printed to stderr.
**Exit** — 0; 1 when `--user` is missing or unknown, `--startup` isn't `yes`/`no`, or the
save is rejected.
Source: [src/cli/user-preferences.ts](src/cli/user-preferences.ts)

---

# Part 2 — Full use-case inventory

Every exported use-case in `src/lib/`, whether or not a command reaches it.

- **`[CLI]`** — reachable today via a Part 1 command.
- **`[web only]`** — exists and works, but only a server action or server component calls it.

Conventions that hold almost everywhere:

- The repo/client argument comes **first**; `input` follows. Two exceptions:
  the `auth` and `user` modules put the repo **last**, and
  `getTickerOwnData(input, deps)` is reversed.
- Repos come from `deps` in [src/lib/wiring.ts](src/lib/wiring.ts). **Never construct
  one** — the file header says so.
- better-sqlite3 is synchronous, so only network-touching use-cases return a `Promise`.
- ⚠️ marks a live third-party call. None of these five providers needs an API key:
  Yahoo Finance (quotes/history/news), Financial Modeling Prep (logos),
  OpenStreetMap Nominatim (geocoding), Open-Meteo (weather).

---

## auth — `@/lib/auth`

Repo argument comes **last** in this module.

| Use-case | Signature | Status |
|---|---|---|
| `login` | `(input: LoginInput, userRepo, sessionRepo) => { session, user } \| undefined` | web only |
| `logout` | `(sessionId: string, sessionRepo) => void` | web only |
| `getCurrentUser` | `(sessionId: string \| undefined, sessionRepo, userRepo) => User \| undefined` | web only |
| `invalidateSessionsForUser` | `(userId: number, sessionRepo) => void` | web only |
| `completeGoogleLogin` | `(code, googleClient, userRepo, sessionRepo) => Promise<GoogleLoginResult>` ⚠️ | web only |

deps: `deps.userRepo`, `deps.sessionRepo`, `deps.googleOAuthClient`.
`login` is zod-validated by `loginSchema`; it deliberately doesn't distinguish "unknown
username" from "wrong password". `deps.googleOAuthClient` is `undefined` when the three
`GOOGLE_*` env vars aren't set.

`Session { id, userId, createdAt, expiresAt }`
`GoogleLoginResult = { ok: true, session, user } | { ok: false, reason: "unverified_email" | "account_disabled" }`

## user — `@/lib/user`

Repo argument comes **last**. All take `deps.userRepo`.

| Use-case | Signature | Zod | Status |
|---|---|---|---|
| `listUsers` | `(repo) => User[]` | — | **CLI** |
| `createUser` | `(input: CreateUserInput, repo) => User` | `createUserSchema` | **CLI** |
| `registerUser` | `(input, repo, adminSignupSecret?) => User` | `registerUserSchema` | web only |
| `verifyCredentials` | `(input: { username, password }, repo) => User \| undefined` | — | web only |
| `setUserPassword` | `(targetUserId, input: { password }, repo) => void` | `setPasswordSchema` | web only |
| `setUserRole` | `(actingUserId, targetUserId, role, repo) => void` | — | web only |
| `setUserDisabled` | `(actingUserId, targetUserId, isDisabled, repo) => void` | — | web only |
| `deleteUser` | `(actingUserId, targetUserId, repo) => void` | — | web only |
| `getUserByGoogleEmail` | `(googleEmail, repo) => User \| undefined` | — | web only |
| `setUserGoogleEmail` | `(userId, input: { googleEmail? }, repo) => void` | `setGoogleEmailSchema` | web only |
| `createUserFromGoogle` | `(input: { googleEmail, fullName? }, repo) => User` | indirect | web only |
| `isAdmin` | `(user: User) => boolean` — pure | — | web only |
| `getAccessibleModules` | `(user, allModules, repo) => Module[]` | — | web only |
| `userHasModuleAccess` | `(user, moduleId, repo) => boolean` | — | web only |
| `getUserModuleAccess` | `(userId, repo) => number[]` | — | web only |
| `setUserModuleAccess` | `(userId, moduleIds: number[], repo) => void` | `moduleAccessSchema` | web only |
| `getUserAvatar` | `(userId, repo) => UserAvatar \| undefined` — **Buffer** | — | web only |
| `setUserAvatar` | `(userId, input: UserAvatar, repo) => void` — **Buffer in** | `setAvatarSchema` | web only |
| `clearUserAvatar` | `(userId, repo) => void` | — | web only |

`setUserRole`, `setUserDisabled`, and `deleteUser` take `actingUserId` and throw
`SelfLockoutError` rather than let an admin lock themselves out. Errors exported:
`DuplicateUsernameError`, `DuplicateGoogleEmailError`, `SelfLockoutError`, `InvalidAdminSecretError`.

`User { id, username, fullName, description?, role: "admin"|"user", isDisabled, googleEmail?, avatarMimeType?, createdAt, updatedAt }`

## settings — `@/lib/settings`

All take `deps.settingsRepo`.

| Use-case | Signature | Status |
|---|---|---|
| `listSettings` | `(repo) => Setting[]` | web only |
| `getSetting` | `(repo, key: string) => Setting \| undefined` | web only |
| `updateSettings` | `(repo, updates: SettingUpdate[]) => Setting[]` | web only |
| `resetSettingsToDefaults` | `(repo) => Setting[]` | web only |
| `getStartupMessage` | `(repo) => string \| undefined` | **CLI** |
| `setStartupMessage` | `(repo, message: string) => void` | **CLI** |
| `clearStartupMessage` | `(repo) => void` | **CLI** |
| `formatDeploymentMessage` | `(publishedAt: Date) => string` — pure, **takes a `Date`** | **CLI** |

`getStartupMessage` treats blank/whitespace as "nothing to show" — the blank-not-NULL
sentinel. `updateSettings` is validated by `settingUpdateListSchema`, which lives in
`schema.ts` but is **not re-exported from the barrel**.
`Setting { key, value, description? }`

## modules — `@/lib/modules`

All take `deps.moduleRepo`. **No CLI reach.**

| Use-case | Signature |
|---|---|
| `listModules` | `(repo, options?: { includeHidden?: boolean }) => Module[]` |
| `getModuleBySlug` | `(repo, slug: string) => Module \| undefined` |
| `updateModules` | `(repo, updates: ModuleUpdate[]) => Module[]` — sequence derives from array order |
| `resetModulesToDefaults` | `(repo) => Module[]` |
| `setModuleCarouselImage` | `(repo, slug, input: ImageUploadInput) => void` — 2 MB cap |
| `removeModuleCarouselImage` | `(repo, slug) => void` |
| `getModuleCarouselImage` | `(repo, slug) => DecodedImage \| undefined` — **Buffer** |

Image uploads validate against `imageUploadSchema` from `@/lib/shared/image-upload`,
not this module's `schema.ts`. `ImageUploadInput` carries base64 as a **string**, so
uploads are JSON-safe even though reads return a Buffer.

`Module { id, slug, shortName, longName, description?, sequence, isVisible, icon, hasCarouselImage, updatedAt? }`

## module-settings — `@/lib/module-settings`

All take `deps.moduleSettingsRepo`. Fully JSON-serializable. **No CLI reach.**

| Use-case | Signature |
|---|---|
| `listAllModuleSettings` | `(repo) => ModuleSetting[]` |
| `listModuleSettingsFor` | `(repo, moduleId: number) => ModuleSetting[]` |
| `saveModuleSettings` | `(repo, input: ModuleSettingsSave) => ModuleSetting[]` — `moduleSettingsSaveSchema`; replaces the whole set |

`ModuleSetting { id, moduleId, key, value, description? }`

## sql-explorer — `@/lib/sql-explorer`

All take `deps.sqlExplorerRepo`. **No CLI reach** — and the most obviously useful gap
for debugging.

| Use-case | Signature |
|---|---|
| `listTables` | `(repo) => TableInfo[]` |
| `executeStatement` | `(repo, sql: string) => SqlExecutionResult` — ⚠️ **unrestricted; runs writes** |
| `executeReadOnlyQuery` | `(repo, sql: string) => ReadOnlyQueryResult` — must start with `SELECT`; CTEs rejected |

`SqlExecutionResult = { kind: "query", columns, rows } | { kind: "statement", changes }`
`TableInfo { name, columns: { name, type, isPrimaryKey, isNotNull }[] }`

## system-info — `@/lib/system-info`

No `schema.ts`, no zod. **No CLI reach.**

| Use-case | Signature |
|---|---|
| `getSystemInfo` | `(deps.systemInfoRepo) => SystemInfo` — env contents, DB file sizes, memory, server info |
| `parseEnvFile` | `(text: string) => EnvVariable[]` — pure |
| `formatBytes` | `(bytes: number) => string` — pure |

`SystemInfo { envFilePath, envVariables, databaseFiles, backupFiles, memory, server }`

## change-history — `@/lib/change-history`

No `schema.ts`. **No CLI reach.**

| Use-case | Signature |
|---|---|
| `getChangeHistory` | `(deps.changeHistoryRepo) => ChangeHistory` — both fields null when there's no log |
| `summarizeChangeHistory` | `(markdown: string) => ChangeHistorySummary` — pure |
| `readChangeTag` | `(text: string) => TaggedLine` — pure; splits `[Added]`/`[Changed]`/`[Fixed]` |

The barrel is deliberately free of `node:fs` — the About view is a `"use client"`
module and imports these types, so anything Node-only would follow the barrel into the
browser bundle. The concrete repository is wired in `wiring.ts`.

`ChangeCounts { total, added, changed, fixed }`

## csv-analytics — `@/lib/csv-analytics`

All take `deps.csvAnalyticsRepo`.

| Use-case | Signature | Zod | Status |
|---|---|---|---|
| `previewCsvFile` | `(fileText: string) => CsvAnalyticsPreview` — pure | — | **CLI** |
| `listEntries` | `(repo) => CsvAnalyticEntry[]` | — | **CLI** |
| `getEntryById` | `(repo, id) => CsvAnalyticEntry \| undefined` | — | **CLI** |
| `readEntryData` | `(repo, id, limit?) => CsvEntryData` | — | web only |
| `createEntry` | `(repo, input: CreateCsvAnalyticEntryInput) => CsvAnalyticEntry` | `createCsvAnalyticEntrySchema` | **CLI** |
| `updateEntry` | `(repo, id, input) => UpdateEntryResult` | `updateCsvAnalyticEntrySchema` | web only |
| `deleteEntry` | `(repo, id) => void` — drops the table | — | **CLI** |
| `listChartPresets` | `(repo, entryId) => CsvChartPreset[]` | — | web only |
| `saveChartPreset` | `(repo, input) => CsvChartPreset` — upserts by (entryId, name) | `saveChartPresetSchema` | web only |
| `deleteChartPreset` | `(repo, id) => void` | — | web only |

`updateEntry`'s `ingest.mode` is `"append" | "truncate" | "overwrite"`; append and
truncate throw when headers don't match. File contents travel as strings, so all of
this is JSON-safe apart from the repo.

`CsvColumnType = "text"|"integer"|"real"|"date"|"datetime"|"boolean"`

## csv-import — `@/lib/csv-import`

Repo is `deps.csvImportMappingRepo`.

| Use-case | Signature | Zod | Status |
|---|---|---|---|
| `previewCsv` | `(fileText: string) => CsvPreview` — pure | — | web only |
| `getCurrentMapping` | `(repo, importType) => ColumnMapping \| undefined` | — | web only |
| `saveCurrentMapping` | `(repo, input) => void` | `saveCurrentMappingSchema` | web only |
| `listNamedMappings` | `(repo, importType) => NamedMapping[]` | — | **CLI** |
| `createNamedMapping` | `(repo, input) => NamedMapping` | `createNamedMappingSchema` | web only |
| `updateNamedMapping` | `(repo, id, input) => NamedMapping` | `updateNamedMappingSchema` | web only |
| `deleteNamedMapping` | `(repo, id) => void` | — | web only |
| `summarizeImportResults` | `(results: ImportRowResult[]) => ImportSummary` — pure | — | web only |

`ImportType = "Position" | "Transaction" | "Performance" | "Journal" | "Expense"`
`ColumnMapping = Record<string, string>` — key is the CSV column index as a string.
`ImportSummary { importedCount, skippedCount, results: { rowNumber, status, reason? }[] }`

Pure mapping helpers also exported: `applyMapping`, `constantValuesByField`,
`selectImportRows`, `restrictMapping`, `restrictMappingToColumns`,
`findDuplicateFieldMappings`, `assignFieldToColumn`, `resolveAccountNameMapping`,
`toAccountNameMapping`, `parseStoredMapping`, `serializeNamedMapping`, `splitDelimited`,
`parseDateWithFormat`, `sampleRows` (takes an optional RNG **callback**).
Parser helpers: `parseCsv`, `parseCsvLine`, `parseCsvRecords`, `parseNumeric`,
`autoMapHeaders`, `mapRow`, `parseDateToIso`.

## expense — `@/lib/expense`

Repo is `deps.expenseRepo`. The largest module — 32 use-cases, 7 reachable.

**Accounts and categories** — all web only.

| Use-case | Signature | Zod |
|---|---|---|
| `listAccounts` | `(repo) => CreditCardAccount[]` | — |
| `createAccount` | `(repo, input: SaveAccountInput) => CreditCardAccount` | `saveAccountSchema` |
| `updateAccount` | `(repo, id, input) => CreditCardAccount` | `saveAccountSchema` |
| `deleteAccount` | `(repo, id) => void` — refuses while transactions reference it | — |
| `setAccountImage` | `(repo, id, input) => void` — 512 KB cap | `expenseImageUploadSchema` |
| `clearAccountImage` | `(repo, id) => void` | — |
| `getAccountImage` | `(repo, id) => CardImage \| undefined` — **Buffer** | — |
| `listCategories` | `(repo) => ExpenseCategory[]` | — |
| `upsertCategory` | `(repo, input) => ExpenseCategory` | `saveCategorySchema` |
| `deleteCategory` | `(repo, name) => void` — also clears it from every transaction | — |
| `setCategoryIcon` | `(repo, name, input) => void` — 128 KB cap | `expenseImageUploadSchema` |
| `clearCategoryIcon` | `(repo, name) => void` | — |
| `getCategoryIcon` | `(repo, name) => CategoryIcon \| undefined` — **Buffer** | — |

**Transactions**

| Use-case | Signature | Zod | Status |
|---|---|---|---|
| `listTransactions` | `(repo, filter?: TransactionFilter) => ExpenseTransaction[]` | — | **CLI** |
| `getTransaction` | `(repo, id) => ExpenseTransaction \| undefined` | — | web only |
| `createTransaction` | `(repo, input, createdByUserId) => ExpenseTransaction` | `saveTransactionSchema` | web only |
| `updateTransaction` | `(repo, id, input) => ExpenseTransaction` | `saveTransactionSchema` | web only |
| `deleteTransaction` | `(repo, id) => void` | — | web only |
| `deleteTransactions` | `(repo, ids: number[]) => number` | `transactionIdsSchema` | web only |
| `bulkEditTransactions` | `(repo, ids, changes) => number` | `transactionIdsSchema` + `bulkTransactionEditSchema` | web only |

`TransactionFilter { accountId?, categoryName?, status?, fromDate?, toDate? }`.
Bulk edit deliberately can't change date or amount.

**Rules and clean-up**

| Use-case | Signature | Status |
|---|---|---|
| `listRules` | `(repo) => PostImportRule[]` | **CLI** |
| `createRule` | `(repo, input) => PostImportRule` — `savePostImportRuleSchema` | web only |
| `updateRule` | `(repo, id, input) => PostImportRule` | web only |
| `deleteRule` | `(repo, id) => void` | web only |
| `runCleanupBatch` | `(repo, batchSize = 25) => CleanupBatchResult` | web only |
| `countUnprocessed` | `(repo) => number` | web only |
| `resetProcessedFlags` | `(repo) => number` — the "Re-queue all" action | web only |
| `previewPatternMatches` | `(repo, pattern, limit = 5) => { matchCount, samples }` | web only |

Pure rules engine, all **CLI**-reachable through `explain-rule`: `compilePattern`,
`matchesPattern`, `planRuleApplication`. Also `findMatchingRule`, `applyAssignments`.

Rule semantics worth restating: only the **first** matching rule applies (they don't
stack), rules only fill **blank** fields, and the clean-up only reads rows with
`processed = 0`.

**Rollups** — `totalsByCategory(repo, filter?)` and `totalsByVendor(repo, filter?)` are
both **CLI**. Pure: `vendorTotals`, `vendorGroupKey`, `vendorKeyFromDescription`.

**Import** — all web only.

| Use-case | Signature |
|---|---|
| `importExpenseCsv` | `(repo, fileText, columnMapping, fieldOptions, options: ExpenseImportOptions, createdByUserId) => ExpenseImportSummary` |
| `runAutoImport` | `(settings: ExpenseSettings, dependencies: AutoImportDependencies) => AutoImportRunSummary` |
| `parseMoneyToCents` | `(value: string) => number \| undefined` — pure; handles `$20.33`, `1,234.56`, `(45.00)`, trailing minus |

Import is best-effort per row. Duplicates (same account, date, description, amount) are
skipped by default.

**Two deep-path exceptions in this module:**

1. `@/lib/expense/csv-folder` exports only `type CsvFolderPort` from the barrel — the
   Node implementation imports `node:fs`, and the barrel is reachable from client
   components.
2. **`@/lib/expense/auto-import-runner` is not exported from the barrel at all.** It
   imports `deps` directly, so exporting it would create a `wiring.ts` cycle.

```ts
import { runExpenseAutoImport, loadExpenseSettings } from "@/lib/expense/auto-import-runner";
```

`runExpenseAutoImport(): AutoImportRunSummary` takes **zero arguments**, resolves six
repos internally, and never throws — the single most CLI-ready entry point in the
codebase. It skips the run when there's no admin to attribute imports to.
By contrast `runAutoImport` needs an `AutoImportDependencies` object holding three
repos and an optional `now: () => Date` callback, so it can't be driven from JSON.

Settings helpers (pure): `resolveExpenseSettings`, `expenseSettingsToEntries`,
`isAutoImportConfigured`, `isAutoImportEnabled`, `shouldRunNow`.

`ExpenseTransaction { id, transactionDate, postingDate, transactionAccountId, transactionDescription, categoryName, vendor, amountCents, note, status, processed, createdByUserId, createdAt, updatedAt }`
`TransactionStatus = "new"|"reconciled"|"irreconcilable"`
`RuleActionField = "categoryName"|"vendor"|"status"|"note"`
`VendorTotal { vendor, totalCents, transactionCount, isDerived }`

## attendance — `@/lib/attendance`

All take `deps.attendanceRepo`. Everything JSON-serializable apart from the repo.

| Use-case | Signature | Zod | Status |
|---|---|---|---|
| `formatStudentName` | `(student: Student) => string` — pure | — | **CLI** |
| `listStudents` | `(repo) => Student[]` | — | web only |
| `getStudentById` | `(repo, id) => Student \| undefined` | — | web only |
| `addStudent` | `(repo, input: CreateStudentInput) => Student` | `createStudentSchema` | web only |
| `updateStudent` | `(repo, id, input) => Student` | `updateStudentSchema` | web only |
| `deleteStudent` | `(repo, id) => void` — clears enrollments; saved records keep their entries | — | web only |
| `listClasses` | `(repo) => AttendanceClass[]` | — | **CLI** |
| `getClassById` | `(repo, id) => AttendanceClass \| undefined` | — | web only |
| `createClass` | `(repo, input: CreateClassInput) => AttendanceClass` — rejects a duplicate name readably | `createClassSchema` | web only |
| `updateClass` | `(repo, id, input) => AttendanceClass` | `updateClassSchema` | web only |
| `deleteClass` | `(repo, id) => void` — saved records survive, carrying the old class name | — | web only |
| `listStudentsInClass` | `(repo, classId) => Student[]` | — | web only |
| `enrollStudents` | `(repo, input) => { addedCount, skippedCount }` — re-adding is a no-op | `enrollStudentsSchema` | web only |
| `removeStudentFromClass` | `(repo, classId, studentId) => void` | — | web only |
| `listStudentActions` | `(repo, { includeRetired? } = {}) => StudentAction[]` — picker order; retired excluded by default | — | **CLI** |
| `getStudentActionById` | `(repo, id) => StudentAction \| undefined` | — | web only |
| `createStudentAction` | `(repo, input: CreateStudentActionInput) => StudentAction` — uppercases the code, rejects a duplicate case-insensitively | `createStudentActionSchema` | web only |
| `updateStudentAction` | `(repo, id, input) => StudentAction` | `updateStudentActionSchema` | web only |
| `setStudentActionActive` | `(repo, id, isActive) => StudentAction` — retire or bring back | — | web only |
| `deleteStudentAction` | `(repo, id) => { deleted, recordedUses }` — **refuses** an action a session has recorded; retire it instead | — | web only |
| `getAttendanceSheet` | `(repo, classId, attendanceDate) => AttendanceSheet` | — | **CLI** |
| `saveAttendance` | `(repo, input: SaveAttendanceInput) => AttendanceRecord` — **appends** a session, never replaces | `saveAttendanceSchema` | **CLI** |
| `getAttendanceReport` | `(repo, query) => AttendanceReport \| undefined` — the day's latest session | `attendanceReportQuerySchema` | **CLI** |
| `getAttendanceReportById` | `(repo, recordId) => AttendanceReport \| undefined` | — | **CLI** |
| `listSessionsForClass` | `(repo, classId) => AttendanceSessionSummary[]` — newest first, with counts | — | **CLI** |
| `listRecordDatesForClass` | `(repo, classId) => string[]` — distinct dates, newest first | — | web only |

The caller supplies the date; **no use-case here reads the clock** — both adapters
already know their own "today", and a use-case that didn't would need the clock frozen
to be testable.

`saveAttendance` takes only the students marked present and writes everyone else
`absent`, so "left blank" and "explicitly absent" are deliberately the same stored fact.
It rejects an entry naming a student not enrolled in the class, a student listed twice, an
unknown or **retired** action id, and the same action listed twice for one student.

Student actions are a teacher-editable catalog (`att_student_actions`) recorded per
student per session (`att_attendance_entry_actions`). Recorded rows carry the action's
code **and** name as they were at save time, so a later rename doesn't rewrite a printed
report — the same denormalization `className` and `studentName` use. Icon keys come from
`ATTENDANCE_ACTION_ICONS`, a module-local glyph set outside the user-selectable icon
sets; `migrations/0051_create_attendance_student_actions.md` records why.

`AttendanceEntry { studentId, studentName, status, actions: RecordedStudentAction[] }`
`AttendanceReport { recordId, classId, className, attendanceDate, recordedAt, sessionLabel, presentCount, absentCount, entries, actionTallies }`

Preferences (pure): `resolveAttendanceSettings`, `attendanceSettingsToEntries`.

## journal — `@/lib/journal`

All take `deps.journalRepo`. Everything JSON-serializable apart from the repo.

| Use-case | Signature | Zod | Status |
|---|---|---|---|
| `listEntries` | `(repo) => JournalEntry[]` | — | web only |
| `listRecentEntries` | `(repo, limit = 25) => JournalEntry[]` | — | web only |
| `searchEntries` | `(repo, term, limit = 25) => JournalEntry[]` — case-insensitive substring match on date, time, title, content, place, category, tag | — | web only |
| `listTodayInHistory` | `(repo, referenceDate: string) => TodayInHistoryEntry[]` | manual regex | web only |
| `getEntry` | `(repo, id) => JournalEntry \| undefined` | — | web only |
| `getEntryNeighbors` | `(repo, id) => JournalEntryNeighbors` | — | web only |
| `createEntry` | `(repo, input: CreateEntryInput) => JournalEntry` | `createEntrySchema` | web only |
| `updateEntry` | `(repo, id, input) => JournalEntry` — refuses a locked entry | `updateEntrySchema` | web only |
| `deleteEntry` | `(repo, id) => void` — refuses a locked entry | — | web only |
| `setPinned` | `(repo, id, isPinned) => JournalEntry` | — | web only |
| `setLocked` | `(repo, id, isLocked) => JournalEntry` — not blocked when locked; the only way to unlock | — | web only |
| `listCategories` | `(repo) => JournalCategory[]` | — | web only |
| `upsertCategory` | `(repo, input) => JournalCategory` | `upsertCategorySchema` | web only |
| `deleteCategory` | `(repo, name) => void` | — | web only |
| `listTags` | `(repo) => JournalTag[]` | — | web only |
| `upsertTag` | `(repo, input) => JournalTag` | `upsertTagSchema` | web only |
| `deleteTag` | `(repo, name) => void` | — | web only |
| `importJournalCsv` | `(repo, fileText, columnMapping, fieldOptions = {}) => ImportSummary` | indirect | **CLI** |
| `autoMapJournalHeaders` | `(headers: string[]) => { columnMapping, fieldOptions }` — pure | — | **CLI** |

`listTodayInHistory` takes the reference date as an argument rather than reading the
clock. `createEntry` auto-registers unknown categories and tags.

`JournalEntry { id, date, time, title, content, placeName, weather?, isPinned, isLocked, categories: string[], tags: string[], locations: EntryLocation[], createdAt, updatedAt }`

Preferences (pure): `resolveJournalPreferences`, `journalPreferencesToEntries`.

## stock-positions — `@/lib/stock-positions`

Repo is `deps.stockPositionRepo`; refresh also needs `deps.marketDataClient`.

| Use-case | Signature | Zod | Status |
|---|---|---|---|
| `listPositions` | `(repo, accountId?) => StockPosition[]` | — | web only¹ |
| `getPosition` | `(repo, key: PositionKey) => StockPosition \| undefined` | `positionKeySchema` | web only |
| `listPositionsByTicker` | `(repo, ticker) => StockPosition[]` | — | web only |
| `upsertPosition` | `(repo, input) => StockPosition` — `valueCents` is server-computed | `upsertPositionSchema` | web only |
| `deletePosition` | `(repo, key) => void` | `positionKeySchema` | web only |
| `listTransactions` | `(repo, ticker?) => StockTransaction[]` | — | web only |
| `createTransaction` | `(repo, input) => StockTransaction` — total server-computed | `createTransactionSchema` | web only |
| `updateTransaction` | `(repo, id, input) => StockTransaction` | `updateTransactionSchema` | web only |
| `deleteTransaction` | `(repo, id) => void` | — | web only |
| `refreshPosition` | `(repo, client, key) => Promise<StockPosition>` ⚠️ | `positionKeySchema` | web only |
| `refreshAllPositions` | `(repo, client) => Promise<{ refreshed, failed }>` ⚠️ | — | **CLI** |
| `importPositionsFromCsv` | `(repo, fileText, columnMapping, options = {}) => ImportSummary` | via `upsertPositionSchema` | web only |
| `importTransactionsFromCsv` | `(repo, fileText, columnMapping, fieldOptions = {}, excludedRowIndexes = []) => ImportSummary` — idempotent on re-import | via `createTransactionSchema` | web only |

¹ `compute-analytics` calls `deps.stockPositionRepo.listPositions()` on the repo
directly rather than through the use-case.

Pure: `annualIncomeCents`, `changePct`, `computePortfolioSummary`, `computeAllocation`
(takes a **`label` callback**), `computeDayMovesByType`, `computeTickerDayMoves`,
`moverMeasureCents`, `topGainers`, `topLosers`, `computeTransactionStats`,
`computeAverageCostBasisCents`, `inferPositionType`, `resolvePositionType`.

`PositionType = "Stock"|"ETF"|"Bond"|"MutualFund"|"Crypto"|"Other"`; `UNASSIGNED_ACCOUNT_ID = 0`
`PortfolioSummary { positionCount, totalValueCents, totalDayGainLossCents, dayChangePct, stockValueCents, etfValueCents, otherValueCents, annualDividendIncomeCents, totalCostCents, totalUnrealizedGainLossCents, totalReturnPct }`

## stock-analytics — `@/lib/stock-analytics`

| Use-case | Signature | Status |
|---|---|---|
| `computeVolatility` | `(deps.marketDataClient, position) => Promise<VolatilityResult>` ⚠️ 2 calls | **CLI** |
| `computeCorrelationMatrix` | `(deps.stockAnalyticsRepo, deps.marketDataClient, positions) => Promise<CorrelationResult>` ⚠️ **N+1 calls** | **CLI** |
| `computeSharpe` | `(deps.stockAnalyticsRepo, deps.marketDataClient, positions, input) => Promise<SharpeResult>` ⚠️ one call per ticker | **CLI** |
| `listVolatilityCache` | `(repo) => VolatilityResult[]` | web only |
| `saveVolatilityCache` | `(repo, results) => void` | **CLI** |
| `clearVolatilityCache` | `(repo) => void` | web only |
| `getCorrelationCache` | `(repo) => CorrelationResult \| undefined` | web only |
| `clearCorrelationCache` | `(repo) => void` | web only |
| `getSharpeCache` | `(repo) => SharpeResult \| undefined` | web only |

`computeSharpe` validates with `computeSharpeInputSchema` — `riskFreeRate` (0–1,
default 0.05) and `lookbackDays` (default 365), both optional. Correlation throws with
fewer than 2 eligible Stock/ETF positions. `MARKET_BENCHMARK_TICKER = "SPY"`.

Pure stats re-exported from the same barrel: `dailyReturns`, `dailyLogReturns`,
`pearsonCorrelation`, `computeVolatilityStats`, `classifyVolatility`,
`computeRangePositionPct`, `alignSeriesByTimestamp`, `computePortfolioWeights`,
`computePortfolioDailyReturns`, `annualizeReturn`, `dailyRiskFreeRate`,
`annualizeStdDev`, `computeSharpeRatio`, `lookbackDaysToYahooRange`.

## stock-watchlist — `@/lib/stock-watchlist`

Repo is `deps.stockWatchListRepo`. **No CLI reach.**

| Use-case | Signature | Zod |
|---|---|---|
| `listWatchLists` | `(repo) => StockWatchList[]` | — |
| `createWatchList` | `(repo, input) => StockWatchList` | `createWatchListSchema` |
| `renameWatchList` | `(repo, id, input) => StockWatchList` | `renameWatchListSchema` |
| `deleteWatchList` | `(repo, id) => void` | — |
| `listItems` | `(repo, watchListId) => StockWatchListItem[]` | — |
| `addItem` | `(repo, deps.marketDataClient, input) => Promise<StockWatchListItem>` ⚠️ snapshots live price | `addWatchListItemSchema` |
| `updateItemReminder` | `(repo, id, input) => StockWatchListItem` | `updateWatchListItemReminderSchema` |
| `deleteItem` | `(repo, id) => void` | — |

`StockWatchListItem { id, watchListId, ticker, shares, priceWhenAddedCents, addedDate, reminderAt?, reminderMessage, createdAt, updatedAt }`

## ticker-favorites — `@/lib/ticker-favorites`

Repo is `deps.tickerFavoriteRepo`. **No network anywhere in this module. No CLI reach.**

| Use-case | Signature | Zod |
|---|---|---|
| `listFavorites` | `(repo) => TickerFavorite[]` — newest first | — |
| `listFavoriteTickers` | `(repo) => string[]` — symbols only | — |
| `isFavorite` | `(repo, ticker) => boolean` — normalizes; never throws | — |
| `toggleFavorite` | `(repo, ticker) => boolean` — returns the state it landed in | `favoriteTickerSchema` |
| `addFavorite` | `(repo, ticker) => boolean` — idempotent; `false` = already starred | `favoriteTickerSchema` |
| `removeFavorite` | `(repo, ticker) => boolean` — idempotent; `false` = wasn't starred | `favoriteTickerSchema` |

`TickerFavorite { ticker, createdAt }`

`addFavorite`/`removeFavorite` exist *for* a CLI: a toggle is the wrong primitive for a
caller that knows what it wants, since `favorite add AAPL` run twice should leave the
symbol starred. The obvious command trio is `favorites list|add|remove`.

## ticker-search — `@/lib/ticker-search`

**Pure — no repo, no network.** The caller supplies the three ticker lists; this module
only merges and matches. **No CLI reach.**

| Use-case | Signature | Zod |
|---|---|---|
| `collectKnownTickers` | `({ positionTickers, watchListTickers, profileTickers }) => KnownTicker[]` — deduped, strongest source per symbol, alphabetical | — |
| `matchTickers` | `(known, query, limit = 8) => TickerSuggestion[]` — substring; prefix hits first, then source, then alphabetical | `tickerQuerySchema` (at the boundary) |
| `isKnownTicker` | `(known, query) => boolean` — exact, normalized | — |
| `normalizeQuery` | `(query) => string` — trim + upper-case | — |

`KnownTicker { ticker, source: "position" | "watchlist" | "profile" }`
`TickerSuggestion extends KnownTicker { isPrefixMatch }`

The three source lists come from `deps.stockPositionRepo`, `deps.stockWatchListRepo` and
`deps.tickerProfileRepo` — assembled by the caller, which is what keeps this module pure
and testable without any of the three.

## stock-daily-snapshot — `@/lib/stock-daily-snapshot`

Repo is `deps.stockDailySnapshotRepo`. **No network anywhere in this module. No CLI reach.**

| Use-case | Signature |
|---|---|
| `computeDailySnapshot` | `(positions, snapshotDate) => UpsertDailySnapshotInput & { totalValueCents, totalGainLossCents }` — pure, no clock |
| `captureDailySnapshot` | `(repo, positions, snapshotDate = todayIsoLocal()) => DailySnapshot` — `upsertDailySnapshotSchema`; upserts that day |
| `listSnapshots` | `(repo, range?: { fromDate, toDate }) => DailySnapshot[]` — `snapshotRangeSchema` |
| `getSnapshot` | `(repo, snapshotDate) => DailySnapshot \| undefined` |
| `deleteSnapshot` | `(repo, snapshotDate) => void` |
| `summarizeSnapshotPeriod` | `(snapshots, fromDate?, toDate?) => PeriodSummary` — pure |
| `summarizeToDate` | `(yearSnapshots, asOfDate = todayIsoLocal()) => { week, month, year }` — pure |
| `snapshotBucketFor` / `snapshotChangePct` | pure |

`captureDailySnapshot` is the obvious nightly-scheduler candidate and is currently
web-only.

## stock-dashboard — `@/lib/stock-dashboard`

No repo, no network — layout preference encoding only. Persistence goes through
module-settings. **No CLI reach** (and little reason for one).

`defaultDashboardWidgets()`, `resolveDashboardWidgets(settings)`,
`dashboardWidgetsToEntries(input)` (`dashboardWidgetsSchema` — must list every widget
exactly once), `moveDashboardWidget(prefs, id, "up"|"down")`,
`toggleDashboardWidget(prefs, id)`, `visibleDashboardWidgets(prefs)`.

Widget ids: `refresh`, `summary`, `glance`, `statistics`, `allocationType`, `allocationStrategy`.

## investment-accounts — `@/lib/investment-accounts`

Repo is `deps.investmentAccountRepo`. No network. **No CLI reach.**

| Use-case | Signature | Zod |
|---|---|---|
| `listAccounts` | `(repo) => InvestmentAccount[]` | — |
| `getAccountById` | `(repo, id) => InvestmentAccount \| undefined` | — |
| `createAccount` | `(repo, input) => InvestmentAccount` | `createInvestmentAccountSchema` |
| `updateAccount` | `(repo, id, input) => InvestmentAccount` | `updateInvestmentAccountSchema` |
| `deleteAccount` | `(repo, id) => void` | — |
| `listPerformanceRecords` | `(repo, accountId?) => PerformanceRecord[]` | — |
| `addPerformanceRecord` | `(repo, input) => PerformanceRecord` | `createPerformanceRecordSchema` |
| `updatePerformanceRecord` | `(repo, id, input) => PerformanceRecord` | `updatePerformanceRecordSchema` |
| `deletePerformanceRecord` | `(repo, id) => void` | — |
| `setAccountIcon` | `(repo, id, input: ImageUploadInput) => void` — 128 KiB cap | `imageUploadSchema` |
| `clearAccountIcon` | `(repo, id) => void` | — |
| `getAccountIcon` | `(repo, id) => AccountIcon \| undefined` — **Buffer** | — |
| `extractCsvAccountNames` | `(fileText, columnMapping) => string[]` — pure | — |
| `importPerformanceFromCsv` | `(repo, fileText, columnMapping, accountNameMapping, fieldOptions = {}, excludedRowIndexes = []) => ImportSummary` | via `createPerformanceRecordSchema` |
| `buildAccountPerformanceHistory` | `(entries) => AccountPerformanceHistory` — pure | — |

`InvestmentAccount { id, name, description, initialValueCents, lastValueCents?, lastUpdatedAt?, iconMimeType?, createdAt, updatedAt }`

## market-data — `@/lib/market-data`

Client is `deps.marketDataClient`. **Both use-cases hit Yahoo Finance. No CLI reach.**

| Use-case | Signature | Zod |
|---|---|---|
| `lookupQuote` | `(client, ticker: string) => Promise<Quote>` ⚠️ | `tickerSchema` |
| `getPriceHistory` | `(client, ticker, range, interval) => Promise<PricePoint[]>` ⚠️ | `historyRequestSchema` |

`range`/`interval` use Yahoo's vocabulary (`"1y"`, `"1d"`).
`Quote { ticker, priceCents, previousCloseCents, shortName?, dayHighCents, dayLowCents, dividendRateCents }`
`PricePoint { timestamp, closeCents, volume? }` — timestamp is epoch **seconds**.

`YahooFinanceClient` implements `MarketDataClient`, `MarketEventsClient`, and
`QuoteSummaryClient`, so `deps.marketDataClient` is passable wherever any of the three
is required.

## ticker-overview — `@/lib/ticker-overview`

The only module with a multi-repo deps object, and the only one with reversed argument order.

| Use-case | Signature | Zod | Status |
|---|---|---|---|
| `getTickerOwnData` | `(input: { ticker }, deps: { positions, accounts, watchLists })` — **`(input, deps)`, reversed** | `tickerOverviewSchema` | **CLI** |
| `getTickerQuote` | `(deps.marketDataClient, { ticker }) => Promise<TickerQuote>` ⚠️ 1 call | `tickerOverviewSchema` | **CLI** |
| `getTickerPriceSeries` | `(deps.marketDataClient, { ticker, range? }) => Promise<TickerPriceSeries>` ⚠️ 1 call | `tickerPriceSeriesSchema` | web only |
| `getTickerRisk` | `(deps.marketDataClient, deps.tickerRiskCacheRepo, { ticker, refresh? }) => Promise<TickerRisk>` ⚠️ 2 calls **on cache miss or `refresh`** | `tickerRiskSchema` | **CLI** |
| `getTickerEvents` | `(events, marketData, { ticker }) => Promise<TickerEventFeed>` ⚠️ 2 calls — **both args satisfied by `deps.marketDataClient`** | `tickerOverviewSchema` | **CLI** |
| `getTickerNewsFeed` | `(deps.tickerNewsClient, { ticker, limit? }, today = todayIsoLocal()) => Promise<TickerNewsFeed>` ⚠️ 1 call | `tickerNewsFeedSchema` (limit default 10, max 25) | **CLI** |
| `getTickerTradeTimeline` | `({ marketData, news?, events? }, transactions, { ticker }, today?) => Promise<TickerTradeTimeline>` ⚠️ up to 3 calls | `tickerOverviewSchema` | web only |

Risk cache rows **never expire** — pass `refresh: true` to recompute. The trade timeline
makes zero calls when the ticker has no transactions, and the caller supplies
`transactions` (the DB read is the caller's job).

Pure helpers: `summarizeHoldings`, `summarizeIncome`, `summarizeTrades`,
`computeWatchDrift`, `toClosePoints`, `closeOnOrBefore`, `summarizePriceSeries`,
`rankStories`, `describeMarketEvent`, `buildTickerEvents`, `transactionDate`,
`historyRangeCovering`, `buildTradeTimeline`.
`TICKER_HISTORY_RANGES = ["1mo","3mo","6mo","1y","5y"]`

## ticker-detail — `@/lib/ticker-detail`

No `schema.ts` — reuses `tickerOverviewSchema`. **No CLI reach.**

| Use-case | Signature |
|---|---|
| `getTickerDetail` | `(deps.marketDataClient, { ticker }) => Promise<TickerYahooDetail>` ⚠️ one authenticated `quoteSummary` round-trip covering all six sections; throws on provider failure |
| `buildTickerDetail` | `(ticker, raw: RawQuoteSummary, fetchedAt = new Date().toISOString()) => TickerYahooDetail` — pure, testable against a fixture |

`TickerYahooDetail { ticker, fetchedAt, marketData?, profile?, analysis?, valuation?, financials?, keyStatistics? }` — **every section and nearly every field is optional.**

## ticker-news — `@/lib/ticker-news`

Client is `deps.tickerNewsClient`. **No CLI reach** (though `ticker-overview --market`
reaches the same provider via `getTickerNewsFeed`).

| Use-case | Signature |
|---|---|
| `getTopStory` | `(client, ticker, today = todayIsoLocal()) => Promise<TopNewsStory \| undefined>` ⚠️; `newsTickerSchema`. `undefined` means no news; throws on provider failure |
| `pickTopStory` / `isPrimarySubject` | pure |

## ticker-logos — `@/lib/ticker-logos`

No `schema.ts` — regex validation. **No CLI reach.**

`getOrFetchTickerLogo(deps.tickerLogoRepo, deps.tickerLogoClient, rawTicker, nowMs = Date.now()) => Promise<TickerLogoImage | undefined>`
⚠️ hits Financial Modeling Prep, but **only on a cache miss or a negative entry older
than 30 days**. Returns `undefined` for both "no logo" and a network failure; failures
aren't cached. **Returns a Buffer.**

Pure: `normalizeTicker`, `isValidTicker` (`/^[A-Z0-9.\-]{1,15}$/`), `isAcceptableLogo`.
`MAX_LOGO_BYTES = 256 KB`.

## next-day-actions — `@/lib/next-day-actions`

**No CLI reach** — another strong scheduler candidate.

| Use-case | Signature |
|---|---|
| `runScan` | `(deps.stockPositionRepo, deps.marketDataClient, thresholds) => Promise<NextDayActionSignal[]>` ⚠️ **one 1mo/1d history call per position with shares > 0**, in parallel; a per-ticker failure degrades that one to a two-check evaluation. Sorted most-urgent first |
| `resolveThresholds` | `(settings: ModuleSetting[]) => NextDayActionThresholds` — pure; defaults 20 / 10 / 25 |
| `thresholdsToEntries` | `(input) => { key, value }[]` — `nextDayActionThresholdsSchema` |
| `computeScanStats` / `evaluatePosition` | pure |

`NextDayActionType = "StopLoss" | "TrimProfit" | "Rebalance" | "StrongBuy" | "Hold"`
`NextDayActionThresholds { profitTargetPct, stockConcentrationCapPct, etfConcentrationCapPct }`

## daily-quote — `@/lib/daily-quote`

Repo is `deps.dailyQuoteRepo`. No network. **No CLI reach.**

| Use-case | Signature | Zod |
|---|---|---|
| `listQuotes` | `(repo) => DailyQuote[]` | — |
| `getQuoteById` | `(repo, id) => DailyQuote \| undefined` | — |
| `getRandomQuote` | `(repo) => DailyQuote \| undefined` | — |
| `createQuote` | `(repo, input) => DailyQuote` | `createQuoteSchema` |
| `updateQuote` | `(repo, id, input) => DailyQuote` | `updateQuoteSchema` |
| `deleteQuote` | `(repo, id) => void` | — |
| `parseThreeTwoOneNewsletter` | `(text: string) => ParsedNewsletter` — pure; takes a pasted email body | — |

`QUOTE_CATEGORIES = ["Motivation","Inspiration","Wisdom","Success","Happiness","Life","Humor","Love"]`

## weather — `@/lib/weather`

`getCurrentWeather(deps.weatherClient, input) => Promise<CurrentWeather>` ⚠️ Open-Meteo,
no API key. `getCurrentWeatherSchema` — latitude −90..90, longitude −180..180, `unit`
defaults to `"fahrenheit"`. **No CLI reach.**

`CurrentWeather { temperature, unit, description, code }`

## geocoding — `@/lib/geocoding`

Client is `deps.geocodingClient`. **Both hit OpenStreetMap Nominatim** — no API key, but
mind their usage policy. **No CLI reach.**

| Use-case | Signature | Zod |
|---|---|---|
| `searchPlaces` | `(client, input) => Promise<GeoPlace[]>` ⚠️ | `searchPlacesSchema` (limit 1..10, default 5) |
| `reverseGeocode` | `(client, input) => Promise<GeoPlace \| undefined>` ⚠️ | `reverseGeocodeSchema` |

`GeoPlace { latitude, longitude, displayName }`

## viewport — `@/lib/viewport`

Pure, no repo, no network. `viewportForWidth(width)`, `viewportFromUserAgent(deviceType)`,
`resolveViewport({ cookieValue?, deviceType? })`, `correctionForWidth({ current, width, pinned })`.
`VIEWPORT_BREAKPOINT_PX = 1024`; `Viewport = "compact" | "full"`.

## shared — no barrel, deep paths only

There is no `src/lib/shared/index.ts`; import `@/lib/shared/<file>`.

| Path | Exports |
|---|---|
| `@/lib/shared/date` | `toIsoDateLocal(Date)`, `todayIsoLocal(now = new Date())`, `parseIsoDateLocal` → `Date`, `startOfWeekIso`, `startOfMonthIso`, `startOfYearIso` |
| `@/lib/shared/money` | `dollarsToCents`, `centsToDollars`, `formatCents` — **CLI** (used by `ticker-overview`) |
| `@/lib/shared/csv` | `parseCsvLine`, `parseCsvRecords`, `parseCsv` |
| `@/lib/shared/table` | `compareValues`, `sortRows`, `matchesSearch`, `parseFilterExpression`, `matchesFilter`, `aggregate`, `computePageSlice`, `toCsvField`, `toCsv` |
| `@/lib/shared/image-upload` | `decodeImageUpload(input, maxBytes)` → **Buffer**, `imageUploadSchema`, `IMAGE_UPLOAD_MIME_TYPES` |
| `@/lib/shared/chart-options` | `resolvePointLabelMode`, `isPointLabelModeCapped`, `selectLabeledIndexes`, `parseChartDisplay`, `serializeChartDisplay` |
| `@/lib/shared/password` | `hashPassword`, `verifyPassword` |
| `@/lib/shared/secret` | `secureCompare` |

---

# Part 3 — Coverage

| | Count |
|---|---|
| Exported use-cases across `src/lib/` | ~227 |
| Reachable from the CLI | ~25 |
| Registered commands | 12 |
| **Coverage** | **~13%** |

**Modules with zero CLI reach (18):** `auth`, `change-history`, `daily-quote`,
`geocoding`, `investment-accounts`, `market-data`, `module-settings`, `modules`,
`next-day-actions`, `sql-explorer`, `stock-daily-snapshot`, `stock-watchlist`,
`system-info`, `ticker-detail`, `ticker-favorites`, `ticker-logos`, `ticker-search`,
`weather`.
(`stock-dashboard` and `viewport` are pure preference/layout helpers — no CLI needed.)

[ARCHITECTURE.md:119-121](ARCHITECTURE.md#L119-L121) states that "every use-case is
reachable from both." At ~13%, that's currently aspirational rather than descriptive.
The architecture does support closing the gap — [ARCHITECTURE.md:148](ARCHITECTURE.md#L148)
makes it a rule that adding a CLI command for an existing use-case requires **zero
changes to `lib/`**.

## What blocks a generic `call <module>.<useCase> '<json>'` runner

Most use-cases would work under a generic JSON-argument runner. These wouldn't:

**Buffer in or out** — `user.getUserAvatar`, `user.setUserAvatar`,
`modules.getModuleCarouselImage`, `expense.getAccountImage`, `expense.getCategoryIcon`,
`investment-accounts.getAccountIcon`, `ticker-logos.getOrFetchTickerLogo`.
Image *uploads* are fine: `ImageUploadInput` carries base64 as a string.

**Callback or `Date` arguments** — `stock-positions.computeAllocation` (`label`),
`expense.runAutoImport` (`dependencies.now`), `csv-import.sampleRows` (`random`),
`settings.formatDeploymentMessage` (`publishedAt: Date`).

**Multi-dep signatures** needing a hand-written wiring line rather than one repo lookup:
`refreshPosition`, `refreshAllPositions`, `computeCorrelationMatrix`, `computeSharpe`,
`stock-watchlist.addItem`, `getTickerRisk`, `getTickerEvents`, `getOrFetchTickerLogo`,
`runScan` (two each); `getTickerOwnData` (a 3-repo object);
`getTickerTradeTimeline` (a 3-client object); `expense.runAutoImport`
(an `AutoImportDependencies` object).

**Large file-text arguments** are technically JSON-safe strings but are far better read
from a path: every `import*FromCsv`, `previewCsvFile`, `previewCsv`,
`extractCsvAccountNames`, `parseThreeTwoOneNewsletter`, `parseEnvFile`,
`summarizeChangeHistory`.

---

## `scan-music`

Walks the music folder on the NAS and catalogs what it finds. **The command to use for
the first scan of a large library** — reading tags across 20k files takes minutes, which
is normal for a terminal job over SSH and impossible inside an HTTP request. Afterwards
the web button is better: unchanged files are skipped, so a re-scan takes seconds.

```
npm run cli -- scan-music
npm run cli -- scan-music CHINESE
npm run cli -- scan-music CHINESE --limit 500
npm run cli -- scan-music "CLASSICAL/Chinese Instruments" --formats flac
npm run cli -- scan-music --include-unplayable --no-prune
```

**Input** — an optional folder relative to `MYHOMEBASE_MUSIC_ROOT` (omitted scans
everything). `--formats mp3,flac` overrides the saved Configuration allowlist.
`--limit N` stops after N files and reports the rate, which is how you turn "how long
will this take" into a measurement before committing to a full run.
`--include-unplayable` catalogs APE and WMA, which no browser can decode — off by
default. `--no-prune` keeps catalog rows whose files have vanished from disk.

**Calls** — `scanLibrary` on `deps.musicRepo`, `deps.musicFileStore` and
`deps.musicMetadataReader`.

**Output** — a live line showing the percentage, the file count and the file currently
being read, then a summary: added, updated, skipped, failed, elapsed and files/sec. With
`--limit`, an extrapolation to a full 20,000-file scan.
**Exit** — 0; 1 when `MYHOMEBASE_MUSIC_ROOT` is unset, a `--formats` value is not a
known audio extension, `--limit` is not a positive integer, or the scan fails outright.
Progress is written to `mus_scan_runs`, so the web Scan Music screen shows a CLI run too.
Source: [src/cli/scan-music.ts](src/cli/scan-music.ts)

---

## `music-library`

Prints what is in the catalog — the terminal counterpart of the Library screen.

```
npm run cli -- music-library
npm run cli -- music-library --search beyond --limit 40
npm run cli -- music-library --unplayable
```

**Input** — `--search <term>` matches title, artist, album or filename;
`--limit N` defaults to 20; `--unplayable` shows only the formats a browser cannot
decode, which is how you find what would need converting to FLAC.

**Calls** — `countTracks`, `countLyricsByStatus`, `listAlbums`, `searchTracks` on
`deps.musicRepo`. Read-only.

**Output** — track and album totals, the cached-lyrics breakdown by status, then one
line per track: a `!` marker for unplayable formats, duration, extension, title and
artist.
**Exit** — always 0.
Source: [src/cli/scan-music.ts](src/cli/scan-music.ts)

---

## `magic-playlist`

Builds a Magic Playlist from selection criteria — the terminal counterpart of the Magic
Playlist screen.

```
npm run cli -- magic-playlist [--genre G]... [--artist A]... [--album ID]...
                              [--minutes N] [--any] [--include-unplayable]
                              [--save "Name"] [--description "..."]
npm run cli -- magic-playlist --list
npm run cli -- magic-playlist --load <id>
npm run cli -- magic-playlist --regenerate <id>
npm run cli -- magic-playlist --delete <id>

npm run cli -- magic-playlist --genre Rock --genre Pop --minutes 60
npm run cli -- magic-playlist --artist "Michael Jackson" --artist "Luther Vandross" --any
npm run cli -- magic-playlist --genre Jazz --minutes 90 --save "Sunday morning"
```

A **repeated flag** is how a multi-select arrives: `--genre Rock --genre Pop` is one
OR-group. Groups are combined with AND — `(Rock or Pop) and (that artist)` — and `--any`
switches the whole predicate to OR. Tracks with no duration tag are never candidates, and
unplayable formats are excluded unless `--include-unplayable` is passed.

`--save` stores the criteria *and* the set just generated, so `--load` replays that set
while `--regenerate` draws a new one from the same criteria.

**Calls** — `generateMagicPlaylist`, `saveMagicList`, `loadMagicList`,
`regenerateMagicList`, `listMagicLists`, `deleteMagicList` and `countMagicCandidates` on
`deps.magicListRepo` and `deps.magicCandidateSource`. `Math.random` is injected by the
command, not defaulted in the library.

**Output** — the criteria, the eligible-track count, the numbered playlist with running
times, then the total against the target and the library's own one-line explanation of how
it went (the same wording the web screen shows).
**Exit** — 0; 1 when `--minutes` is not a number, the target is outside 1 minute–12 hours,
a named list already exists, or the requested list id does not exist.
Source: [src/cli/magic-playlist.ts](src/cli/magic-playlist.ts)

---

## `play-queue`

Reads and changes the stored play queue — the terminal counterpart of the Queue screen.

```
npm run cli -- play-queue                          # show the queue
npm run cli -- play-queue --add 123 [--add 456]     # append tracks
npm run cli -- play-queue --set 123 [--set 456]     # replace the queue
npm run cli -- play-queue --play <entryId>          # jump to an entry
npm run cli -- play-queue --next [--auto]
npm run cli -- play-queue --previous
npm run cli -- play-queue --shuffle
npm run cli -- play-queue --remove <entryId>
npm run cli -- play-queue --repeat off|all|one
npm run cli -- play-queue --clear
```

It cannot make a sound — the `<audio>` element is in the browser. What it changes is the
**stored** queue, which since [migration 0059](migrations/0059_create_music_play_queue.md)
is the whole of the queue's state, so `--next` really does move the cursor and the web
player sees it on its next read.

`--add`/`--set` take **track** ids; `--play`/`--remove` take **entry** ids (printed in the
listing). The distinction matters because the queue may hold the same track twice, and an
entry id is what names the second copy.

`--next` behaves like the Next *button*; `--next --auto` behaves like a track *ending*.
They differ only under `--repeat one`, where the button skips onward and a track ending
replays — see `nextEntryId` in [src/lib/music/queue.ts](src/lib/music/queue.ts).

**Calls** — `getPlayQueue`, `setQueue`, `enqueueTracks`, `playQueueEntry`, `advanceQueue`,
`rewindQueue`, `shuffleQueue`, `removeQueueEntry`, `clearQueue` and `setRepeatMode` on
`deps.musicRepo`. `Math.random` is injected by the command, not defaulted in the library.

**Output** — the numbered queue with entry ids, durations and a `>` on the playing row,
then the track count, total and remaining time, and the repeat/shuffle state.
**Exit** — 0; 1 when a flag is missing its value, an id is not a positive integer, or
`--repeat` is given a mode other than `off`, `all` or `one`.
Source: [src/cli/play-queue.ts](src/cli/play-queue.ts)

---

## Known inconsistencies

- **Argument order.** `auth` and `user` take the repo **last**; every other module takes
  it first; `getTickerOwnData` takes `(input, deps)`.
- **Zod validation is skipped by most existing commands.** [src/cli/index.ts:2-3](src/cli/index.ts#L2-L3)
  says each command "parses args, validates with the module's zod schema, calls a lib
  use-case, and prints," but most pass raw `parseFlags` strings straight through and
  rely on the use-case validating internally. That mostly works — most use-cases do
  validate — but it isn't what the header claims.
- **No CLI tests.** [ARCHITECTURE.md:262](ARCHITECTURE.md#L262) says the CLI adapter is
  exercised for arg-parsing and exit codes; there are no test files under `src/cli/`.
- **`compute-analytics` always exits 0**, even when a leg fails — check stderr if you
  schedule it.
- **Usage-string style differs.** [explain-rule.ts](src/cli/explain-rule.ts) documents
  itself as `npm run cli explain-rule -- --id 4231`; [ticker-overview.ts](src/cli/ticker-overview.ts)
  uses `npm run cli -- ticker-overview AAPL`. The latter is correct.
