# CLI registry

Reference for driving MyHomeBase from a terminal.

**Part 1** documents the 59 commands that work today.
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

Fifty-eight commands, registered in [src/cli/index.ts](src/cli/index.ts).

The table below is the index — every command links to its own section. Those sections
are **not all contiguous**: the file grew by appending, so some sit after Part 2 and
Part 3. Use the links rather than scrolling, and add a new command's section at the end
alongside its row here.

| Command | Reads / writes | Network |
|---|---|---|
| [`list-users`](#list-users) | read | no |
| [`create-user`](#create-user) | write | no |
| [`list-csv-analytics`](#list-csv-analytics) | read | no |
| [`create-csv-analytics-entry`](#create-csv-analytics-entry) | write (creates a table) | no |
| [`delete-csv-analytics-entry`](#delete-csv-analytics-entry) | write (drops a table) | no |
| [`csv-bulk-edit`](#csv-bulk-edit) | read (`columns`/`rows`), write (`apply`) | no |
| [`csv-views`](#csv-views) | read (`list`/`show`/`read`/`operators`), write (`create`/`update`/`enable`/`disable`/`delete`) | no |
| [`import-csv-files`](#import-csv-files) | read (`plan`), write (`create`/`append`) | no |
| [`csv-source-stats`](#csv-source-stats) | read | no |
| [`import-journal-csv`](#import-journal-csv) | write | no |
| [`import-recipes-csv`](#import-recipes-csv) | write | no |
| [`import-journal-ics`](#import-journal-ics) | write (read with `--dry-run`/`--review`) | no |
| [`journal-bulk-edit`](#journal-bulk-edit) | write (read with `--dry-run`) | no |
| [`journal-calendar`](#journal-calendar) | read | no |
| [`journal-same-date`](#journal-same-date) | read (writes with `--delete`, `--lock`, or `--merge --save`) | no |
| [`journal-locations`](#journal-locations) | read + write | no |
| [`browse-sqlite`](#browse-sqlite) | read + write | no |
| [`browse-csv`](#browse-csv) | read + write | no |
| [`journal-taxonomy`](#journal-taxonomy) | read (writes with `--unused --delete`, or `--merge --apply`) | no |
| [`journal-templates`](#journal-templates) | read (writes with `set`/`enable`/`disable`/`delete`) | no |
| [`expense-top-spenders`](#expense-top-spenders) | read | no |
| [`explain-rule`](#explain-rule) | read | no |
| [`expense-create-rule`](#expense-create-rule) | write | no |
| [`normalize-icon-overrides`](#normalize-icon-overrides) | write (read with `--dry-run`) | no |
| [`resize-carousel-images`](#resize-carousel-images) | write (read with `--dry-run`) | no |
| [`refresh-positions`](#refresh-positions) | write | **yes** |
| [`run-scheduled-refresh`](#run-scheduled-refresh) | write (read with `--status`) | **yes** (not with `--status`) |
| [`list-scheduled-jobs`](#list-scheduled-jobs) | read | no |
| [`compute-analytics`](#compute-analytics) | write | **yes** |
| [`ticker-overview`](#ticker-overview) | read (`--refresh` writes cache) | with `--market` |
| [`simulate-ticker`](#simulate-ticker) | read (writes nothing) | **yes** |
| [`market-indexes`](#market-indexes) | read (writes nothing) | **yes** |
| [`export-portfolio`](#export-portfolio) | read (`--refresh-correlations` writes cache) | only with `--refresh-correlations` |
| [`consult-ticker`](#consult-ticker) | read (writes nothing) | **yes** (not with `--no-quote`) |
| [`favorite-quotes`](#favorite-quotes) | read | no |
| [`tax-lots`](#tax-lots) | read (writes with `--save`) | no |
| [`set-startup-message`](#set-startup-message) | write | no |
| [`user-preferences`](#user-preferences) | read (writes with `--favorite`/`--startup`) | no |
| [`calculator`](#calculator) | read (writes with `--expression`/`--clear-history`) | no |
| [`scratchpad`](#scratchpad) | read (writes with `--new`/`--save`/`--delete`/`--add-category`/`--rename-category`/`--delete-category`) | no |
| [`magic-playlist`](#magic-playlist) | read (writes with `--save`/`--regenerate`/`--delete`) | no |
| [`photo-magic`](#photo-magic) | read (writes with `--scan`/`--save`/`--regenerate`/`--delete`/`--clear-index`) | no |
| [`play-queue`](#play-queue) | read (writes with every flag except none) | no |
| [`color-themes`](#color-themes) | read (writes with `import`/`reset`/`delete`) | no |
| [`fav-photos`](#fav-photos) | read (writes with `add`/`note`/`remove`) | no |
| [`game-scores`](#game-scores) | read | no |
| [`deployments`](#deployments) | read (writes with `delete`/`prune`) | no |
| [`ticker-monitors`](#ticker-monitors) | read (writes with `add`/`enable`/`disable`/`delete`/`run`) | no |
| [`messages`](#messages) | read (writes with `read`/`read-all`/`file`/`delete`/`prune`) | no |
| [`watch-lists`](#watch-lists) | read (writes with `add`/`watch`/`run`) | no |
| [`saved-sql`](#saved-sql) | read (writes with `save`/`delete`) | no |
| [`take-attendance`](#take-attendance) | write | no |
| [`attendance-report`](#attendance-report) | read | no |
| [`scan-music`](#scan-music) | write | no (reads the music share) |
| [`music-library`](#music-library) | read | no |
| [`recipes`](#recipes) | read (writes with `--add`/`--made`/`--delete`) | no |
| [`hsa`](#hsa) | read (writes with `--add`/`--reimburse`/`--delete`/the card flags) | no |
| [`todo`](#todo) | read (writes with `--add`/`--done`/`--delete`/the list flags) | no |
| [`menu-items`](#menu-items) | read (writes with `set`/`reset`) | no |
| [`toolbars`](#toolbars) | read (writes with `add`/`set`/`delete`/the item flags) | no |

Flag parsing is `--key value` pairs via [parse-flags.ts](src/cli/parse-flags.ts),
except `ticker-overview` and `set-startup-message`, which read positionals and bare
switches. `simulate-ticker` uses both — a leading positional ticker plus `--key value`
flags.

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

## `csv-bulk-edit`

Applies the same value to the same columns across many rows of one dataset — the same
use-case the Dashboard's Data card drives, per ARCHITECTURE.md's rule that a use-case is
callable from both places. Three subcommands: `columns` and `rows` read, `apply` writes.

```
npm run cli -- csv-bulk-edit columns --entry 3
npm run cli -- csv-bulk-edit rows --entry 3 --limit 20
npm run cli -- csv-bulk-edit apply --entry 3 --rows 4,5,6 --set "city=Oslo" --set "amount=100"
npm run cli -- csv-bulk-edit apply --entry 3 --all --set "processed=1"
npm run cli -- csv-bulk-edit apply --entry 3 --rows 4 --clear notes
```

**Input** — `--entry <id>` (required, all three). `rows` takes `--limit <n>`. `apply`
takes either `--rows <id,id,…>` or `--all`, plus `--set "col=value"` (repeatable, once
per column) and/or `--clear <col>` to write NULL.

**`--rows` takes SQLite rowids, not row positions** — the ones `rows` prints in its first
column, and the same handle the grid uses. A rowid is the only stable identifier for a
row: the declared columns are not necessarily unique, and position in a result set is not
stable across reads. See `CsvEntryData.rowIds`.

`--set` repeats, so it is re-scanned from argv directly rather than read from
`parseFlags`, which keeps only the last occurrence of a key — the same approach
`csv-views` uses for `--where`. `--clear col` and `--set col=` do the same thing; both
exist because an empty `--set` is easy to write by accident.

**Calls** — `getEntryById`, `readEntryData` and `nonEditableColumns` for the two read
subcommands; `bulkEditRows(deps.csvAnalyticsRepo, entryId, rowIds, changes)` for `apply`.

**Output** — `columns` prints the entry header then one line per column with its type and
source header, marking the ones that can't be written. `rows` prints a tab-separated
table headed `rowid`, then `N of M row(s)`. `apply` reports how many rows were written
and which columns were set.

**Exit** — 0; 1 on a missing or non-integer `--entry`, an id that doesn't exist, no
selection (`--rows` and `--all` both absent), no changes, or a column that can't be
written. Prints usage with no subcommand.
Source: [src/cli/csv-bulk-edit.ts](src/cli/csv-bulk-edit.ts)

---

## `import-journal-csv`

Imports journal entries from a CSV, using either a saved mapping or auto-mapped headers.

```
npm run cli -- import-journal-csv --file ./journal.csv
npm run cli -- import-journal-csv --file ./journal.csv --mapping "Day One export"
npm run cli -- import-journal-csv --file ./journal.csv --allow-duplicates
```

**Input**

| Flag | Type | Required | Notes |
|---|---|---|---|
| `--file` | path | yes | |
| `--mapping` | string | no | name of a saved `Journal` mapping; auto-maps from headers when omitted |
| `--allow-duplicates` | boolean | no | import rows that already exist; **off** by default, so a re-run is a no-op |

**Calls** — `listNamedMappings(deps.csvImportMappingRepo, "Journal")` or
`autoMapJournalHeaders(parseCsv(fileText).headers)`, then
`importJournalCsv(deps.journalRepo, …, { skipDuplicates })`.

**Output** — a count plus a line per skipped row:

```
Imported 118, skipped 2.
  Row 44: missing date
  Row 91: Duplicate of an existing entry
```

Best-effort by design: a bad row is skipped and reported, not fatal.

**Idempotent by default** (migration 0072). An entry already exists when its
date, time and title all match — content is not compared, so a re-export with
reflowed body text does not import a second copy. Nothing is ever *updated*: a
match is declined, not overwritten. `--allow-duplicates` turns the check off for
a file that deliberately holds another copy of something.
**Exit** — 0; 1 on missing `--file`, an unknown mapping name, or a read failure.
Source: [src/cli/import-journal-csv.ts](src/cli/import-journal-csv.ts)

---

## `import-recipes-csv`

Imports recipes from a CSV, using either a saved mapping or auto-mapped headers.
The Household counterpart of `import-journal-csv`, sharing its flags, its
mapping store and the `CsvImportPanel` the web screen is built from.

```
npm run cli -- import-recipes-csv --file ./recipes.csv
npm run cli -- import-recipes-csv --file ./recipes.csv --mapping "Paprika export"
npm run cli -- import-recipes-csv --file ./recipes.csv --overwrite
```

**Input**

| Flag | Type | Required | Notes |
|---|---|---|---|
| `--file` | path | yes | |
| `--mapping` | string | no | name of a saved `Recipe` mapping; auto-maps from headers when omitted |
| `--allow-duplicates` | boolean | no | import rows whose name already exists; **off** by default, so a re-run is a no-op |
| `--overwrite` | boolean | no | replace a matched recipe in place instead of skipping it; takes precedence over `--allow-duplicates` |

**Calls** — `listNamedMappings(deps.csvImportMappingRepo, "Recipe")` or
`autoMapRecipeHeaders(parseCsv(fileText).headers)`, then
`importRecipesCsv(deps.householdRepo, …, { skipDuplicates, overwrite })`.

**Output** — a count plus a line per skipped row:

```
Imported 41, updated 0, skipped 2.
  Row 18: no Name column mapped, or its cell was empty
  Row 33: A recipe with this name already exists
```

Best-effort by design: a bad row is skipped and reported, not fatal.

**Idempotent by default.** A recipe already exists when its **name** matches,
ignoring case — a recipe has no date to match on, so the name is the key. Only
`Name` must be mapped; it is both required and the match key, which is why a
nameless row is skipped rather than imported as an untitled recipe.

`--overwrite` is destructive and unattended: the web screen shows a plan and
confirms first, but typing the flag *is* the confirmation here. It replaces the
whole recipe, so a blank cell clears that field — the **picture is kept**,
because it is not a column the update writes.

Pictures cannot be imported. `Ingredients` and `Directions` are stored one item
per line; a saved mapping records what to split those columns on (the default
handles a literal `\n` in the cell).

**Exit** — 0; 1 on missing `--file`, an unknown mapping name, or a read failure.
Source: [src/cli/import-recipes-csv.ts](src/cli/import-recipes-csv.ts)

---

## `journal-locations`

Reads and writes the Journal's saved-location library — the same use-cases the Location
Manager section drives, so the two cannot diverge. Also the practical way to seed a
library in bulk: a shell loop over `--add` beats typing a hundred places into a form.

```
npm run cli -- journal-locations --list
npm run cli -- journal-locations --search "coffee"
npm run cli -- journal-locations --search "" --category "Restaurant" --tag "Weekend"
npm run cli -- journal-locations --add "Small World Coffee" --lat 40.3499 --lon -74.6593 --address "14 Witherspoon St" --category "Restaurant"
npm run cli -- journal-locations --update 4 --name "Small World" --lat 40.35 --lon -74.66
npm run cli -- journal-locations --delete 4
npm run cli -- journal-locations --promote --lat 40.1 --lon -74.2 --name "Grandma's" --entry-location 42
npm run cli -- journal-locations --find-duplicates
npm run cli -- journal-locations --find-duplicates 0.9
npm run cli -- journal-locations --merge 12 --into-from 34,56
npm run cli -- journal-locations --import-from-entries
npm run cli -- journal-locations --import-from-entries --no-addresses
npm run cli -- journal-locations --categories
npm run cli -- journal-locations --add-category "Trailhead" --description "Where a walk starts"
npm run cli -- journal-locations --delete-tag "Weekend"
```

**Input** — one mode flag per run, checked in the order below.

| Flag | Type | Notes |
|---|---|---|
| `--list` | boolean | Every saved place, with its usage count |
| `--search` | text | Matched against name, description **and** address. Pass `""` to filter by taxonomy alone |
| `--categories` / `--tags` | boolean | The managed lists, with how many places carry each |
| `--add` | name | Requires `--lat` and `--lon` |
| `--update` | id | **Replaces the whole row**, as the web form does — resubmit every field |
| `--delete` | id | Entries that used it keep their coordinates and detach |
| `--find-duplicates` | boolean or 0.6-1 | Reports near-duplicate groups. Optional name-similarity threshold, default 0.82. Read-only |
| `--merge` | id to keep | Needs `--into-from`. Repoints those entries onto the kept place, unions its categories/tags, deletes the rest — one transaction |
| `--into-from` | comma-separated ids | The places `--merge` folds away |
| `--promote` | boolean | Create a library row from a hand-dropped point; `--entry-location <id>` also points that entry row at it |
| `--import-from-entries` | boolean | Build the library from every coordinate already on an entry. Addresses are looked up by default; `--no-addresses` skips the geocoder and makes it near-instant. Idempotent — re-running only adds what is missing |
| `--add-category` / `--add-tag` | name | Upsert; `--description` optional |
| `--delete-category` / `--delete-tag` | name | Removes the row and its pairings; the places survive |
| `--lat` / `--lon` | number | Required by `--add`, `--update`, `--promote` |
| `--name`, `--description`, `--address` | text | Optional fields on a write |
| `--category` / `--tag` | comma-separated | `parseFlags` keeps only the last of a repeated key, so multiples go in one value: `--category "Restaurant,Cafe"` |

**Calls** — `listSavedLocations`, `searchSavedLocations`, `createSavedLocation`,
`updateSavedLocation`, `deleteSavedLocation`, `promoteToSavedLocation`,
`countImportCandidates` / `runImportBatch`, `saveLocationTaxonomy`,
`deleteLocationTaxonomy`, `countLocationsByCategory` / `countLocationsByTag` — all from
`src/lib/journal-locations`.

`--import-from-entries` loops `runImportBatch` and prints an `n of m places...` line per
batch — the terminal's version of the web modal's progress bar. The same use-case backs
both, so the grouping and the throttle cannot diverge between them.

**Output** — one place per line, id first (the id is what `--update`, `--delete` and an
entry's provenance reference, and a terminal has no other way to find it), then the name,
coordinates and usage count, with address, description and labels indented beneath.

Source: [src/cli/journal-locations.ts](src/cli/journal-locations.ts)

---

## `journal-calendar`

Prints the Journal calendar — the same grid the Calendar section draws, from the same
library functions.

```
npm run cli -- journal-calendar
npm run cli -- journal-calendar --scope week
npm run cli -- journal-calendar --scope year --date 2025-01-01
npm run cli -- journal-calendar --date 08/21/2026 --format MM/DD/YYYY
npm run cli -- journal-calendar --date 2026-07-28 --day
npm run cli -- journal-calendar --date 2026-01-01 --jump next
```

**Input**

| Flag | Type | Required | Notes |
|---|---|---|---|
| `--scope` | `month` \| `week` \| `year` | no | defaults to `month` |
| `--date` | date | no | any day in the period to show; defaults to today |
| `--format` | `MM/DD/YYYY` \| `DD/MM/YYYY` \| `YYYY-MM-DD` | no | how `--date` is read; defaults to `YYYY-MM-DD` |
| `--day` | boolean | no | also list `--date`'s entries in full. **Put it last** — `parseFlags` treats every flag as taking a value, so `--day --scope week` would swallow `--scope` |
| `--jump` | `prev` \| `next` | no | move to the nearest day **before/after** `--date` that has an entry, and list it — the web calendar's « » buttons. Applied after `--date`, so `--date 2026-01-01 --jump next` is "the first entry of the year" |

**Calls** — `findAdjacentEntryDate` when `--jump` is given, then `journalCalendarRange`,
then `listEntriesInDateRange(deps.journalRepo, …)`,
then `buildMonthGrid` / `buildWeekGrid` / `buildYearGrid`. `--date` is parsed by the same
`parseJumpDate` the web Jump box uses, so a date that works in one works in the other.

**Output** — the month/week grid as fixed-width columns, with `*` for today, `>` for the
selected day and `.` for a day borrowed from the neighbouring month; the year scope prints
a per-month count instead, since 12 grids of titles don't fit a terminal.

```
August 2026 — 14 entries

Sun           Mon           Tue           Wed           Thu           Fri           Sat
.26           .27           .28 (3)       .29           .30           .31             1
                             test123
```

This command is the calendar's layering check: the grid shape, the 30-character title
elision and the date parsing all come from `src/lib/journal`, so if it couldn't be printed
here the logic would have leaked into the view.
**Exit** — 0; 1 on an unknown `--scope`, an unknown `--format`, an unparseable `--date`, an
unknown `--jump`, or a `--jump` with no entry in that direction.
Source: [src/cli/journal-calendar.ts](src/cli/journal-calendar.ts)

---

## `journal-bulk-edit`

The Journal → Entries screen's bulk actions from the terminal: the same selection edit and
selection delete the grid's tick-boxes drive, on both the Main and Log tabs.

The three modes are three flag prefixes rather than one `--mode` switch, so a single
command can add tags *and* replace categories in one pass — exactly what the dialog's two
independent mode pickers allow. Only one mode per field: passing two is refused rather
than resolved by flag order.

**Locked entries are skipped by an edit and moved by `--delete`.** That asymmetry is
deliberate and matches the web app: the bin preserves `is_locked`, so a delete is
recoverable rather than a bypass, while an edit genuinely would be one.

```
npm run cli -- journal-bulk-edit --ids 41,42,43 --add-tags "Beach,Summer"
npm run cli -- journal-bulk-edit --ids 41,42 --remove-tags "Draft"
npm run cli -- journal-bulk-edit --ids 41,42 --set-tags "Beach"
npm run cli -- journal-bulk-edit --ids 41,42 --add-categories "Travel"
npm run cli -- journal-bulk-edit --ids 41,42 --set-categories ""
npm run cli -- journal-bulk-edit --ids 41,42 --place "Lisbon"
npm run cli -- journal-bulk-edit --ids 41,42 --add-tags "Beach" --dry-run
npm run cli -- journal-bulk-edit --ids 41,42 --delete
```

**Input**

| Flag | Type | Required | Notes |
|---|---|---|---|
| `--ids` | id list | **yes** | comma-separated entry ids — the ticked rows |
| `--add-tags` | name list | no | comma-separated; appended to what each entry already carries |
| `--remove-tags` | name list | no | stripped from the selection, case-insensitively |
| `--set-tags` | name list | no | **Replace** — overwrites outright. `--set-tags ""` clears the field |
| `--add-categories` | name list | no | as `--add-tags`, for categories |
| `--remove-categories` | name list | no | as `--remove-tags`, for categories |
| `--set-categories` | name list | no | as `--set-tags`, for categories |
| `--place` | string | no | sets `place_name` on every entry. An empty string clears it |
| `--dry-run` | boolean | no | print which entries would change and which are locked; write nothing. A bare flag, so put it last |
| `--delete` | boolean | no | move the selection to the recycle bin instead of editing it. A bare flag, so put it last |

**Calls** — `bulkEditEntries(deps.journalRepo, ids, changes)` for an edit and
`recycleEntries` for `--delete`, both the same library functions the web actions in
`journal-bulk-actions.ts` call. The summary line comes from `describeBulkEditResult`, so
the terminal and the web notice cannot disagree about what happened.

**Output** — one summary line, naming anything that didn't change:

```
Updated 12 entries. 3 were locked and skipped. 1 no longer exists.
```

Under `--dry-run`, the selection is listed first and nothing is written:

```
  #   41  2026-03-14  Morning run
  #   42  2026-03-14  Dinner with Anna  [locked — would be skipped]

Dry run — nothing written. 1 would change, 1 locked and skipped.
```

Date, time and title are deliberately **not** editable here or in the web dialog: they
identify an entry, and setting one across a selection would collapse rows the importer's
duplicate check treats as distinct.

## `journal-same-date`

The Journal → Review Data screen from the terminal: the dates carrying more than one
entry, plus the same Merge, Delete and Lock the web grid offers.

Locked entries are **excluded from the listing** — locking is how a settled date leaves
this screen in both front-ends — so an empty result can mean "all reviewed" rather than
"nothing to review". `--include-locked` is the way to see them again and find the id to
unlock; the web card has no such toggle.

```
npm run cli -- journal-same-date
npm run cli -- journal-same-date --log-only
npm run cli -- journal-same-date --date 2026-03-14
npm run cli -- journal-same-date --merge 41,42,43
npm run cli -- journal-same-date --merge 41,42,43 --save
npm run cli -- journal-same-date --merge 41,42,43 --save --delete-originals
npm run cli -- journal-same-date --delete 41,42
npm run cli -- journal-same-date --lock 41,42
npm run cli -- journal-same-date --include-locked
```

**Input**

| Flag | Type | Required | Notes |
|---|---|---|---|
| `--date` | `YYYY-MM-DD` | no | show only this date's group; without it, every grouped date |
| `--log-only` | boolean | no | consider only Log entries, so a date needs **two or more logged activities** to appear — the card's "Review only Log entries" toggle. A bare flag, so put it last |
| `--merge` | id list | no | comma-separated entry ids. Prints the merged draft and **writes nothing** |
| `--save` | boolean | no | with `--merge`, actually create the merged entry. **Put it last** — `parseFlags` treats every flag as taking a value |
| `--delete-originals` | boolean | no | with `--save`, also bin the source entries once the merged entry is written — the web dialog's follow-up prompt. Ignored without `--save`. Also a bare flag, so put it last too |
| `--delete` | id list | no | comma-separated entry ids to move to the recycle bin |
| `--lock` | id list | no | comma-separated entry ids to lock and exclude from review. Already-locked and missing ids are skipped, not errors. Nothing is deleted — unlock the entry to bring its date back |
| `--include-locked` | boolean | no | list locked entries too, which are otherwise excluded. A bare flag, so put it last |

**Calls** — `findSameDateGroups(listEntries(deps.journalRepo), { logOnly, includeLocked })`
for the listing; `mergeEntryDraft` over the full entries read by `getEntry` for `--merge`,
then `createEntry` when `--save` is given; `recycleEntries` for `--delete`; `lockEntries`
for `--lock`. Every one is the same library function the web section's server actions call.

**Output** — one block per grouped date, each entry as `#id  HH:MM  title` with its
100-word excerpt indented beneath. A logged activity is marked `[log]` (the web list's
"L" badge), suppressed under `--log-only` where every row would carry it:

```
2 dates · 5 entries

2026-03-14 — 3 entries
  #   41  09:00  Morning run
         Five miles along the towpath before it got hot.
  #   42  12:30  (untitled) [log]
  #   43  21:00  Dinner with Anna
```

Merging **never destroys anything before the merged entry exists**, in either front-end:
`--merge` prints a proposal and writes nothing, `--save` creates one new entry, and the
sources are only binned if `--delete-originals` is given — after the write, never before.
That is the terminal's form of the web dialog's "would you like to delete the original
*n* entries?" prompt; a terminal can't ask mid-command, so the answer comes up front.
Every delete here moves entries to the recycle bin (migration 0079), so it is undone from
the web Correct tab rather than being final.

This command is the section's layering check: the grouping, the reading order, the
excerpt and the whole merged draft come from `src/lib/journal/same-date.ts`, so if the
merge couldn't be produced here the logic would have leaked into the view.

**Exit** — 0; 1 on a malformed id list, an id that no longer exists (for `--merge`), or a
rejected delete or lock.
Source: [src/cli/journal-same-date.ts](src/cli/journal-same-date.ts)

---

## `journal-taxonomy`

The Journal → Meta Data card's **Clean up** from the terminal: which managed categories
or tags no entry actually uses, and the bulk delete its ticked rows feed.

```
npm run cli -- journal-taxonomy category
npm run cli -- journal-taxonomy tag
npm run cli -- journal-taxonomy category --unused
npm run cli -- journal-taxonomy tag --unused --delete
npm run cli -- journal-taxonomy category --merge "Trips,Vacation" --into Travel
npm run cli -- journal-taxonomy category --merge "Trips,Vacation" --into Travel --apply
```

**Input**

| Flag | Type | Required | Notes |
|---|---|---|---|
| *(first bare arg)* | `category` \| `tag` | **yes** | which managed list. `categories`/`tags` are accepted too |
| `--unused` | boolean | no | list only the names no entry carries, instead of the whole list with counts |
| `--delete` | boolean | no | with `--unused`, actually delete them. **Only valid with `--unused`** — see below |
| `--merge` | name list | no | comma-separated names to fold into one. Prints the plan and **writes nothing** without `--apply` |
| `--into` | string | with `--merge` | the name they become. Created if it doesn't exist; an existing one keeps its icon and description |
| `--apply` | boolean | no | with `--merge`, actually perform it. A bare flag, so put it last |

**Calls** — `taxonomyUsageCounts` for the full listing, `findUnusedTaxonomy` for
`--unused`, `taxonomyInUseAmong` for the pre-delete re-check, then `deleteCategory` /
`deleteTag` per name. The same library functions the web card's Clean up and bulk Delete
call, so the two front-ends cannot disagree about which names are unused.

**Output** — the whole managed list with each name's entry count, `unused` spelled out
rather than shown as `0`:

```
4 categories · 2 used by no entry

  Errands   unused
  Obsolete  unused
  Travel         7
  Work          34
```

**`--delete` is scoped to `--unused` deliberately.** Deleting a hand-picked list of names
from here would be a destructive command with no confirm, where the web path at least
spells out what is still in use first. Before it writes, the command re-checks the names
through `taxonomyInUseAmong` and **abandons the run** if any turn out to be in use — that
can only happen if something changed between the two reads, and detaching a name from
live entries without a word is the one outcome worth refusing.

Deleting a category or tag removes it from the managed list **and** detaches it from every
entry carrying it, in one transaction per name (the same `deleteCategory`/`deleteTag` the
per-row delete button calls). Entries keep their history; they just lose that name. Names
are deleted one at a time rather than in one big transaction, so a single bad name doesn't
abandon the rest — matching the web action.

Names are compared case- and whitespace-insensitively against the names on entries, the
same looseness as `isLogEntry`: a hand-typed `work` counts as a use of the managed `Work`,
because the alternative is reporting a live category as unused and offering to delete it.

### Merging

`--merge "a,b" --into "New"` is the card's **Merge** button: it folds several names into
one. Dry-run by default like `journal-same-date --merge`, so the plan prints and nothing
is written until `--apply`:

```
Merging 2 categories into "Travel":
  Trips
  Vacation

  "Travel" will be created. Icon inherited from "Trips".
  9 entries will carry "Travel".
  Saved filters to update: Holidays
  Templates to update: Holiday

Nothing was written. Re-run with --apply to perform this merge.
```

**A merge cannot be undone.** There is no recycle bin for taxonomy, so which entry carried
which original name is gone once it lands.

Three things it gets right that a hand-written `UPDATE` would not:

- **`jrn_entry_categories` carries `UNIQUE (entry_id, category_name)`**, so renaming in
  place throws the moment one entry carries two of the merged names — the ordinary case for
  near-duplicates. The repository adds the target pairing with `INSERT OR IGNORE` and then
  deletes the sources, so a shared entry collapses to one row instead of erroring.
- **The entry count is `COUNT(DISTINCT entry_id)`, never a sum** of the per-name counts.
  Summing double-counts entries carrying two sources, which would overstate the figure the
  reader is deciding on.
- **Saved filters and prefill templates are rewritten too.** Both store taxonomy names
  inside JSON (`jrn_saved_filters.filter_json`, the template fields blob), so nothing in
  the database follows the rename on its own; a filter reading "category is Trips" would
  silently match no entries, which looks like an empty journal rather than an error.

Merging a name into itself (`--into` naming one of the sources) folds the others into it
and keeps it. The target is matched case-insensitively, so `--into travel` with an existing
`Travel` reuses that row rather than creating a second one differing only in case.

**Exit** — 0; 1 on a missing or unrecognised kind, `--delete` without `--unused`, the
in-use re-check refusing the run, any name that failed to delete, `--merge` without a
usable `--into`, or a merge the schema rejected.
Source: [src/cli/journal-taxonomy.ts](src/cli/journal-taxonomy.ts)

---

## `journal-templates`

Journal prefill templates — the same use-cases the Configuration → Templates screen
drives. A template is a named set of field values a new entry can start from.

```
npm run cli -- journal-templates list
npm run cli -- journal-templates show --name "Gym"
npm run cli -- journal-templates apply --name "Gym"
npm run cli -- journal-templates set --name "Gym" --field categories --value HEALTH
npm run cli -- journal-templates set --name "Today" --field date --now
npm run cli -- journal-templates enable --name "Gym"
npm run cli -- journal-templates disable --name "Gym"
npm run cli -- journal-templates delete --name "Gym"
```

**Input**

| Subcommand | Flags | Notes |
|---|---|---|
| `list` | — | every template, enabled or not, with its fields |
| `show` | `--name` | one template |
| `apply` | `--name` | what a new entry would be prefilled with, dynamic values resolved |
| `set` | `--name`, `--field`, `--value` \| `--now`, `--description` | upserts **one field**; creates the template if it doesn't exist |
| `enable` / `disable` | `--name` | whether the New Entry dropdown offers it |
| `delete` | `--name` | |

`--name` is matched case-insensitively, like the unique index. `--now` is a bare switch
and only legal on `--field date` / `--field time` — **put it last**, since `parseFlags`
treats every flag as taking a value.

`set` takes one field per invocation rather than a JSON blob argument: a shell is a bad
place to quote JSON, and the web editor is the right tool for building a whole template
at once.

**Calls** — `listPrefillTemplates` / `getPrefillTemplateByName` / `savePrefillTemplate` /
`setPrefillTemplateEnabled` / `deletePrefillTemplate` / `applyPrefillTemplate`, all from
`@/lib/journal`. Validation is the same `savePrefillTemplateSchema` the web action uses,
so a duplicate name or an illegal `--now` fails identically in both.

**Output** — one template per block, field label and value, with `<current>` for a
dynamic field:

```
Gym
Weekday workout
  Date         <current>
  Categories   HEALTH
  Tags         gym cardio
```

`apply` is the layering check: it resolves "current date"/"current time" against this
machine's clock through the same `applyPrefillTemplate` the browser calls, so if the
merge couldn't be printed here the logic would have leaked into the entry form.

**Exit** — 0; 1 on an unknown subcommand, a missing `--name`/`--field`, a template that
doesn't exist, or a validation failure (duplicate name, unknown field, illegal `--now`).
Source: [src/cli/journal-templates.ts](src/cli/journal-templates.ts)

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

## `expense-create-rule`

Creates one post-import transaction rule — the CLI half of the **Transaction Rules**
screen, so a rule can be scripted rather than typed. Writes one
`exp_post_import_rules` row plus one `exp_post_import_rule_actions` row per `--set`.

```
npm run cli -- expense-create-rule --name "TGI Friday's"   --description "The card prints this restaurant three different ways"   --pattern "%TGI%" --set vendor="TGI Friday" --set categoryName=Restaurant

npm run cli -- expense-create-rule --name Amazon --pattern "AMAZON%"   --set categoryName=online-purchase --priority 10 --disabled
```

**Input** — `--name`, `--pattern` and at least one `--set <field>=<value>` are required;
a rule without a pattern or an action is inert, so the command refuses it rather than
writing a row that can never fire. `--set` is **repeatable** and splits on the *first*
`=`, so a value may contain one. Fields: `categoryName`, `vendor`, `status`, `note`.
Optional `--description`, `--priority <int>` (default 0, lowest wins), `--disabled`.

**Calls** — `createRule`, which validates through `savePostImportRuleSchema` — the same
path the web form uses, so the rules are identical either way: a name is required, a
`status` value must be one of `new` / `reconciled` / `irreconcilable`, and only a `note`
may be blank.

**Output** — the new rule's id, name, pattern, description, priority and each field it
sets, then a reminder that existing transactions are untouched until the clean-up runs.

**Exit** — 0 on success; 1 on a missing required flag (prints usage), an unknown field
name, a non-integer `--priority`, or a schema rejection. Validation failures print the
schema's own one-line message rather than a ZodError dump.
Source: [src/cli/expense-create-rule.ts](src/cli/expense-create-rule.ts)

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

## `run-scheduled-refresh`

⚠️ **Network + writes** (except with `--status`). Runs the full refresh pass: a Yahoo
quote per position, a sector lookup for any uncached ticker, then today's snapshot —
the same three steps as the Configuration screen's Refresh All, and the same pass the
in-process scheduler runs on its heartbeat.

```
npm run cli -- run-scheduled-refresh
npm run cli -- run-scheduled-refresh --force
npm run cli -- run-scheduled-refresh --status
```

**Input** — `--force` ignores the switch and the interval; `--status` prints the
settings and the last run without doing anything.
**Calls** — `runScheduledRefreshNow({ force })` / `loadScheduledRefreshSettings()`.
**Output** — `Refreshed: 38 priced, 1 failed, 2 sector(s), snapshot saved.`, or
`Nothing ran: <reason>` when the switch is off, the interval hasn't elapsed, or there
are no positions.
**Exit** — 0 normally, **1 only when the whole pass failed**. A `partial` (one
delisted ticker) is a success, so a scheduler doesn't alert on a single bad symbol.

Without `--force` this respects the in-app switch and interval, so it is safe to point
an external scheduler (DSM Task Scheduler, cron) at it if you would rather the clock
lived outside the app — the app is already running its own timer, so only do one.
Source: [src/cli/run-scheduled-refresh.ts](src/cli/run-scheduled-refresh.ts)

## `list-scheduled-jobs`

Read-only. Prints every background job the app runs on a timer and when each last ran
— the CLI half of Administration &rarr; Background Tasks.

```
npm run cli -- list-scheduled-jobs
```

**Input** — none.
**Calls** — `listScheduledJobs(deps.scheduledRunRepo.list())`, `describeLastRun`.
**Output** — one block per job: its label, its `job_key`, and either
`Last run 2026-08-26 04:00:00 — ok (38 priced)` or `Never run.`
**Exit** — always 0. Nothing having run is an answer, not a failure.

Worth having as a command and not just a screen: this is what you want when the app
itself is the suspect. It reads `sys_scheduled_runs` directly, so it answers "did the
scheduler ever fire?" with no browser, no session and no working web server. A run
stamped with no status means the process died mid-pass, and it says `interrupted`
rather than guessing.
Source: [src/cli/list-scheduled-jobs.ts](src/cli/list-scheduled-jobs.ts)

## `export-portfolio`

Renders the portfolio as an AI-ready prompt — the same text the *Export for AI Analysis*
screen puts on the clipboard, on stdout so a script can pipe it.

```
npm run cli -- export-portfolio
npm run cli -- export-portfolio --format json
npm run cli -- export-portfolio --focus fees,tax
npm run cli -- export-portfolio --focus diversification
npm run cli -- export-portfolio --kinds "Roth IRA"
npm run cli -- export-portfolio --refresh-correlations
npm run cli -- export-portfolio --format json > portfolio.json
```

**Input** — `portfolioExportOptionsSchema`. Every flag is optional; omitting one applies
the schema's own default, so the bare command is the common case.

| Flag | Values | Default |
|---|---|---|
| `--format` | `markdown`, `json` | `markdown` |
| `--focus` | comma-separated: `allocation`, `fees`, `tax`, `diversification` | all four |
| `--kinds` | comma-separated account kinds | `Taxable,Roth IRA,Traditional IRA` |
| `--refresh-correlations` | bare switch | off |

An empty `--focus` is legitimate — it asks for a general review rather than specific
lenses. A duplicated focus is rejected.

**Calls** — `buildPortfolioExport` then `renderExport`, against `deps.stockPositionRepo`,
`deps.investmentAccountRepo` and `deps.tickerProfileRepo`. The correlation matrix is
**read** from `getCorrelationCache(deps.stockAnalyticsRepo)`, never computed — unless
`--refresh-correlations` is passed, which runs `computeCorrelationMatrix` first.

⚠️ **`--refresh-correlations` is network-heavy and writes.** One year of daily history
per eligible Stock/ETF holding plus the SPY benchmark, and it replaces the shared
correlation cache that Chart & Analysis reads. Its progress goes to **stderr**, so
`export-portfolio --refresh-correlations > out.md` still produces a clean file.

**Output** — the rendered Markdown or JSON on stdout. Nothing else, so it pipes cleanly.

**Exit** — `0` on success; `1` on invalid options or a read failure, with the message on
stderr.
Source: [src/cli/export-portfolio.ts](src/cli/export-portfolio.ts)

---

## `consult-ticker`

Renders the AI consult prompt for **one ticker** — the same text the viewer's *Consult AI*
dialog puts on the clipboard, on stdout so a script can pipe it. Asks for alternatives in
the same sector and in a different one, each priced within a band of this ticker's price.

```
npm run cli -- consult-ticker AAPL
npm run cli -- consult-ticker aapl --band 10
npm run cli -- consult-ticker AAPL --no-quote
npm run cli -- consult-ticker AAPL > aapl-consult.md
```

**Input** — `tickerConsultOptionsSchema`. The ticker is positional and required; it is
upper-cased by the schema, so `aapl` and `AAPL` produce the same prompt and file name.

| Flag | Values | Default |
|---|---|---|
| `--band` | the percentage either side of the price, `0 < n <= 50` | `15` |
| `--no-quote` | bare switch — skip the live quote and price off our own records | off |

**Calls** — `getTickerOwnData` (a database-only read across `deps.stockPositionRepo`,
`deps.investmentAccountRepo` and `deps.stockWatchListRepo`), then `getTickerQuote` unless
`--no-quote`, then `resolveSector` over `deps.tickerProfileRepo` — the same cached sector
the dashboard charts use, so a hand-set sector wins here too. Finally
`buildTickerConsult`.

One provider call, for the quote. A quote failure is **not** fatal: it falls back to the
price on our own position row, says so on stderr, and the prompt itself is explicit that
the band is approximate. `--no-quote` makes the command fully offline.

**Output** — the prompt on stdout. The one-line header (ticker, date, suggested file name)
goes to **stderr**, so `consult-ticker AAPL > out.md` still produces a clean file.

**Exit** — `0` on success; `1` on invalid options or a read failure, with the message on
stderr.
Source: [src/cli/consult-ticker.ts](src/cli/consult-ticker.ts)

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

## `simulate-ticker`

The Simulation section from a terminal: "had I bought N shares at the start of each of
these windows and held to today, where would I be?"

```
npm run cli -- simulate-ticker AAPL --shares 10
npm run cli -- simulate-ticker AAPL --shares 10 --ranges 1wk,6mo,1y,max
npm run cli -- simulate-ticker AAPL --shares 2.5 --ranges all
```

**Input** — the ticker is a **bare positional** (the first argument, before any flag).

| Flag | Effect |
|---|---|
| `--shares N` | Share count, fractional allowed. Default `1`. Must be greater than zero. |
| `--ranges a,b,c` | Comma-separated windows. Default `1mo,6mo,1y`; `all` runs every one. Valid: `1wk`, `2wk`, `1mo`, `3mo`, `6mo`, `1y`, `2y`, `5y`, `10y`, `max`. |

⚠️ Always hits the network — one price-history request per range, in parallel.

**Calls** — `runSimulation(deps.marketDataClient, { ticker, shares, ranges })`, the same
use-case and the same `runSimulationSchema` the web action uses, so a bad share count or
an unknown range is rejected identically in both.

**Output** — a row per range with buy price, current price, total cost, current value and
gain/loss in dollars and percent, then an `UNAVAILABLE` block for any window the symbol
is too young for. Price return only — no dividends, fees or taxes. Writes nothing.

**Exit** — 0; 1 when no ticker is given or the input fails validation. A range with no
usable history is reported under `UNAVAILABLE` and does not change the exit code.
Source: [src/cli/simulate-ticker.ts](src/cli/simulate-ticker.ts)

---

## `market-indexes`

The dashboard's Indexes card from a terminal: where the major benchmarks stand today.

```
npm run cli -- market-indexes
npm run cli -- market-indexes --symbols ^GSPC,GC=F
```

**Input** — all flags optional; with none, the whole board.

| Flag | Effect |
|---|---|
| `--symbols a,b,c` | Comma-separated subset. Must be catalogued symbols: `^GSPC`, `^IXIC`, `^DJI`, `^RUT`, `^VIX`, `GC=F`, `SI=F`, `CL=F`, `^TNX`, `DX-Y.NYB`, `BTC-USD`. |

⚠️ Always hits the network — one quote request per symbol, in parallel (eleven by default).

**Calls** — `loadIndexBoard(deps.marketDataClient, parseIndexSymbols(symbols))`, the same
use-case and the same `indexBoardSchema` the card's Refresh all button uses, so an
uncatalogued symbol is rejected identically in both.

**Output** — a table per group (US equity, Commodities, Rates & currency, Crypto) with
level, change and change % per index, then an `Unavailable:` block for any symbol the
provider didn't return. Levels print in their own unit: bare points for an index, dollars
for a commodity, percent for the 10-year yield. Writes nothing.

**Exit** — 0; 1 when the input fails validation or *every* symbol failed. A partly-failed
board still exits 0 — losing one of eleven unauthenticated calls is normal, and the rows
that came back are the answer.
Source: [src/cli/market-indexes.ts](src/cli/market-indexes.ts)

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
npm run cli -- attendance-report --class "Math 101" --csv > register.csv
```

**Input** — `--class <name>` (required). `--date YYYY-MM-DD` defaults to today.
`--session <recordId>` picks one of the day's registers; without it the **latest** is
printed, since a class may be registered more than once a day. `--list-sessions` lists
every session with its id, date, label and counts instead of printing one
(`--list-dates` is kept as an alias). `--csv` writes the session as CSV instead of the
readable listing.

**Calls** — `listClasses`, `listSessionsForClass`, `getAttendanceReport` /
`getAttendanceReportById` on `deps.attendanceRepo`; `attendanceReportToCsv` for `--csv`.

**Output** — the class, date, session label and recorded timestamp; the present/absent
counts; a one-line tally of any actions noted that session; then the PRESENT and ABSENT
lists, each name followed by its action codes in brackets. Names and codes are as they
were when attendance was taken. With `--csv`, **only** the CSV — a row per student,
absentees included — so stdout can be redirected straight to a file; it goes through the
same `attendanceReportToCsv` as the Report screen's Export button, so the two agree.
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
npm run cli -- user-preferences --user min --nav-style segmented
npm run cli -- user-preferences --user min --clock-face analog --clock-weather no
npm run cli -- user-preferences --user min --floating clock --floating-state open
```

**Input** — `--user <username>` (required). Every other flag is optional, and
**omitting one leaves that preference as it is**, so any can be changed without
restating the others. Supplying none is a read.

| Flag | Values | Sets |
|---|---|---|
| `--favorite` | slug or `""` | the favorite module; `""` clears it |
| `--startup` | `yes` \| `no` | whether logging in opens the favorite |
| `--nav-style` | `drill-in` \| `segmented` | the compact navigation arrangement |
| `--clock-face` | `digital` \| `analog` | the Clock's face, on the home card *and* the floating clock |
| `--clock-date` / `--clock-weather` / `--clock-weekday` | `yes` \| `no` | what the Clock shows around the time |
| `--floating` + `--floating-state` | id + `closed`\|`minimized`\|`open` | one floating component's shape. **Both together**, and written by their own use-case rather than with the form |

The **weather location and temperature unit** (set on the Account screen, shown by the
Floating Clock) have no flags, but the command carries the stored values
through on every write — `saveUserPreferences` writes every key each time, so a save
that omitted them would silently clear the user's location. Each `--clock-*` field is
carried the same way.

`--floating` is the exception to that pattern: it goes through `saveFloatingState`, a
**single-key write**, so it can be combined with the form flags in one invocation
without either clobbering the other. The calculator's angle mode and last result are
likewise written by `saveCalculatorState` and have no flags here — see
[`calculator`](#calculator).

**Calls** — `getUserPreferences` / `saveUserPreferences` / `resolveStartupDestination` on
`deps.userPreferencesRepo`, plus `getAccessibleModules` to bound the favorite.

**Output** — the favorite, the startup flag, the compact nav style, the Clock's face and
what it shows, each floating component's state, and the resolved landing place
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
| `readEntryData` | `(repo, id, limit?) => CsvEntryData` — carries `rowIds` parallel to `rows` | — | **CLI** |
| `createEntry` | `(repo, input: CreateCsvAnalyticEntryInput) => CsvAnalyticEntry` | `createCsvAnalyticEntrySchema` | **CLI** |
| `updateEntry` | `(repo, id, input) => UpdateEntryResult` | `updateCsvAnalyticEntrySchema` | web only |
| `deleteEntry` | `(repo, id) => void` — drops the table | — | **CLI** |
| `listChartPresets` | `(repo, entryId) => CsvChartPreset[]` | — | web only |
| `saveChartPreset` | `(repo, input) => CsvChartPreset` — upserts by (entryId, name) | `saveChartPresetSchema` | web only |
| `deleteChartPreset` | `(repo, id) => void` | — | web only |
| `bulkEditRows` | `(repo, entryId, rowIds, changes) => CsvBulkEditResult` — one value per column across many rows | `csvBulkEditSchema` | **CLI** |
| `nonEditableColumns` | `(entry) => string[]` — the primary-key fields, which a bulk edit refuses | — | **CLI** |

`updateEntry`'s `ingest.mode` is `"append" | "truncate" | "overwrite"`; append and
truncate throw when headers don't match. File contents travel as strings, so all of
this is JSON-safe apart from the repo.

`CsvColumnType = "text"|"integer"|"real"|"date"|"datetime"|"boolean"`

**`CsvEntryData.rowIds` is what makes a row writable.** A parallel array rather than a
field on the row, so `rows` keeps its exact shape — every chart, export and cell lookup
indexes by a column's position in `columns`, and prepending a key would shift all of
them. Every physical table has a rowid whichever shape `buildCreateTableSql` gave it:
with no `primaryKeyFields` the surrogate `_row_id INTEGER PRIMARY KEY AUTOINCREMENT` *is*
the rowid, and a composite-PK table still carries the implicit one.

`bulkEditRows` writes only the columns named in `changes`, leaving every other column on
each selected row alone, and refuses `nonEditableColumns` (the primary-key fields) —
rewriting a key would silently repoint a row. It reads change keys via `Object.keys`
rather than the `in` operator, since the change set arrives as parsed JSON from a server
action or a CLI flag and `in` answers true for inherited keys like `constructor`.

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
| `buildAttendanceDetailReport` | `(repo, classId) => AttendanceDetailReport` — the whole-term grid: a row per student, a column per date | — | web only |

`buildAttendanceDetailReport` backs the report screen's **Detail** format
(`?format=detail`); the **Brief** format is `getAttendanceReport` above. Two rules it
encodes, both load-bearing:

- **One column per date, carrying that date's *latest* session.** A class can be
  registered several times a day (0049 dropped the unique index that used to make a
  save overwrite the day), so a date can hold more than one session. Same rule
  `getAttendanceReport` uses for "today"; Brief is where a specific session is reachable.
- **A cell with no `status` means "no entry that day"** — not enrolled yet — which is
  deliberately distinct from `absent`. `saveAttendance` writes a row for every enrolled
  student precisely so those stay different facts.

Rows come from the sessions, not the live roster, so an unenrolled student still shows
the days they attended. Reads through `listAttendanceRecordsForClass`, which is three
queries regardless of session count rather than the two-per-record the per-day path costs.

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
| `importJournalCsv` | `(repo, fileText, columnMapping, fieldOptions = {}, options = {}) => ImportSummary` — `options.skipDuplicates` defaults to `true`; idempotent on re-import | indirect | **CLI** |
| `autoMapJournalHeaders` | `(headers: string[]) => { columnMapping, fieldOptions }` — pure | — | **CLI** |
| `defaultJournalFieldOptions` | `(field: string) => FieldOptions \| undefined` — pure; the options a hand-mapped column starts with | — | **CLI** |

`listTodayInHistory` takes the reference date as an argument rather than reading the
clock. `createEntry` auto-registers unknown categories and tags.

**A mapping UI must WRITE `defaultJournalFieldOptions` into its field options, not just
display them as a fallback.** A `<select>`'s rendered value fires no change event, so a
default living only in the control is invisible to the import — which is how a
space-separated Tags column silently imported as one long tag. Tags default to a space
delimiter and categories to a comma, matching the split `JOURNAL_HEADER_RULES` applies
when auto-mapping recognizes the header; this also covers the case auto-map cannot, a
field the user picks by hand. `JOURNAL_LIST_FIELDS = ["categories", "tags"]` names the
fields whose cell holds several values, so the UI offers the delimiter control on exactly
those rather than keeping a list of its own that can drift.

`JournalEntry { id, date, time, title, content, placeName, weather?, isPinned, isLocked, categories: string[], tags: string[], locations: EntryLocation[], createdAt, updatedAt }`

Preferences (pure): `resolveJournalPreferences`, `journalPreferencesToEntries`.

## journal-photos — `@/lib/journal-photos`

Finds the photographs a journal entry's date can be illustrated with. Takes
`deps.photoFileStore` (a `PhotoFileStore` port over `MYHOMEBASE_PHOTO_ROOT`).
**Read-only by construction** — the port has no write method, so nothing in the app can
alter the archive.

| Use-case | Signature | Zod | Status |
|---|---|---|---|
| `listPhotoFoldersForDate` | `(store, date) => Promise<PhotoFolderLookup>` — reads folder NAMES only, opens no files | `photoFolderLookupSchema` | web only |
| `listPhotosInFolder` | `(store, { date, relativePath, includeAll? }) => Promise<PhotoFolderContents>` — for a month folder, reads each JPEG's EXIF header | `photoFolderContentsSchema` | web only |
| `listAllPhotosInFolder` | `(store, { relativePath }) => Promise<FolderPhotos>` — every JPEG in one folder, **no file opened** | `photoFolderAllSchema` | web only |
| `readPhotoDetails` | `(store, { relativePath }) => Promise<PhotoDetails>` — ONE photo's path and capture timestamp; one partial read | `photoDetailsSchema` | web only |
| `readExifDate` | `(bytes: Uint8Array) => string \| undefined` — pure JPEG/TIFF header parser | — | pure |
| `readExifDateTime` | `(bytes) => ExifDateTime \| undefined` — the same walk, keeping the clock time | — | pure |
| `dateFromFileName` | `(fileName) => string \| undefined` — pure, the no-EXIF fallback | — | pure |

Split into two calls deliberately: listing folders is one directory read, while scanning a
month folder opens every JPEG in it (~8ms per file cold over SMB, so ~10s for 1,400
photos). The card asks for folders first and scans a folder only when it is opened.

**`listAllPhotosInFolder` and `readPhotoDetails` are split for the same reason, and the
split is load-bearing.** The first answers "what is in this folder" from a directory
listing and **opens no files at all**; the second answers "where is this one photo and when
was it taken" and opens the first 128KB of exactly one. `PhotoViewer` calls the first once
per folder and the second once per photo the reader actually looks at. Folding the
timestamp into the listing would put a per-photo SMB read behind every folder open and
stall a 1,187-photo folder for minutes — so there is deliberately no `includeDetails` flag
on the listing to reach for.

`readPhotoDetails` reports **which evidence** produced its date (`exif` → `file-name` →
`folder` → `none`) rather than just the date, because those are different claims and a
viewer showing an inferred date as though the camera recorded it would be presenting a
guess as a fact. `readExifDateTime` keeps the date and time as **separate strings, with no
timezone and no `Date` round-trip** — EXIF is local wall-clock time at the shutter with no
offset recorded, so a conversion would shift an evening photo onto the next day.

**The archive's convention** — photo root → year folder → two folder kinds:

- `2019-06-09 Von Thun Farm Strawberry Festival` — one day's event. Every JPEG in it
  matches the date; no file is opened.
- `2019-06`, or the named `2018-05 Lake George Trip`, or the month-precision
  `2019-01-00 San Diego Vacation` — a month of loose photos, filtered by EXIF
  `DateTimeOriginal`, falling back to a date in the file name. EXIF wins over a
  contradicting file name (a photo shot after midnight belongs to the day the shutter
  fired).

Only `.jpg`/`.jpeg` are read — RAW, video and sidecars are ignored.

`PhotoFolder { name, relativePath, kind: "day" | "month", label, photoCount }`
`PhotoFile { name, relativePath, matchedBy: "exif" | "file-name" | "folder", takenAt? }`

No CLI command yet — the two use-cases take only JSON-serializable input and a port, so
adding one needs no change to `lib/`.

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

## sqlite-browser — `@/lib/sqlite-browser`

Repos are `deps.uploadedDatabaseRepo` (metadata, in the app DB), `deps.sqliteFileStore`
(the uploaded bytes, in the workspace folder) and `deps.foreignDatabaseReader` (opens the
uploaded file itself). No network. **CLI: `browse-sqlite`.**

Backs the Tools module's *SQLite File Browser*. The distinction that matters: the
**reader holds no connection** — it opens each uploaded path for the length of one
call, so a table name can never be resolved against `myhomebase.db`. Deletes are
written back into the uploaded file, which is scratch space by design.

| Export | Shape |
|---|---|
| `listUploadedDatabases` | `(repo) => UploadedDatabase[]` — newest first |
| `uploadDatabase` | `(input, deps) => Promise<UploadedDatabase>` — bytes first, row second; the file is header-checked and removed again if it is not really SQLite. What the CLI uses |
| `uploadDatabaseStream` | `(input, deps) => Promise<UploadedDatabase>` — the same rules from a `ReadableStream`, never holding the file in memory. What the upload **route handler** uses, because a server action's body is capped at 4 MB |
| `listTablesIn` | `(databaseId, deps) => Promise<BrowsedTable[]>` — tables and views, with row counts and whether rows can be addressed |
| `readTableRows` | `(input, deps) => Promise<BrowsedPage>` — capped at `TABLE_PAGE_LIMIT` (500) |
| `deleteRows` | `(input, deps) => Promise<DeleteRowsResult>` — by rowid, one transaction, duplicates collapsed |
| `deleteUploadedDatabase` | `(databaseId, deps) => Promise<boolean>` — row first, then the file |
| `getMaxUploadBytes` | `(moduleRepo, settingsRepo) => number` — the configured upload cap. **Both upload paths call this**, so the web route and the CLI can never enforce different limits |
| `resolveToolsSettings` / `toolsSettingsToEntries` | The `sys_module_settings` parser and writer for `tools_max_upload_bytes`. Forgiving on read (garbage → default, over-ceiling → clamped), since the row is reachable from the admin's generic key/value editor |

A missing file on disk is reported as "upload it again", not thrown: the upload root is
a workspace and clearing it is supported.

## tax-lots — `@/lib/tax-lots`

Repo is `deps.taxLotRepo`. No network. **CLI: `tax-lots`.**

The split-normalization and return maths for the Investments *Tax Lots* section.
Two vocabularies run through the whole module and must not be mixed: **raw** is what
the broker's confirmation printed on the buy date, **adjusted** is the same position
restated in today's shares. Anything compared against a live market price must be
adjusted.

| Use-case | Signature | Zod |
|---|---|---|
| `analyzeTicker` | `(repo, context: LotAnalysisContext) => PortfolioAnalysis` — the one read both adapters drive | `analyzeLotsSchema` |
| `analyzePortfolio` | `(lots, context) => PortfolioAnalysis` — pure; scores then sorts by buy date | — |
| `analyzeLot` / `analyzeNormalizedLot` | `(lot, context, id?) => LotPerformance` — pure | — |
| `summarizePortfolio` | `(scoredLots, context) => PortfolioLotSummary` — pure roll-up | — |
| `buildCashFlows` | `(scoredLots, totalCurrentValue, today) => CashFlow[]` — pure; one outflow per purchase + a terminal inflow | — |
| `listTaxLots` | `(repo, ticker?) => TaxLot[]` — oldest buy date first | — |
| `listTaxLotTickers` | `(repo) => string[]` — sorted | — |
| `getTaxLot` | `(repo, id) => TaxLot \| undefined` | — |
| `createTaxLot` | `(repo, input) => TaxLot` | `createTaxLotSchema` |
| `updateTaxLot` | `(repo, id, input) => TaxLot` | `updateTaxLotSchema` |
| `deleteTaxLot` | `(repo, id) => void` — throws on an unknown id | `taxLotIdSchema` |
| `normalizeLot` | `(rawLot, history) => NormalizedLot` — pure; shares `*` factor, price `/` factor | `normalizeLotSchema` |
| `passthroughLot` | `(rawLot) => NormalizedLot` — factor 1, for an already-adjusted lot | — |
| `normalizeStoredLot` | `(lot: TaxLot) => NormalizedLot` — branches on `isSplitAdjusted` | — |
| `cumulativeSplitFactor` | `(buyDate, history) => number` — product of splits **strictly after** `buyDate` | — |
| `splitHistoryFor` / `tickersWithSplits` / `splitsAppliedTo` | the hand-maintained `SPLIT_TABLE` | — |
| `computeXirr` | `(flows: XirrFlow[], initialGuess = 0.1) => number \| undefined` — pure, no domain import | — |
| `yearsBetween` / `classifyHoldingPeriod` / `computeCagr` / `computeYieldOnCost` | pure, no clock | — |

`LotAnalysisContext { ticker, currentMarketPrice, trailingEPS, today }` — the price and
date arrive as data, so nothing in the module reads a clock or a quote.

Four things that look like bugs and are not:

- **`cumulativeSplitFactor` is strictly-after on purpose.** Shares bought *on* an
  effective date already trade post-split, so including that split reports 4x the
  shares actually held. Dates compare as ISO strings — `YYYY-MM-DD` sorts
  chronologically, which sidesteps every timezone question a `Date` would raise.
- **`computeXirr` returns `undefined`, never 0**, for fewer than two flows, flows all
  of one sign, or every flow on one date. A zero would be indistinguishable from a
  genuinely flat return; callers render `—` (web) or `n/a` (CLI).
- **XIRR uses 365 days/year, `yearsHeld` uses 365.25.** Not an inconsistency — 365 is
  the market convention for XIRR (it is what Excel does), and the holding period is a
  calendar question. They answer different things.
- **`SPLIT_TABLE` is code, not fetched.** The market-data client can report split
  events, but a fetched value is a suggestion to add a row, not a substitute for one:
  a cost basis that silently changes when a provider revises its history is worse than
  one you update deliberately.

`TaxLotRepository` is deliberately CRUD-only — no aggregate query — so the maths lives
in one place instead of half in SQL and half in TypeScript. Table is `inv_tax_lots`
(migration 0083).

## stock-dashboard — `@/lib/stock-dashboard`

No repo, no network — layout preference encoding only. Persistence goes through
module-settings. **No CLI reach** (and little reason for one).

`defaultDashboardWidgets()`, `resolveDashboardWidgets(settings)`,
`dashboardWidgetsToEntries(input)` (`dashboardWidgetsSchema` — must list every widget
exactly once), `moveDashboardWidget(prefs, id, "up"|"down")`,
`toggleDashboardWidget(prefs, id)`, `visibleDashboardWidgets(prefs)`.

Widget ids: `summary`, `statistics`, `allocation`. (`refresh`, `glance` and the three
per-chart `allocation*` ids are retired; `resolveDashboardWidgets` drops any saved layout
still naming them, so no migration was needed.)

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
| `getTickerIntradaySeries` | `(deps.marketDataClient, { ticker }) => Promise<TickerIntradaySeries>` ⚠️ 1 call — one session, bar by bar | `tickerIntradaySchema` (= `tickerOverviewSchema`) | web only |

Risk cache rows **never expire** — pass `refresh: true` to recompute. The trade timeline
makes zero calls when the ticker has no transactions, and the caller supplies
`transactions` (the DB read is the caller's job).

`getTickerIntradaySeries` takes **no range or interval**: there is exactly one session to
fetch and the bar size is the module's choice, not a knob for the boundary — which is why
its schema is just `tickerOverviewSchema` under another name. `TickerIntradaySeries` is a
separate shape from `TickerPriceSeries` rather than a sixth range on it, because that one
is keyed by calendar date and summarized over a window of daily closes and neither is
true within a single session. **Its figures are a snapshot, not live** — the provider
returns bars up to the moment of the fetch, so `highCents`/`lowCents`/`averageCents`
describe the session *so far*, hence the non-optional `asOf`. `sessionDate` is named
because it is not always today: outside trading hours the provider returns the last
completed session.

Pure helpers: `summarizeHoldings`, `summarizeIncome`, `summarizeTrades`,
`computeWatchDrift`, `toClosePoints`, `closeOnOrBefore`, `summarizePriceSeries`,
`summarizeIntradaySeries`, `rankStories`, `describeMarketEvent`, `buildTickerEvents`,
`transactionDate`, `historyRangeCovering`, `buildTradeTimeline`, `computeTradeMoveSince`.
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

## dashboard-texture — `@/lib/dashboard-texture`

Repo is `deps.dashboardTextureRepo`. No network. **No CLI reach.** The home dashboard's
optional background picture (migration 0063) — a single-row settings table plus a BLOB.

| Use-case | Signature | Zod |
|---|---|---|
| `getDashboardTexture` | `(repo) => DashboardTexture` — carries `hasImage`, never the bytes | — |
| `getDashboardTextureImage` | `(repo) => DecodedImage \| undefined` — **serving route only** | — |
| `setDashboardTextureImage` | `(repo, input) => void` | `imageUploadSchema` + 4 MB cap |
| `removeDashboardTextureImage` | `(repo) => void` | — |
| `saveDashboardTextureSettings` | `(repo, {opacity, mode, blur}) => void` | `dashboardTextureSettingsSchema` |
| `dashboardTextureCssVars` | `(texture) => Record<string,string> \| undefined` — pure; `undefined` when no picture | — |

`MAX_DASHBOARD_TEXTURE_BYTES = 4 MB`. `mode` is `"cover" | "tile"`; `opacity` 0..1;
`blur` 0..40 px — all three CHECK-constrained in the table as well as validated here.

## module-texture — `@/lib/module-texture`

Repo is `deps.moduleTextureRepo`. No network. **No CLI reach.** A *per-module*
background picture (migration 0064), keyed by module slug — the same shape as
`dashboard-texture` above but one row per module rather than a pinned singleton. The
Music Library is the only caller today (**My Music Library → Configuration →
Appearance**); the picture sits behind every section of that module.

| Use-case | Signature | Zod |
|---|---|---|
| `getModuleTexture` | `(repo, slug) => ModuleTexture` — carries `hasImage`, never the bytes; returns the display defaults when the module has no row | `moduleTextureSlugSchema` |
| `getModuleTextureImage` | `(repo, slug) => DecodedImage \| undefined` — **serving route only** | `moduleTextureSlugSchema` |
| `setModuleTextureImage` | `(repo, slug, input) => void` | slug + `imageUploadSchema` + 4 MB cap |
| `removeModuleTextureImage` | `(repo, slug) => void` | `moduleTextureSlugSchema` |
| `saveModuleTextureSettings` | `(repo, slug, {opacity, mode, blur}) => void` | slug + `moduleTextureSettingsSchema` |
| `moduleTextureCssVars` | `(texture) => Record<string,string> \| undefined` — pure; `undefined` when no picture | — |

`MAX_MODULE_TEXTURE_BYTES = 4 MB`. `mode` is `"cover" | "tile"`; `opacity` 0..1; `blur`
0..40 px — all CHECK-constrained in the table as well as validated here. The slug is
lowercased and restricted to `[a-z0-9-]`, so a route param cannot create a shadow row or
reach SQL malformed.

Served by `GET /api/modules/[slug]/texture` (session required, not admin — it is page
decoration every signed-in reader already sees). Writes go through the module's own
actions and follow **that screen's** gate, not a blanket admin check: Music's
Configuration screen is reachable by any signed-in user, so its texture actions use
`requireUser`, matching `saveMusicSettingsAction` beside them. The dashboard texture is
admin-only because it lives in Administration — the gate follows the screen.

## weather — `@/lib/weather`

`getCurrentWeather(deps.weatherClient, input) => Promise<CurrentWeather>` ⚠️ Open-Meteo,
no API key. `getCurrentWeatherSchema` — latitude −90..90, longitude −180..180, `unit`
defaults to `"fahrenheit"`. **No CLI reach.**

`CurrentWeather { temperature, unit, description, code }`

`getForecast(deps.weatherClient, input, now?) => Promise<WeatherForecast>` ⚠️ Open-Meteo,
no API key. `getForecastSchema` — coordinates as above, `unit` defaults to
`"fahrenheit"`, `days` 1..16 (default 7), `refresh` skips the cache. **No CLI reach.**

Cached **in process for 30 minutes** per rounded coordinate + unit + day count, so the
home screen doesn't re-fetch on every landing; `now` is injectable for tests and
`clearForecastCache()` empties it. A failed fetch is never cached.

`WeatherForecast { current: CurrentWeather, days: DailyForecast[], unit }`
`DailyForecast { date, high, low, code, description }`

`weatherShape(code) => WeatherShape` — a WMO code reduced to one of eight drawable
shapes (`clear` | `partly` | `cloud` | `fog` | `drizzle` | `rain` | `snow` | `storm`),
for the home screen's forecast glyphs. Unknown codes fall back to `cloud`.

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
| Exported use-cases across `src/lib/` | ~257 |
| Reachable from the CLI | ~48 |
| Registered commands | 51 |
| **Coverage** | **~19%** |

**Modules with zero CLI reach (13):** `auth`, `change-history`, `daily-quote`,
`dashboard-texture`, `geocoding`, `market-data`, `next-day-actions`,
`stock-daily-snapshot`, `ticker-detail`, `ticker-logos`, `ticker-search`, `weather`,
`module-texture`.
(`stock-dashboard` and `viewport` are pure preference/layout helpers — no CLI needed.)

Six modules previously listed here now *do* have CLI reach: `investment-accounts`
(via [`export-portfolio`](#export-portfolio)), `module-settings` and `modules` (via
[`scan-music`](#scan-music) / [`resize-carousel-images`](#resize-carousel-images)),
`sql-explorer` (via [`saved-sql`](#saved-sql)), `stock-watchlist` (via
[`watch-lists`](#watch-lists)), `ticker-favorites` (via
[`favorite-quotes`](#favorite-quotes)) and `system-info` (via
[`deployments`](#deployments)).

[ARCHITECTURE.md:119-121](ARCHITECTURE.md#L119-L121) states that "every use-case is
reachable from both." At roughly a fifth, that's currently aspirational rather than
descriptive.
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

## `calculator`

Evaluates an expression, or reads and clears one person's calculation tape — the same
use-cases the Floating Calculator's window drives, so the two can't diverge.

```
npm run cli -- calculator --functions
npm run cli -- calculator --user min --expression "2+2"
npm run cli -- calculator --user min --expression "sin(90)" --angle deg
npm run cli -- calculator --user min --expression "3!^2"
npm run cli -- calculator --user min --history
npm run cli -- calculator --user min --clear-history
```

**Input**

| Flag | Type | Required | Notes |
|---|---|---|---|
| `--user` | username | yes, except with `--functions` | whose tape the calculation lands on |
| `--expression` | string | one of these three | the sum, e.g. `"3 + sin(45)"`. Capped at 500 chars |
| `--history` | boolean | one of these three | print the tape, newest first. **Put it last** — `parseFlags` treats every flag as taking a value |
| `--clear-history` | boolean | one of these three | wipe this person's tape. **Put it last**, same reason |
| `--angle` | `deg` \| `rad` | no | defaults to `deg`, matching the keypad. Rejected if it's anything else, rather than silently corrected |
| `--functions` | boolean | no | print the function/operator catalogue and exit. Needs no `--user` and touches no database |

**Calls** — `calculateAndRecord(deps.calculatorHistoryRepo, …)` for an expression,
`listCalculations` / `clearCalculations` for the tape. The expression is parsed by
`expressionSchema` and evaluated by the same `evaluate` the window uses, so a sum that
works in one works in the other, character for character — the formatted result is
produced by `formatResult` in both.

**Output** — just the result on stdout, so the command composes (`… | xargs`). A failed
expression prints its message to stderr and **exits non-zero**, so a script can tell a
syntax error from an answer without parsing stdout.

```
$ npm run cli -- calculator --user min --expression "2+2"
4

$ npm run cli -- calculator --user min --expression "1/0"
Cannot divide by zero.          # exit code 1

$ npm run cli -- calculator --user min --history
Calculations for min (newest first, up to 50):
  2026-09-15 14:22:07  3!^2 = 36
  2026-09-15 14:21:55  2+2 = 4
```

**Notes.** A **failed expression is not recorded** — the tape is a record of results, and
filling it with mistypes would push real answers off the end of the 50-row cap. The tape
is **per-user** (migration 0095): a calculator tape is private working-out, not a shared
board like `gam_scores`, so there is no flag that reads across users.

`--functions` is the quickest way to see what the evaluator knows; it also lists the
operators, including the two that surprise people (`%` is modulo, `!` is factorial).

## `scratchpad`

Reads and writes the Scratchpad — the tab strip everyone shares, and one person's notes
inside it. The same use-cases the Floating Scratchpad's window drives, so the two can't
diverge, and the only way to get a note into the app without a browser.

```
npm run cli -- scratchpad --categories
npm run cli -- scratchpad --add-category "Recipes"
npm run cli -- scratchpad --rename-category 3 --name "Cooking"
npm run cli -- scratchpad --delete-category 3
npm run cli -- scratchpad --user min --list
npm run cli -- scratchpad --user min --category "Shopping" --list
npm run cli -- scratchpad --user min --category "Shopping" --new "milk, eggs" --title "Groceries"
npm run cli -- scratchpad --user min --save 7 --body "revised text"
npm run cli -- scratchpad --user min --show 7
npm run cli -- scratchpad --user min --delete 7
npm run cli -- scratchpad --user min --category "Shopping" --export ./shopping.txt
```

**Input**

| Flag | Type | Required | Notes |
|---|---|---|---|
| `--categories` | boolean | one verb | print the tab strip with ids. **Put it last** — `parseFlags` treats every flag as taking a value |
| `--add-category` | string | one verb | append a category. Rejected if the name is taken (case-insensitively) or the strip is full (40) |
| `--rename-category` | category id | one verb | pair with `--name`. Recapitalising to its own name is allowed |
| `--delete-category` | category id | one verb | **refused while notes are filed under it** — see Notes |
| `--user` | username | for every note verb | whose notes. Never optional on a note command |
| `--list` | boolean | one verb | that tab's notes, most recently edited first. **Put it last** |
| `--new` | string | one verb | create a note with this body; prints the new id |
| `--save` | note id | one verb | write `--title`, `--body`, or both. An omitted field is left alone |
| `--delete` | note id | one verb | delete one note |
| `--show` | note id | one verb | print the note as its text file, header included |
| `--export` | file path | one verb | write the whole tab to that path |
| `--category` | name or id | no | defaults to the first tab, exactly as the window's first open does |
| `--title` | string | no | with `--new` or `--save`. Single line, 120 chars |
| `--body` | string | no | with `--save`. Whitespace is preserved exactly |
| `--name` | string | with `--rename-category` | the new category name |

**Calls** — `listCategories` / `createCategory` / `renameCategory` / `deleteCategory` for
the strip; `listNotes` / `createNote` / `saveNote` / `deleteNote` for notes;
`noteToTextFile` / `categoryToTextFile` for `--show` and `--export`, so a file written
here is byte-identical to one the window's Save button produces.

**Output**

```
$ npm run cli -- scratchpad --categories
Scratchpad categories (in tab order):
     1  Ideas
     2  Shopping
     3  Work

$ npm run cli -- scratchpad --user min --category "Shopping" --new "milk, eggs"
12                                  # just the id, so the next call can --save it

$ npm run cli -- scratchpad --user min --category "Shopping" --list
Notes for min in "Shopping" (most recently edited first):
    12  2026-09-15 14:31:02  milk, eggs

$ npm run cli -- scratchpad --delete-category 2
2 notes are still filed under this category, written by 2 people. Empty it first.
                                    # exit code 1
```

**Notes.** The **category commands take no `--user` and the note commands all require
one**, which is not an oversight — it is the ownership split the feature rests on
(migration 0096). The tab strip belongs to the household; the notes belong to a person, so
every note statement is scoped by `user_id` and there is no flag that reads across users.

**Deleting a category is refused while any note is filed under it**, and the refusal names
counts only — how many notes, by how many people, never any note text or username. The
sentence comes from `describeDeleteRefusal` in `lib`, so the terminal and the admin screen
explain it identically. Cascading was rejected: it would let an admin destroy other
people's notes with no way for a non-admin to recover them.

`--new` prints **just the id** so the command composes. `--export` writes to the path you
give rather than to the generated filename, because at a terminal `--export ./shopping.txt`
means write it there.

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

## `photo-magic`

Builds a Magic List from search criteria, and indexes the photo archive for one — the
terminal counterpart of the Magic List screen.

```
npm run cli -- photo-magic [--from YYYY-MM-DD] [--to YYYY-MM-DD]
                           [--min-mb N] [--max-mb N]
                           [--min-width N] [--min-height N]
                           [--max-width N] [--max-height N]
                           [--count N] [--save "Name"] [--description "..."]
npm run cli -- photo-magic --scan [--from ...] [--to ...] [--limit N]
npm run cli -- photo-magic --status
npm run cli -- photo-magic --list
npm run cli -- photo-magic --load <id>
npm run cli -- photo-magic --regenerate <id>
npm run cli -- photo-magic --delete <id>
npm run cli -- photo-magic --clear-index

npm run cli -- photo-magic --scan --from 2019-01-01 --to 2019-12-31
npm run cli -- photo-magic --from 2019-06-01 --to 2019-08-31 --min-width 1920 --count 50
npm run cli -- photo-magic --min-mb 4 --count 25 --save "Big ones"
```

**Scan before searching.** A directory listing knows a photograph's name but not its
size or its dimensions, so the index has to be built once per period before anything
matches — the command says so rather than reporting an empty result. A re-scan skips any
file whose size and mtime are unchanged, so the second run over a period takes seconds.
Nothing is written into the photo folders; the facts go to `pho_photo_index`.

`--scan` runs in the **foreground** here, unlike the web screen's background run with a
progress bar. That is the point of it: `--limit` plus a real range is how you time the
archive against the NAS before committing to a full walk. `--status` reports on a scan
started anywhere, including one running in the browser.

**An omitted flag is an absent bound, never a zero** — leaving `--min-mb` off widens the
search rather than emptying it. `--count` is a ceiling on a random draw, so running the
same criteria twice gives different pictures. A photograph whose dimensions could not be
read is excluded whenever a resolution bound is set, and the summary line says how many
that was.

`--save` stores the criteria *and* the set just generated, so `--load` replays that set
while `--regenerate` draws a new one from the same criteria. `--clear-index` forgets the
cached file facts only; saved lists store paths and are untouched.

**Calls** — `scanPhotoIndex`, `generatePhotoMagicList`, `savePhotoMagicList`,
`loadPhotoMagicList`, `regeneratePhotoMagicList`, `listPhotoMagicLists`,
`deletePhotoMagicList`, `getScanStatus`, `countIndexedPhotos`, `clearPhotoIndex` and
`countPhotoMagicCandidates` on `deps.photoMagicListRepo`, `deps.photoIndexRepo` and
`deps.photoMagicScanRunRepo`. `Math.random` is injected by the command, not defaulted in
the library. The archive path comes from `MYHOMEBASE_PHOTO_ROOT`, since the Journal
module's setting is a web-side override.

**Output** — the criteria in words, the matching count, then one line per photograph
with its date, size, dimensions and path, and the library's own one-line explanation of
how the draw went (the same wording the web screen shows). `--scan` prints the indexed,
unchanged and unreadable counts.
**Exit** — 0; 1 when a date is malformed or a range inverted, a size or pixel flag is
not a number, a named list already exists, the requested list id does not exist, or a
scan is already running.
Source: [src/cli/photo-magic.ts](src/cli/photo-magic.ts)

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

## `color-themes`

Reads and changes the colour themes behind Admin → Configuration → Color Themes.

```
npm run cli -- color-themes list
npm run cli -- color-themes show <id>
npm run cli -- color-themes export <id>
npm run cli -- color-themes import <file.json>
npm run cli -- color-themes reset <built-in-id>
npm run cli -- color-themes delete <id>
```

Themes are rows as of migration 0076, so this is the terminal half of that screen. The
eight built-ins are ordinary editable rows; `reset` is what restores one to its
definition in `COLOR_THEMES`.

**`export` and `import` are the reason this exists beyond parity.** A theme is twelve
values, and moving one between installs — dev to the NAS — by retyping hex codes into a
form is how a colour ends up one digit off. `export` writes the four fields `import`
reads back (`isBuiltin` and `updatedAt` belong to the install, not the theme, so they are
left out). `import` **updates when the id already exists and creates otherwise**, so
re-importing an edited file is one command rather than a delete followed by an import.

`show` prints the nine colours, the three fonts, and the full contrast report — passes
included, since a number that only appears on failure gets ignored. Contrast is
**warn-only** everywhere, `import` included: a low ratio is reported and still saved.

Two writes are refused rather than guessed at: a **built-in cannot be deleted** (reset it
instead) and the **theme currently selected cannot be deleted**, because the alternative
is silently repointing `color_theme` at the default and changing how the whole app looks
as a side effect of a delete.

**Calls** — `listColorThemes`, `getColorThemeById`, `createColorTheme`, `saveColorTheme`,
`resetBuiltinTheme`, `deleteColorTheme` and `checkThemeContrast` on `deps.colorThemeRepo`.
**Output** — `list` is one line per theme with `(active, built-in)` marks; `export` is
JSON on stdout, so it redirects cleanly to a file.
**Exit** — 0; 1 on an unknown id, a malformed hex, a font the app does not load, a
non-slug id, or either refused delete.
Source: [src/cli/color-themes.ts](src/cli/color-themes.ts)

---

## `fav-photos`

Reads and changes the favourite photographs behind the home screen's random photo card.

```
npm run cli -- fav-photos list
npm run cli -- fav-photos add <relative-path> [note]
npm run cli -- fav-photos note <relative-path> <note>
npm run cli -- fav-photos remove <relative-path>
```

Paths are **relative to the configured photo root** (the Journal module's `photo_root`,
falling back to `MYHOMEBASE_PHOTO_ROOT`) — that is what the table stores, so a favourite
survives the share being remounted. Quote them: every folder name in the archive contains
spaces.

`add` is idempotent and never overwrites an existing note, so re-adding a favourite is
safe; `note` is the way to change one. `note` on a photo that is not a favourite fails
rather than creating the row, so an edit cannot resurrect a favourite removed elsewhere.

**Calls** — `listFavPhotos`, `addFavPhoto`, `setFavPhotoNote` and `removeFavPhoto` on
`deps.favPhotoRepo`.
**Output** — one line per favourite (added-at and path), with the note indented beneath
when there is one.
**Exit** — 0; 1 when the path is missing, escapes the photo root, the note exceeds 500
characters, or `note` names a photo that is not a favourite.
Source: [src/cli/fav-photos.ts](src/cli/fav-photos.ts)

---

## `normalize-icon-overrides`

Re-runs the icon normaliser over raster icon overrides that are already stored.

```bash
npm run cli -- normalize-icon-overrides --dry-run   # report, change nothing
npm run cli -- normalize-icon-overrides
```

Uploads made before the normaliser existed kept whatever the browser sent — typically a
1024px JPEG with the transparency checkerboard flattened into it, which reads as a grey
smudge at the 16-20px an icon actually renders at. New uploads are cleaned on the way in;
this is how earlier ones catch up without re-uploading each by hand. It strips a flattened
backdrop back to real alpha, crops empty margin, and re-encodes as a 256px PNG.

Safe to run repeatedly: a second pass over an already-normalised PNG finds no backdrop and
nothing to trim. SVG overrides are never touched — they are markup, not pixels. One
unreadable image is skipped with a note rather than aborting the rest.

Writes through `saveOverride`, so the slot check, the one-payload rule and the `updated_at`
stamp stay in one place — that stamp is the `?v=` cache-buster, without which a browser
would keep showing the old picture.

**This does not run on the NAS.** `publish-nas.mjs` bundles only `migrate.cjs` and
`set-startup-message.cjs`, so no general CLI command exists on the deployed box. To fix
rows in the production database either re-upload the icons through the browser — the
normaliser runs on upload — or run this from Windows with `MYHOMEBASE_DB` pointed at the
NAS path over SMB, which is safest right after a backup.

Source: [src/cli/normalize-icon-overrides.ts](src/cli/normalize-icon-overrides.ts)

---

## `deployments`

The deployment history — the same rows the Admin → About → *Deployments* tab shows, with
the same delete and housekeeping use-cases.

```
npm run cli -- deployments list
npm run cli -- deployments show 12
npm run cli -- deployments delete 12
npm run cli -- deployments delete 12,13,14
npm run cli -- deployments prune
```

**Input** — a positional action. `show` and `delete` take an id; `delete` also accepts a
comma-separated list, which is the batch form matching the tab's checkboxes. `prune` takes
nothing: the keep count is `DEPLOYMENTS_KEEP_COUNT` (5), shared with the button so the two
can't drift apart.

**Calls** — `listDeployments`, `deleteDeployment`, `deleteDeployments` and
`pruneDeployments` on `deps.deploymentRepo`.

**Output** — `list` prints one line per deployment, newest first. `show` prints the whole
record including the build log. `delete` names the row for a single id and reports a count
for a batch. `prune` reports how many went and how many were kept.

**Exit** — 0 normally, including when nothing matched (a row deleted in another tab is not
an error). 1 for a malformed id or keep count, an unknown action, or `show` against an id
that isn't there. A batch with one bad id deletes nothing rather than deleting the rest —
a partial delete would leave you unable to tell what survived.

**Note** — rows are written on the deployment target by `record-deployment.cjs`, so a dev
database is normally empty here. Point `MYHOMEBASE_DB` at a copy of the production
database to read it.
Source: [src/cli/deployments.ts](src/cli/deployments.ts)

---

## `ticker-monitors`

Per-ticker alert conditions on unrealized gain or loss — the same use-cases the ticker
viewer's **Monitor** button drives.

```
npm run cli -- ticker-monitors list NVDA
npm run cli -- ticker-monitors add NVDA gain-amount 10000
npm run cli -- ticker-monitors add INTC loss-amount 0
npm run cli -- ticker-monitors add NVDA gain-pct 20 --band 3
npm run cli -- ticker-monitors enable 4
npm run cli -- ticker-monitors disable 4
npm run cli -- ticker-monitors delete 4
npm run cli -- ticker-monitors run
```

**Input** — a positional action. `add` takes a ticker, a type and a target: `gain-amount`
and `loss-amount` are **dollars** (converted to cents on the way in, as the web form does),
`gain-pct` is a percentage of cost basis. `--band <pct>` sets how close counts as "near";
omitted, the schema's default of 5% applies. `loss-amount 0` is break-even — the useful case,
and the one where the band is taken against cost basis instead of the target.

**Calls** — `listMonitorsForTicker`, `createMonitor`, `setMonitorEnabled`, `deleteMonitor`,
`valuationForTicker` and `runMonitors` from `lib/ticker-monitors`, on
`deps.tickerMonitorRepo` plus `deps.stockPositionRepo` and `deps.messageRepo`.

**Output** — `list` prints the ticker's current unrealized gain and cost basis, then one line
per monitor: enabled marker, id, summary, band, and `[triggered]` if the latch is set. `run`
reports how many were evaluated, fired and re-armed.

**`run` does not fetch prices.** It evaluates against the figures already stored, so pair it
with `refresh-positions` for a full pass — that ordering is what the dashboard button and the
scheduled job both do.

**Exit** — 0 normally. 1 for an unknown action or type, a non-numeric target, or a schema
rejection (a `gain-amount` with no target, a band of 0%).
Source: [src/cli/ticker-monitors.ts](src/cli/ticker-monitors.ts)

---

## `watch-lists`

Watch lists and the watch condition on each row — the same use-cases the Investments
module's **Watch Lists** screen drives.

```
npm run cli -- watch-lists lists
npm run cli -- watch-lists items 1
npm run cli -- watch-lists add 1 NVDA 2026-09-23
npm run cli -- watch-lists watch 4 price 100
npm run cli -- watch-lists watch 4 price-range 10 15
npm run cli -- watch-lists watch 4 dividend
npm run cli -- watch-lists watch 4 gain-loss-pct 20
npm run cli -- watch-lists watch 4 gain-loss-price 10
npm run cli -- watch-lists watch 4 none
npm run cli -- watch-lists run --with-events
```

**Input** — a positional action. `watch` takes an item id, a kind, and whatever value that
kind reads: `price`, `price-range` and `gain-loss-price` are **dollars** (converted to cents
on the way in, as the web form does), `gain-loss-pct` is a plain percentage, and `dividend`
and `split` take no value at all. `none` stops watching. The swing kinds are measured against
the price when the row was added, and fire in **both** directions.

**Calls** — `listWatchLists`, `listItems`, `addItem`, `updateItemWatch`, `listWatchedItems`
and `runWatchListWatches` from `lib/stock-watchlist`, on `deps.stockWatchListRepo` plus
`deps.marketDataClient`, `deps.marketEventsClient` and `deps.messageRepo`.

**Output** — `items` prints one line per row: a `*` when the latch is set, the id, ticker,
added date and price, and what it watches for, with the last alert underneath. `run` reports
how many were evaluated, fired and re-armed.

**`run` fetches its own quotes**, unlike `ticker-monitors run` — a watched ticker is one you
do not hold, so no position refresh has priced it. **Dividends and splits are skipped unless
`--with-events` is passed**, because corporate actions cost one call per ticker on top of the
quote; the scheduled pass always includes them. See
`migrations/0111_add_watch_condition_to_watch_list_items.md`.

**Exit** — 0 normally. 1 for an unknown action or kind, a non-numeric value, or a schema
rejection (a `price` with no value, a range whose high end is not above its low end).
Source: [src/cli/watch-lists.ts](src/cli/watch-lists.ts)

---

## `saved-sql`

The SQL Explorer's saved statements, driving the same use-cases as the **Saved SQL** card
on Admin → SQL Explorer → SQL Query.

```bash
npm run cli -- saved-sql list
npm run cli -- saved-sql show "Recent positions"
npm run cli -- saved-sql save "Recent positions" "Bought this year" "investments,debugging" "SELECT * FROM inv_stock_positions"
npm run cli -- saved-sql delete 3
```

**Input** — a positional action. `show` takes a name, matched **case-insensitively**, the
way the save dialog warns about a collision: whoever types this has the list in front of
them, not the exact stored spelling. `save` takes a name, a description, a
comma-separated tag string as one argument, then the statement — joined from the
remaining arguments, so an unquoted multi-word statement still arrives whole. `delete`
takes an id.

**Calls** — `listSavedQueries`, `saveQuery` and `deleteSavedQuery` from `lib/sql-explorer`,
on `deps.savedQueryRepo`.

**Output** — `list` prints `[id] name [tags]` with the description indented beneath, or
`Nothing saved yet.` `show` prints that summary followed by the statement itself.

**`save` replaces a row with the same name**, matching the card — the table is
`UNIQUE (name)`, so saving is an upsert rather than a create-or-update pair. `delete`
throws on an id that isn't there, so a stale id is an error rather than a silent no-op.

**There is deliberately no `run`.** Loading a saved statement never executes it here
either — use `browse-sqlite` or the web screen's Execute. Statements aren't restricted to
`SELECT`, so a stored `DELETE` must not fire from a command whose name reads like a read.
See `migrations/0112_create_saved_sql_queries.md`.

**Exit** — 0 normally. 1 for an unknown action, a missing name or id, a name that matches
nothing, or a schema rejection (a blank name, an empty statement).
Source: [src/cli/saved-sql.ts](src/cli/saved-sql.ts)

---

## `messages`

The application-wide message queue — the same use-cases the header's bell drives.

```
npm run cli -- messages list
npm run cli -- messages list read
npm run cli -- messages count
npm run cli -- messages read 12 13
npm run cli -- messages read-all
npm run cli -- messages file "Boiler serviced" "Next service due March."
npm run cli -- messages list-all
npm run cli -- messages delete 12 13
npm run cli -- messages prune 30
```

**Input** — a positional action. `list` takes `unread` (the default) or `read`. `read` and
`delete` take one or more ids. `file` takes a title and an optional body, and records `CLI`
as the source. `prune` takes a whole number of days.

**Calls** — `listMessages`, `listAllMessages`, `countMessages`, `markMessagesRead`,
`markAllMessagesRead`, `createMessage`, `deleteMessages` and `pruneMessages` from
`lib/messages`, on `deps.messageRepo`.

**Output** — `list` prints one line per message, newest first, with `*` marking unread, then
the body and source indented beneath. `list-all` prints both halves together, the way
Administration → Message Queue lists them. `read` and `read-all` report how many rows actually
changed — an id already read counts 0 rather than erroring, since two readers on one queue is
ordinary.

**`delete` and `prune` are permanent, and are not mark-read.** `delete` removes the given ids;
`prune <days>` removes every message filed strictly *before* now minus that many days, keeping
the recent ones and clearing the backlog behind them. Both take read and unread alike — age is
the only criterion for `prune`. Nothing calls either on a timer: unlike the sign-in log and the
visit log, the queue has no scheduled prune, so it grows until somebody clears it. The day
count is floored at 1, so `prune 0` is an error rather than a way to empty the table.

**`file` is the point of this command.** A shell script or cron job can put a notice in front
of the household without going through the web app, which is why the queue is a library
use-case rather than a screen.

**Exit** — 0 normally. 1 for an unknown action, a non-integer id, an empty id list, a blank
title, or a prune window outside 1–3650 days.
Source: [src/cli/messages.ts](src/cli/messages.ts)

---

## `game-scores`

Prints the Games module's shared high-score board — the terminal counterpart of the
Arcade and Scores screens.

```
npm run cli -- game-scores
npm run cli -- game-scores --game 2048
npm run cli -- game-scores --game arrow-clearing-hard
npm run cli -- game-scores --game 2048 --limit 25
```

**Input** — all optional. `--game <key>` limits the board to one game, validated
against `GAME_CATALOGUE` (so a typo is reported rather than returning an empty table).
`--limit <n>` defaults to 10 and is capped at 100 by the schema.

**Calls** — `listGames` and `listTopScores` on `deps.gamesRepo`, plus `formatScore` —
the same use-cases the web app calls.

**Output** — with no `--game`, one line per catalogue game (its record, who holds it,
and how many games have been finished) followed by the overall board. With `--game`,
just that game's board. Each row is rank, player, score with the game's unit, moves and
the date. Ties are broken in favour of whoever got there first, matching the screen.

**Exit** — 0 (including when nothing has been played — that's a fact, not an error);
1 when `--limit` is not a positive number, or when the schema rejects a flag (an
unknown `--game`, a `--limit` over the cap). A zod failure is printed through
`messageOf`, so it reads as one line rather than a wall of JSON.
Source: [src/cli/game-scores.ts](src/cli/game-scores.ts)

---

## `tax-lots`

The Tax Lot Analyzer from a terminal — the same `analyzeTicker` use-case the
Investments *Tax Lots* section drives, printed as a table.

```
npm run cli -- tax-lots --ticker NVDA
npm run cli -- tax-lots --ticker NVDA --price 175.50 --eps 0.04
npm run cli -- tax-lots --ticker NVDA --today 2025-01-01
npm run cli -- tax-lots --list
npm run cli -- tax-lots --normalize --ticker NVDA --date 2019-03-15 --shares 10 --price 180
```

**Input** — all optional. `--ticker` defaults to the first ticker with stored lots.
`--price` and `--eps` are dollars and override the held position's current price and
dividend rate, which are otherwise read from `deps.stockPositionRepo` (the same
fallback the web section uses). `--today` overrides the date the holding period is
measured against, which is what makes the long-term boundary testable.

`--list` prints just the tickers that have lots. `--normalize` restates one ad-hoc lot
— ticker, date, raw shares, raw price — showing the splits that apply, the factor, the
adjusted figures and the unchanged cost basis, **without storing anything**.

**Both switches are valueless, and are stripped from argv before `parseFlags` runs.**
`parseFlags` hands every `--flag` the next argv item, so `--normalize --ticker NVDA`
would otherwise parse as `normalize: "--ticker"` and leave `ticker` unset. Removing
them first makes flag order irrelevant — worth copying for the next command that wants
a bare switch.

**Calls** — `listTaxLotTickers`, `analyzeTicker`, and for `--normalize` the pure
`splitHistoryFor` / `normalizeLot` / `splitsAppliedTo`. Validated through
`analyzeLotsSchema` and `normalizeLotSchema`, so argv's raw strings become the typed
input without a cast. **Adding this command required no change to `src/lib`** — the
layering rule paying out.

**Output** — one row per lot (buy date, adjusted shares, adjusted cost/share, cost
basis, gain %, CAGR, yield on cost, LONG/SHORT), then the position summary: lots,
adjusted shares, invested, current value, total gain, blended cost basis, XIRR, blended
yield on cost and the long/short split. A trailing line counts the lots marked `*` —
long-term *and* in profit, the tax-efficient ones to trim. XIRR prints
`n/a (needs more than one purchase date)` rather than 0%.

**Exit** — 0 including when nothing is recorded (a fact, not an error); 1 when no
ticker can be resolved, when the ticker has no usable price and no `--price` was given,
or when either schema rejects a flag.
Source: [src/cli/tax-lots.ts](src/cli/tax-lots.ts)

---

## `browse-sqlite`

The Tools module's *SQLite File Browser* from a terminal — the same use-cases the web
view drives, through the same `deps`.

```
npm run cli -- browse-sqlite
npm run cli -- browse-sqlite --upload ./chinook.db --user 1
npm run cli -- browse-sqlite --db 3
npm run cli -- browse-sqlite --db 3 --table customers
npm run cli -- browse-sqlite --db 3 --table customers --delete "4,9"
npm run cli -- browse-sqlite --db 3 --remove
```

**Input** — all optional; the flags select the mode. No flags lists the uploaded files
with their ids. `--upload <path>` adds one, `--user <id>` attributing it (an
unparseable id is treated as unattributed rather than failing the upload). `--db <id>`
alone lists that file's tables; with `--table <name>` it prints the rows, rowid first;
with `--delete "<rowids>"` it deletes those rows; with `--remove` it forgets the file
and deletes it from disk.

**Output** — the row listing is tab-separated with a `rowid` column first, so ids can
be copied straight back into `--delete`. A capped read says how many of how many rows
it showed. NULL prints as `NULL`, and a BLOB as its type and size rather than its
bytes.

**Exit** — 0 including when nothing has been uploaded (a fact, not an error); 1 when
`--db` is not a positive integer, when `--delete` parses to no rowids, when the id is
not listed, when the file has gone from disk, or when a schema rejects the input (a
non-SQLite file, one over the configured upload cap, a table name that is not an
identifier). The cap is the one an admin set under Configuration → Application, read
through `getMaxUploadBytes` — the same value the web upload enforces.
Source: [src/cli/browse-sqlite.ts](src/cli/browse-sqlite.ts)

---

## `browse-csv`

The Tools module's *CSV File Browser* from a terminal — the same use-cases the web view
drives, through the same `deps`. A delimited file is one table by definition, so there is
no table-picking step: one fewer than `browse-sqlite`.

```
npm run cli -- browse-csv
npm run cli -- browse-csv --upload ./people.csv --user 1
npm run cli -- browse-csv --upload ./log.txt --delimiter tab --no-header
npm run cli -- browse-csv --file 3
npm run cli -- browse-csv --file 3 --offset 1000
npm run cli -- browse-csv --file 3 --set "city=Bath" --rows "4,9"
npm run cli -- browse-csv --file 3 --delete "4,9"
npm run cli -- browse-csv --file 3 --export
npm run cli -- browse-csv --file 3 --remove
```

**Input** — all optional; the flags select the mode, checked in the order below. No flags
lists the uploaded files with their ids.

| Flag | Type | Notes |
|---|---|---|
| `--upload` | path | Adds one file. `--user <id>` attributes it |
| `--delimiter` | text | `comma`/`tab`/`semicolon`/`pipe`, overriding what the import sniffed |
| `--no-header` | boolean | Row 1 holds data, not column names |
| `--file` | id | Reads that file's rows |
| `--offset` | integer | The next slice of a capped read |
| `--set` | `key=value` | Several pairs separated by `;`. An empty value clears the column |
| `--rows` | ids | Which rows `--set` applies to |
| `--delete` | ids | Deletes those rows |
| `--export` | boolean | Writes the file back out, edits and all |
| `--remove` | boolean | Forgets the file and deletes it from disk |

`--rows` and `--delete` take the ids printed in the first column by a plain `--file` read,
so they can be copied straight back in — the same ids the grid's checkboxes address.

**Output** — tab-separated with the row id first. A capped read says how many of how many
rows it showed, so `--offset` can be stepped by exactly one window.

**Exit** — 0 including when nothing has been uploaded (a fact, not an error); 1 when
`--file` is not a positive integer, when the id is not listed, when the file has gone from
disk, or when a schema rejects the input — an undelimited file, an unreadable delimiter, or
one over the configured upload cap. The cap is the admin-set value under Configuration →
Application, the same one the web upload enforces.
Source: [src/cli/browse-csv.ts](src/cli/browse-csv.ts)

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

## `csv-views`

CSV Analysis **custom views** — the saved column/filter/sort definitions the *Custom
Views* screen drives. `read` is the interesting one: it compiles the view to SQL and
prints a page, which exercises the query against a real table without a browser.

```
npm run cli -- csv-views list [--entry 3]
npm run cli -- csv-views show --id 2
npm run cli -- csv-views create --entry 3 --name "Big sales" \
                 --columns city,amount \
                 --where "amount>=100" --where "city in Rome,Oslo" \
                 --order "amount:desc" --order "city:asc" \
                 --per-page 25 [--disabled]
npm run cli -- csv-views update --id 2 --name "Renamed" --columns "" --per-page 50
npm run cli -- csv-views enable --id 2
npm run cli -- csv-views disable --id 2
npm run cli -- csv-views delete --id 2
npm run cli -- csv-views read --id 2 [--page 2]
npm run cli -- csv-views operators
```

**Subcommands**

| Subcommand | Does | Writes |
|---|---|---|
| `list` | every view, or one dataset's with `--entry` | no |
| `show` | one view's full definition | no |
| `create` | a new view on `--entry` | yes |
| `update` | replaces a view's whole definition | yes |
| `enable` / `disable` | flips `isEnabled` | yes |
| `delete` | removes the view (the data is untouched) | yes |
| `read` | runs the view, prints one page tab-separated | no |
| `operators` | the operator catalogue and each one's arity | no |

**Flags**

| Flag | Values | Notes |
|---|---|---|
| `--entry` | dataset id | required for `create`; filters `list` |
| `--id` | view id | required for `show`/`update`/`enable`/`disable`/`delete`/`read` |
| `--name` | text | required for `create` |
| `--description` | text | optional |
| `--columns` | comma-separated | `--columns ""` explicitly means *every column* |
| `--where` | **repeatable** criterion | see the grammar below |
| `--order` | **repeatable** `column` or `column:desc` | direction must be `asc`/`desc` |
| `--per-page` | integer | default `100` |
| `--disabled` / `--enabled` | bare switch | `create` defaults to enabled |
| `--page` | integer | `read` only, default `1` |

**Criterion grammar** — `--where` accepts a symbol form or a word form. Symbols are
matched longest-first, so `>=` is never read as `>`:

```
amount>=100          symbol operator   (>=, <=, <>, !=, >, <, =)
city is empty        word operator, no value
city in Rome,Oslo    word operator, comma-separated list
amount between 1 20  word operator, two space-separated values
```

`--where` and `--order` are re-scanned from argv rather than read through `parseFlags`,
which keeps only the last occurrence of a repeated key. A shell is a bad place to quote
JSON, which is why these are repeatable flags rather than one blob.

⚠️ **`update` replaces the whole definition.** Any part not passed is re-sent as it
currently stands, so `--name X` alone does not clear the criteria — but a passed
`--where` replaces *all* of them.

**Calls** — `createCustomView` / `updateCustomView` / `setCustomViewEnabled` /
`deleteCustomView` / `readCustomViewPage` against `deps.csvAnalyticsRepo`.

**Output** — `read` prints the source headers then tab-separated rows, followed by a
`N matching records · page X of Y` footer. The others print the view's detail block.

**Exit** — `0` on success; `1` on an unknown subcommand, a missing/invalid id, or a
schema rejection, with the message on stderr.
Source: [src/cli/csv-views.ts](src/cli/csv-views.ts)

---

## `import-csv-files`

Pools **several CSV files into one dataset** — the CLI peer of *CSV Analysis → Import
Files*. All the files must share a header shape; each one contributes a label column
value so rows stay attributable to their source.

```
npm run cli -- import-csv-files plan "Master Bathroom_export.csv" Basement.csv
npm run cli -- import-csv-files create --name "Humidity" --table humidity --label Room \
                 "Master Bathroom_export.csv" Basement.csv
npm run cli -- import-csv-files append --entry 3 NewRoom.csv
npm run cli -- import-csv-files help
```

**Subcommands**

| Subcommand | Does | Writes |
|---|---|---|
| `plan` | previews columns, per-file row counts and header mismatches | no |
| `create` | creates the dataset and its table | **yes** (creates a table) |
| `append` | adds more files to an existing dataset | **yes** |

**Flags**

| Flag | Values | Notes |
|---|---|---|
| `--name` | text | required by `create` |
| `--table` | table base name | required by `create`; the 3-letter-prefixed table is derived from it |
| `--description` | text | optional |
| `--entry` | dataset id | required by `append` |
| `--label` | column name, **repeatable** (max 3) | e.g. `--label Room` |
| `--value` | `<file.csv>=<value>` , **repeatable** | that label's value for one file |

Everything that is not a flag is treated as a **file path**. When `--value` is omitted
for a file, the value defaults to `suggestSourceName(fileName)` — the name inferred from
the filename, which is usually what you want.

`append` cannot redefine the label columns: it reuses the dataset's own, read back off
`existing.sourceColumns`.

**Calls** — `planPooledImport`, `importPooledFiles`, `appendPooledFiles` against
`deps.csvAnalyticsRepo`. Files are read with `readFileSync`.

**Output** — `plan` prints the data columns, the source columns, a per-file row count and
the total, then any header mismatches. `create`/`append` print the resulting entry id,
table name and row count.

**Exit** — `0` on success; `1` when no file is named, when `create` lacks `--name`/
`--table`, when `append` lacks a valid `--entry`, on an unknown subcommand, or when
`plan` finds files that cannot be pooled together.
Source: [src/cli/import-csv-files.ts](src/cli/import-csv-files.ts)

---

## `csv-source-stats`

Per-source statistics over a **pooled** dataset — the CLI peer of *CSV Analysis →
Compare*. Prints the same figures the screen shows, from the same use-case, which is how
the arithmetic gets checked without a browser.

```
npm run cli -- csv-source-stats 3
npm run cli -- csv-source-stats 3 --by room --measure humidity
npm run cli -- csv-source-stats 3 --decimals 3
npm run cli -- csv-source-stats help
```

**Input** — the entry id is a **positional**, not a flag.

| Flag | Values | Default |
|---|---|---|
| `--by` | the source column to group by | the first groupable one |
| `--measure` | the numeric column to summarise | the first measurable one |
| `--decimals` | integer | `2` |

Run with just an entry id to see which columns are available — both lists are echoed
above the table.

**Calls** — `groupableSourceColumns`, `measurableColumns` and `readSourceStats` against
`deps.csvAnalyticsRepo`. Read-only.

**Output** — one line per source with `n`, `avg`, `med`, `min`, `max`, `sd` and
`missing`, then a combined row, then a `Highest / lowest` line.

**Exit** — `0` on success; `1` when the id is not a number, when there is no such entry,
when the dataset was **not created as a pooled import** (so it has no source column to
group by), or when it has no numeric column to summarise.
Source: [src/cli/csv-source-stats.ts](src/cli/csv-source-stats.ts)

---

## `import-journal-ics`

Imports calendar events from an **`.ics` file** into the Journal — the same filter,
presets and review the *Calendar Import* wizard offers. Every decision lives in
`@/lib/journal`, so this command and the web screen cannot disagree about what a file
means.

```
npm run cli -- import-journal-ics --file ./calendar.ics --dry-run
npm run cli -- import-journal-ics --file ./calendar.ics --from 2026-01-01 --to 2026-12-31
npm run cli -- import-journal-ics --file ./calendar.ics --review
npm run cli -- import-journal-ics --file ./calendar.ics --categories "Log,Travel" --place "Home"
npm run cli -- import-journal-ics --file ./calendar.ics --skip-dates 2026-03-04,2026-03-05
```

**Filter flags**

| Flag | Values | Default |
|---|---|---|
| `--file` | path to the `.ics` | **required** |
| `--from` / `--to` | `YYYY-MM-DD` | unbounded |
| `--contains` / `--excludes` | text matched against the summary | none |
| `--require-title` | bare switch — drop events with no summary | off |
| `--no-all-day` | bare switch — drop all-day events | all-day included |

**Preset flags** — applied to each imported entry

| Flag | Values | Default |
|---|---|---|
| `--categories` | comma-separated | `Log` (pass `--categories ""` to opt out) |
| `--tags` | comma-separated | none |
| `--place` | place name | none |
| `--note` | note prefix | none |
| `--replace` | bare switch — overwrite the reader's own fields on a matched entry | off (local edits preserved) |

**Mode flags**

| Flag | Effect |
|---|---|
| `--dry-run` | prints the plan (`create` / `refresh` / `skip` per event); **writes nothing** |
| `--review` | prints what the journal already holds on the dates this import would touch, then stops — unless combined with `--dry-run` |
| `--skip-dates` | comma-separated `YYYY-MM-DD`; every event on a listed date is dropped |

A **repeating event imports its first occurrence only**, and the count of them is called
out before anything is written.

**Calls** — `readIcsFile`, `buildIcsImportReview`, `applyIcsReviewDecision`,
`planIcsImport` and `importIcsEvents` against `deps.journalRepo`.

⚠️ **Writes unless `--dry-run` or a bare `--review` is given.** `--replace` is the
destructive one: it overwrites fields on already-matched entries. The web screen confirms
against a plan first; a CLI run has already made its choice by typing the flag.

**Output** — a header counting events in the file, matching the filter, and skipped as
unreadable; then the plan or the import summary, with a reason line per skipped row.

**Exit** — `0` on success; `1` when `--file` is missing or the file cannot be read/parsed.
Source: [src/cli/import-journal-ics.ts](src/cli/import-journal-ics.ts)

---

## `resize-carousel-images`

⚠️ **Writes, and there is no undo beyond a database restore.** Re-encodes carousel
graphics that are **already stored**, so ones uploaded before the resizer existed catch
up without being re-uploaded by hand. Nothing used to resize these: the upload control
only rejected files over 2 MB, so a full-size photo was stored whole and then downloaded
whole to fill a 192px tile.

```
npm run cli -- resize-carousel-images --dry-run
npm run cli -- resize-carousel-images
npm run cli -- resize-carousel-images --max-edge 256
npm run cli -- resize-carousel-images --help
```

| Flag | Values | Default |
|---|---|---|
| `--dry-run` | bare switch — report without writing | off |
| `--max-edge` | pixels, `32`–`4096` | `800` (`CAROUSEL_IMAGE_MAX_EDGE`) |
| `--help` / `-h` | print usage | — |

Downscales each graphic to fit the target and re-encodes as **WebP**. It never upscales
and never crops. An **animated GIF is left alone**, because flattening it to its first
frame would silently kill the animation.

**Safe to run repeatedly** — a second pass over an already-resized WebP is inside the box
and already the right format, so it is reported as skipped rather than rewritten. One
unreadable image does not abort the rest.

**Calls** — `deps.moduleRepo.listAllCarouselImages()`, then `resizeCarouselImage` and
`setModuleCarouselImage`. It writes through the **use-case** rather than a direct repo
call so the slug check and the `updated_at` stamp stay in one place — that stamp is the
`?v=` cache-buster, without which a browser keeps serving the old bytes.

**Output** — one line per graphic (`before -> after`, dimensions, percent saved, or why
it was skipped), then a `Rewrote N / skipped N / failed N / KB saved` summary.

**Exit** — `0` normally, including when nothing is stored; `1` on an out-of-range
`--max-edge` or a failure listing the stored images.
Source: [src/cli/resize-carousel-images.ts](src/cli/resize-carousel-images.ts)

---

## `favorite-quotes`

Prints the favorites jump list with its last-refreshed prices — the same use-case the
star menu renders, formatted for a terminal. Takes **no arguments**.

```
npm run cli -- favorite-quotes
```

**Calls** — `listFavoriteQuotes(deps.tickerFavoriteRepo, deps.stockPositionRepo)`.
Read-only, no network.

Prices come from `inv_positions`, so they are **only as fresh as the last
`refresh-positions` run** — pair the two if you want current figures. A favorite you do
not hold has no position row and prints `—  (not held)` rather than a stale price.

**Output** — one line per favorite: ticker, price, signed day gain/loss, day change
percent, the `as of` timestamp, and the name when known.

**Exit** — always `0`, including when there are no favorites (a fact, not an error).
Source: [src/cli/favorite-quotes.ts](src/cli/favorite-quotes.ts)

---

## `recipes`

The Household module's recipe box from a terminal — the same use-cases the Recipes
screen drives.

```
npm run cli -- recipes
npm run cli -- recipes --search chicken
npm run cli -- recipes --category Dessert
npm run cli -- recipes --tag freezer
npm run cli -- recipes --list-tags
npm run cli -- recipes --list-categories
npm run cli -- recipes --show 3
npm run cli -- recipes --add "Roast chicken" --rating 9 --tags "sunday, easy"
npm run cli -- recipes --add "Chili" --ingredients "2 onions\n1kg beef" --directions "Brown the beef\nSimmer 2h"
npm run cli -- recipes --made 3
npm run cli -- recipes --delete 3
```

**Input** — all optional; with no flags it lists everything. `--search` matches the
name, description *and* ingredients, exactly as the screen's one box does. `--category`
filters by category, case-insensitively, so a lower-cased flag still finds a stored
"Dessert". `--tag` filters by tag. The two combine, and combine with `--search`.
`--list-tags` and `--list-categories` each print that vocabulary with counts and stop.
Both are named separately from `--tags`/`--category`, which are the *values* passed to
`--add`, because `parseFlags` takes the next argv element as a flag's value and one
name cannot mean both. `--add` takes a
name plus optional `--description`, `--ingredients`, `--directions`, `--notes`,
`--rating`, `--category`, `--source` and `--tags`. A category is stored as typed — it is
not lower-cased the way tags are, and it is never split on a delimiter, since a recipe
has exactly one. **Multi-line fields take `\n` escapes**, since a real newline is
awkward to pass through a shell.

**Calls** — `listRecipes`, `getRecipe`, `createRecipe`, `incrementMadeCount`,
`deleteRecipe`, `listRecipeTags`, `listRecipeCategories` and `toLines`, all through
`@/lib/household` — the
same use-cases and the same zod schemas the web app calls, so a rating of 11 or a
malformed `--source` is rejected identically in both.

**Output** — the list prints id, rating, made count, name, category in `(round
brackets)` and tags in `[square ones]`, one per line, with a total. The two bracket
styles distinguish the one-per-recipe value from the many-per-recipe list at a glance. `--show` prints the whole recipe: the header figures, then the ingredients as
a bulleted list and the directions numbered, both split by `toLines`. An unrated recipe
prints `-`, never `0`.

**The picture is deliberately not settable here.** The only sensible terminal form is a
file path, and the use-case takes decoded bytes with a validated mime type. That is a
gap in convenience rather than in reach — every other field round-trips.

**Exit** — 0 normally, including when nothing matches (a fact, not an error); 1 when
`--show`, `--made` or `--delete` names an id that does not exist, or when a schema
rejects a value.
Source: [src/cli/recipes.ts](src/cli/recipes.ts)

---

## `todo`

The household's TODO lists from a terminal — the same use-cases the Tools screen and
the home card drive.

```
npm run cli -- todo
npm run cli -- todo --all
npm run cli -- todo --list "To BUY"
npm run cli -- todo --add "Costco LR44 battery" --list "To BUY"
npm run cli -- todo --add "Instrument analysis" --list "Work TODO" --notes "SpectraMax L"
npm run cli -- todo --done 12
npm run cli -- todo --undone 12
npm run cli -- todo --delete 12
npm run cli -- todo --new-list "Learning"
npm run cli -- todo --rename-list 3 --name "Reading"
npm run cli -- todo --delete-list 3
npm run cli -- todo --clear-completed "To BUY"
```

**Input** — all optional; with no flags it prints every list and its outstanding
items. `--all` includes the completed ones, which are otherwise summarised as a count.
`--list` narrows to one list, matched on its **name**, case-insensitively — a terminal
knows the name, not the id. `--add` needs `--list` to say where, and takes an optional
`--notes` for the detail line. `--done`, `--undone` and `--delete` each take an item
**id**, which the listing prints first on every row for exactly that reason.

`--rename-list` takes the list's id plus `--name`, rather than the name plus a new one:
renaming is the one operation where matching on the old name is ambiguous with
recapitalising it. `--delete-list` is refused while the list still holds anything,
completed items included, and prints the counts the refusal names.

There is deliberately **no `--user` flag**. Every list and item is the household's
(migration 0123), so nothing here is filtered by person; the `created_by` attribution a
web add records is left unset from the terminal rather than inventing an identity for
it.

**Calls** — `buildTodoBoard`, `createItem`, `setItemDone`, `deleteItem`,
`clearCompleted`, `listCategories`, `createCategory`, `renameCategory` and
`deleteCategory`, all through `@/lib/todo` — the same use-cases and the same zod
schemas the web app calls, so a blank title or a duplicate list name is rejected
identically in both.

**Exit code** — `1` when a list or item id does not exist, when a delete is refused
because the list is not empty, or when a schema rejects a value.
Source: [src/cli/todo.ts](src/cli/todo.ts)

---

## menu-items

```
npm run cli -- menu-items list [--module <slug>] [--renamed] [--filter <text>]
npm run cli -- menu-items set <id> [--title <text>] [--hint <text>]
npm run cli -- menu-items reset <id>
```

Every navigable destination in the application — each module's sections, every
Administration screen, and Home — with the **permanent id** that addresses it. The
terminal peer of Administration → Display Settings → Menu Items.

`list` groups by owning module and marks a renamed item with `*`. `--module admin`
selects the Administration screens; Home belongs to no module and always appears
first. `--filter` matches the id, the title, the description or the module name,
which is what makes it usable against ~88 rows.

**An item's id is its icon slot id** (`journal_section_locations`), so the same
string addresses its artwork on Admin → Display Settings → Icons. There is no
separate menu-item id space and no counter — the id derives from the section slug.
See `coding-guide.md` → *Menu items: the id is the slot id*.

`set` with `--title ""` restores the shipped name, which is the same thing `reset`
does; `--hint ""` is different — it clears the description to nothing deliberately,
because plenty of sections ship without one. Writing values that match the shipped
ones removes the override row rather than storing a no-op.

**Calls** — `listMenuItems`, `setMenuItemOverride` and `clearMenuItemOverride`
through `@/lib/menu-items`, over the same `createMenuItemSource` the web app builds
its navigation from, so the ids and titles are identical in both.

**Exit code** — `1` when the id names no menu item, when a title exceeds 60
characters or a description 200, or when no `--title`/`--hint` is given to `set`.
Source: [src/cli/menu-items.ts](src/cli/menu-items.ts)

---

## toolbars

```
npm run cli -- toolbars list
npm run cli -- toolbars add --name <text> [--edge top|bottom|left|right] [--background <colour>] [--border <colour>] [--text <colour>] [--full-mode-only] [--hidden]
npm run cli -- toolbars set <id> [--name <text>] [--edge <edge>] [--visible 0|1] [--full-mode-only 0|1]
npm run cli -- toolbars delete <id>
npm run cli -- toolbars add-item <toolbarId> --screen <menuItemId> [--label <text>]
npm run cli -- toolbars add-item <toolbarId> --separator
npm run cli -- toolbars add-item <toolbarId> --space
npm run cli -- toolbars remove-item <itemId>
```

An item is one of three kinds. The last two are easy to confuse and are deliberately
separate:

| Flag | Kind | Along the bar | Visible |
|---|---|---|---|
| `--screen <id>` | a shortcut | one button | yes |
| `--separator` | a **drawn dividing line** | ~1px | **yes** |
| `--space` | **flexible empty space** — pushes what follows to the far end | all the slack | no |

`--label` is the shortcut's **tooltip**, not visible text — a toolbar row is its icon
alone, so this is the only thing naming it. Omit it to use the screen's own name.

There was a fourth kind, `--heading`, which drew a text caption. It was removed in
migration 0127: a label cannot fit a 44px bar of glyphs, so it truncated to nothing.
Use `--separator` to group instead.

Personal toolbars — strips of shortcuts docked to a screen edge. The terminal peer
of Administration → Display Settings → Personal Toolbars.

**A toolbar is additive chrome.** It sits beside the navigation tree and the compact
bottom bar rather than replacing either, so nothing here can remove navigation from
anyone's screen. The worst a mistake does is add a bar, and `delete` undoes it.

`list` prints each bar with its edge, its flags and its rows. A row whose menu item
no longer exists is flagged `MISSING … — not shown`: it is silently dropped from the
real toolbar, so this is the only place to discover one in order to `remove-item` it.

A screen is named by its **menu item id** — run `menu-items list` to find one. The id
is also its icon slot id, so a shortcut draws whatever artwork that screen shows in
the navigation tree.

`set` leaves any flag you omit at its stored value. Colours are hex or
`rgb()`/`hsl()`; omit one to follow the application's theme, which is the default and
keeps the bar in step when the colour scheme changes. `add` defaults to **visible**
(pass `--hidden` for otherwise), because creating a bar and finding nothing on screen
reads as a failure.

Note `is_visible` here is the **administrator's** switch — it hides the bar from
everyone. Each reader's own show/hide is a preference set from their Account page and
is deliberately not reachable from this command, which has no session to act for.

**Calls** — `listToolbars`, `createToolbar`, `updateToolbar`, `deleteToolbar`,
`addToolbarItem` and `removeToolbarItem` through `@/lib/toolbars`, with the same zod
schemas the web app uses, so a bad colour or a headless heading is rejected
identically in both.

**Exit code** — `1` when a toolbar or item id does not exist, when a colour is not a
hex/`rgb()`/`hsl()` value, when an edge is not one of the four, when a `--screen`
names no menu item, or when `add-item` is given none of
`--screen`/`--separator`/`--space`.
Source: [src/cli/toolbars.ts](src/cli/toolbars.ts)

---

## `hsa`

The Household module's HSA Tracker from a terminal — the same use-cases the HSA Tracker
screen drives.

```
npm run cli -- hsa
npm run cli -- hsa --show 3
npm run cli -- hsa --add "Prescription" --amount 42.50 --payee CVS --type Pharmacy
npm run cli -- hsa --add "Eye exam" --amount 120 --payee "Dr. Lee" --type Vision --date 2026-09-01 --paid-with "Visa 1234" --receipt ./receipt.jpg
npm run cli -- hsa --reimburse 3,4
npm run cli -- hsa --unreimburse 3
npm run cli -- hsa --delete 3,4
npm run cli -- hsa --cards
npm run cli -- hsa --add-card "Visa 1234"
npm run cli -- hsa --delete-card 2
npm run cli -- hsa --receipt-root
npm run cli -- hsa --set-receipt-root //NAS_DS223/app/myhomebase/hsa-receipts
```

**Input** — with no flags it lists every expense, newest first. `--add` takes the product
or service as its value, plus `--amount` (dollars), `--payee` and `--type` (Pharmacy,
Medical, Dental, Vision, Transportation, Dependent Care or Other), and optionally
`--date`, `--time` (both default to now, as the web form does), `--service-date`,
`--paid-with`, `--note`, `--reimbursed yes` and `--receipt <path>`. The receipt's type is
read from its extension (PNG, JPEG, WebP, GIF, PDF) and the file is filed in the
receipt folder under the year of the expense's date. It is stored byte-for-byte, up to
15 MB — only the web editor's camera button ever re-encodes anything, and a file named
on the command line is usually already the size it should be. `--receipt-root` prints the configured folder;
`--set-receipt-root` sets it, checking it is writable first, and a blank value clears it.
With no folder set, `--receipt` is refused.

**Calls** — `listHsaExpenses`, `getHsaExpense`, `createHsaExpense`, `setHsaReceipt`,
`setHsaReimbursed`, `deleteHsaExpenses`, `listHsaCards`, `createHsaCard`,
`deleteHsaCard`, `getHouseholdSettings` and `setHsaReceiptRoot`, through `@/lib/household` — the same zod schema the form uses, so a zero
amount, a third decimal or an unknown type is rejected identically in both.

**Output** — one line per expense: id, date, amount, `reimbursed` or `OPEN`, whether a
receipt is attached, and product — payee (type). `--show` prints the whole record.

**Deleting removes the receipt file too**, as the screen does. A file that could not be
removed is named on stderr and sets exit 1, because the rows are already gone and
retrying the delete would not fix it.

**Exit** — 0 normally, including an empty list; 1 when `--show` names an id that does
not exist, a schema rejects a value, or a receipt file could not be deleted.
Source: [src/cli/hsa.ts](src/cli/hsa.ts)

