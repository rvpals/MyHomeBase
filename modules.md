# Modules

The registry of MyHomeBase's feature modules, and the recipe for adding another
one consistently.

This complements — does not replace — `ARCHITECTURE.md` (layering and the
module boundary rules), `coding-guide.md` (table prefixes and migrations),
`components.md` (reusable UI), and `design.md` (styling). Read this one before
creating a module or changing what a module *is*; read those for how to write the
code inside it.

## What a module is here

Two senses of the word, and they must not be confused:

- **A registered feature module** — a row in `sys_modules`. It has a slug, names,
  a description, a sequence, an icon, and optional carousel artwork. It appears
  on the home grid and the app bar, is grantable per-user, and is reachable at
  `/modules/<slug>`. That's what this document registers.
- **A library module** — a folder under `src/lib/`, used only via its `index.ts`
  (`ARCHITECTURE.md` → *Modules*). A feature module owns one or more of these;
  plenty of library modules (`auth`, `weather`, `settings`) back no feature
  module at all.

## The registry

Field names below are the domain type's (`Module` in
[src/lib/modules/types.ts](src/lib/modules/types.ts)); the `sys_modules` columns
are the `snake_case` equivalents.

| Slug | Short name | Long name | Description | Seq | Icon | Prefix |
|---|---|---|---|---|---|---|
| `stock-etfs` | Stocks & ETFs | Stock & ETFs etc | Manage stock and ETF investments. | 2 | `chart` | `stk_` |
| `journal` | Journal | My Journal | A place to keep a journal with daily recordings. | 3 | `journal` | `jrn_` |
| `csv-analysis` | CSV Analysis | CSV Data Analysis | Import a CSV file for analytics. | 4 | `folder` | `csv_` |
| `expense` | Expense | Expense Tracker | Track credit-card spending by category. | 5 | `wallet` | `exp_` |
| `attendance` | Attendance | Class Attendance | Take daily attendance for a class. | 6 | `roster` | `att_` |
| `music-library` | Music Library | My Music Library | Browse and stream your music collection. | 7 | `music` | `mus_` |

Sequence 1 is deliberately vacant: it belonged to the Real Estate module, retired
in `migrations/0026_drop_real_estate_module`. Its `rei_` prefix is retired with
it and must not be reused.

`sys_` is the platform prefix — settings, users, sessions, module registration
itself. It is not a feature module and never appears in the table above.

Short name is what the UI shows (home grid, app bar, nav badge). Long name is the
fuller title for admin screens. Both are **admin-editable at runtime**, so no
component may hardcode either — read them from the module row, as
[attendance-section.tsx](src/app/(protected)/modules/[slug]/attendance-section.tsx)
does before badging the nav.

### Per-module detail

**Stocks & ETFs** (`stock-etfs`) — the largest module. Brokerage accounts,
positions, transactions, watch lists, a daily-glance dashboard, ticker detail
with news and risk, and CSV import from broker statements. Backed by several
library modules (`stock-positions`, `stock-analytics`, `stock-watchlist`,
`stock-daily-snapshot`, `investment-accounts`, `market-data`, `market-indexes`,
`ticker-*`) that all share the one `stk_` table prefix — though several of the
newest (`stock-simulation`, `market-indexes`) own no table at all.

The **Simulation** section answers "had I bought this then?" — one ticker, a share count,
and any of ten windows (1 Week through MAX) ticked at once. It **adds no table and no
migration**: nothing is saved, because a run is a question rather than a position, and
every price is fetched live from the chart feed already wired for the rest of the module.
Its own library module, `src/lib/stock-simulation`, holds the arithmetic; it depends on
`src/lib/market-data` through that module's `index.ts` and needs no repository at all.
Four choices worth knowing:

- **A range is a hypothetical *entry date*, not a holding period going forward.** "6 M"
  buys at the close six months ago and holds to today, so every row shares one current
  price and differs only in what it assumes you paid — which is what makes ticking
  several at once the point of the screen. The alternative reading (buy today, hold six
  months) would need a price forecast, and there isn't one.
- **The results are one `DataGrid`, not a card per range.** Every range reports the same
  five figures, so a table lets them be compared down a column, which is the reason to
  tick several at once. It cost nothing to get right: the grid is the app's mandated
  table, and below 1024px it delegates to `DataGridCompact`, turning each range back into
  a card where eight columns wouldn't fit.
- **The Price Overlay is normalized on both axes** — x is progress through each window
  (0–100%), y is percent change from that window's own buy price. Plotted as real dates
  and real dollars, a ten-year line would squash a one-week line into a few pixels at the
  right edge; normalizing is what lets them share an axis. Every line starts at 0%.
- **A range that fails is reported, not thrown.** Windows are fetched in parallel and
  settled independently, so a symbol younger than its ten-year window is listed under the
  table as unavailable while the rest still report. A fresh listing legitimately fails
  everything but the shortest.
- **`1wk` and `2wk` are fetched as `1mo` and trimmed.** Yahoo has no two-week range, and
  its one-week range only pairs with intraday intervals — asking for `1wk`/`1d` returns
  about five bars with the first often missing, and that first bar *is* the buy price.
  Trimming measures back from the series' own last bar, not from now, so a run on a Sunday
  can't lose Friday's close.

Gain/loss is **price return only** — dividends, fees and taxes aren't counted, and the
screen says so beside the Run Sim button.

The dashboard opens on an **Indexes** card — the major benchmarks, above your own
portfolio, because "how did the market do?" is the question that frames every number
below it. `src/lib/market-indexes` holds the catalogue (eleven symbols in four groups:
the S&P, NASDAQ, Dow, Russell and VIX; gold, silver and WTI; the 10-year yield and the
dollar index; bitcoin) and the one fetch over it. It adds **no table and no migration** —
nothing is stored, because a market level is a reading rather than a record, and every
quote comes from the chart feed already wired for the rest of the module. Four choices
worth knowing:

- **Nothing is fetched on page load.** Eleven calls to an unauthenticated provider on
  every visit to the dashboard would make the module's landing screen pay for a card that
  may be collapsed, so the card ships empty with a **Refresh all** button in its header
  (`CollapsibleCard`'s `headerAction` slot, which sits outside the toggle) that fetches
  the whole board on demand. The result lives in the card's own state until the next press.
- **A level carries its unit.** `^GSPC` is a point level, `GC=F` is dollars an ounce, and
  `^TNX` is a percentage already — so `IndexUnit` travels with every row and the view
  formats by it. Printing all three as currency was the obvious bug to avoid: the S&P is
  not worth $7,675.
- **A dead symbol is reported, not thrown.** Symbols are fetched in parallel and settled
  independently, so one 429 leaves the other ten on screen and names the missing one
  underneath. A card that blanked because gold timed out would be worse than one that
  says so.
- **It is the first widget, and existing layouts get it first too.** Shipping a widget at
  the top of `DASHBOARD_WIDGET_IDS` exposed a flaw in `resolveDashboardWidgets`: it
  *appended* unknown-but-new widgets, so every user with a saved layout would have found
  the new card at the bottom. It now inserts a new widget before its nearest already-known
  catalogue successor, which puts Indexes first for a default layout and beside its
  neighbours for a reordered one — without overriding any ordering the user chose.

The dashboard heading carries a **ticker search** — a magnifier that suggests symbols
the system already knows, partial-matched. `src/lib/ticker-search` owns the matching:
it merges the three places a symbol can already be known from (positions, watch-list
items, cached profiles), keeping the strongest per symbol, and ranks prefix hits above
substring ones. It adds **no table** — every source already exists. Free text is
allowed, and which tab the viewer opens on depends on the answer: a symbol we hold or
watch opens on *Our data*, one we've never seen opens on the *Yahoo* tab, because its
own-data cards would all be empty. Matching is on the **symbol only** — no company
name is stored anywhere (`stk_ticker_profiles` holds sector and industry, not a name),
so matching one would have meant a migration for a search box.

Beside it sits a **favorites** star — a short hand-picked jump list for the symbols you
open every morning, which is the want a search box does *not* serve. `stk_ticker_favorites`
(`migrations/0058`) holds one row per symbol, keyed by the ticker itself since a favorite
has no identity beyond it. Starring happens in **one place** — the ticker viewer's header —
because every ticker in the app already opens that dialog, so one control covers the
positions grid, the transaction list, a watch list, a mover row and both dashboard
dropdowns. Favorites are **shared and independent of watch lists**: a favorite carries
nothing but the symbol, where a watch-list item carries shares, an add-price and a
reminder. `0058` records why that isn't unified, and why nothing prunes a favorite whose
position was sold.

**Journal** (`journal`) — dated entries with categories, tags, locations (with a
map), and images; saved filters; CSV import. A filter query travels in the URL
(`?filter=`) so a filtered list is linkable. Library: `src/lib/journal`.

The **Calendar** section shows those entries as a grid, in one of three ranges —
week, month or year — with the range, the period and the clicked day all in the URL
(`?scope=&anchor=&date=`), so a particular month with a day open is a bookmark. It
**adds no table**: every cell is drawn from `jrn_entries` rows that already exist, read
by one `listEntriesInDateRange` call bounded by the visible period rather than by
filtering the whole table in memory.

The date arithmetic lives in `src/lib/journal/calendar.ts` as pure functions over ISO
strings — grid shape and padding, the ‹ › stepping, the 30-character title elision, the
year view's heat scale, and parsing a typed date. Nothing about a calendar is computed in
the view, which is why `journal-calendar` can print the same grid in a terminal. Four
choices worth knowing:

- **UTC arithmetic on "YYYY-MM-DD" strings, never a local `Date`.** An entry's date is a
  calendar day the writer chose, not an instant, so building a local-time `Date` from it
  would shift the day west of UTC and file an entry under the wrong cell. "Today" is the
  one exception: it comes from `todayIsoLocal()` on the *server*, because read on the
  client it would be the device's clock and a phone in another timezone would highlight a
  different day than the entries were saved against.
- **A month grid is always 6 rows**, padded from the neighbouring months. A 5-row
  February beside a 6-row March would shift everything below the calendar while paging
  through a year. Padding days show their titles (so a day never looks empty in one month
  and populated in the next) but don't count toward the month's total.
- **Month and year steps clamp the day rather than rolling over** — Jan 31 back a month is
  Feb 28, not Mar 3 — so ‹ then › returns you where you started.
- **The Jump box takes an explicit format**, defaulting to `MM/DD/YYYY` and remembered in
  `localStorage`. `01/02/2026` is a real date in two formats and only the reader knows
  which was meant, so the format is a choice, not a guess; a native picker sits beside the
  box for when typing isn't wanted. Separators are lenient (`/`, `-`, `.`) since those
  never change the meaning — the *field order* never budges.

**Prefill templates** (`migrations/0062`) let a named set of field values start a new
entry. Configuration → **Templates** builds them; the New Entry form grows a dropdown
that fills the fields you left blank. Four choices worth knowing, all recorded in that
migration:

- **The values are JSON on one row**, not a child table — a template is read and written
  whole every time, exactly like `jrn_saved_filters.filter_json` (0043) in the same module.
- **A field carries a `mode`, not just a string.** A stored literal date would pin every
  new entry to a fixed day in the past, so `date` and `time` can be *current date* /
  *current time*, resolved at apply-time. `mode` is a real column rather than a sentinel
  like `@now`, which would be indistinguishable from someone typing that into a title.
- **Resolution happens in the browser**, for the same reason `todayIsoLocal()` does — an
  entry's date is the writer's calendar day, not the server's instant.
- **Applying fills blanks only.** A field already typed into is never overwritten, so the
  control needs no confirmation and no undo.

Locations and weather are deliberately not templatable: the entry form already resolves
both live from GPS, and a stored copy would be staler than one button press.

This is also the module that made **Configuration a nav group**. `SectionPanel` renders a
node with children as an accordion heading and drops it from the compact sheet, so a
parent cannot also be a page — the long-standing `/configuration` route therefore stayed
put and became the group's first child, relabelled *Preferences*, with *Templates*
alongside it.

Week start is **hardcoded to Sunday**, in one place: `startOfWeek` in
`calendar.ts`, which every grid builder goes through. Making it a journal preference
later means giving that function (and the builders that call it) a `weekStartsOn`
parameter and adding a `sys_module_settings` key — a contained change, but not a
free one, since `WEEKDAY_LABELS` would need rotating too.

**CSV Analysis** (`csv-analysis`) — import an arbitrary CSV, which creates a
per-entry table (`csv_<name>`, from `buildTableName`), then chart and analyse it.
The one module with **no tree nav and no sections**: its whole UI is a single
view. Library: `src/lib/csv-analytics`, `src/lib/csv-import`.

**Expense** (`expense`) — credit-card transactions imported from CSV, categorised
by post-import rules, with a dashboard and charts. Library: `src/lib/expense`.

**Attendance** (`attendance`) — students, classes, enrollment, and daily
registers with a printable report. A class may be registered several times a day;
each save is its own timestamped session. A teacher-editable catalog of **student
actions** (Late, Extra Credit, …) is recorded per student per session and printed
on the report — the actions carry their own small glyph set
(`ATTENDANCE_ACTION_ICONS`), deliberately outside the user-selectable icon sets;
`migrations/0051_create_attendance_student_actions.md` records why. The newest
module and the cleanest template to copy. Library: `src/lib/attendance`.

**Music Library** (`music-library`) — catalogs audio files already on the NAS and
streams them to a browser over HTTP Range. **Read-only by construction**: the
`MusicFileStore` port has no write, move or delete method, so no code path can modify
the collection; album art is copied *into* SQLite rather than written back beside a
track. Lyrics are fetched on demand from LRCLIB (free, no API key) and cached — never
scraped from Google, and never written to a `.lrc` file; see
`migrations/0054_create_music_track_lyrics.md` for why. APE and WMA are catalogued but
not playable, because no browser decodes them. A scan is two-phase so the progress bar
can show a real percentage: a fast walk counts candidates, then a slower pass reads
tags.

The **Library** section is eight views over the one catalog — All Songs, Artists, Genres,
Playlists, Most Played, Years, Folders and Folder Hierarchy — with the active view in the
URL (`?view=`) so it is linkable. Six read data the scanner already stores; Playlists and
Most Played needed `migrations/0056`. Playlists are **shared, not per-user**, and a play is
counted when playback **starts**, so the count measures "opened" as much as "listened to" —
`migrations/0056` records that tradeoff and why it is reversible. Library: `src/lib/music`.

The **Magic Playlist** section builds a playlist from a *query* rather than by hand: pick
genres, artists and albums (OR within each field, AND across them) plus a target running
time, and the generator shuffles every matching track and fills toward that length. Its own
library module, `src/lib/music-magic` — a distinct domain (criteria and generation) that
depends on `src/lib/music` through that module's `index.ts`. `migrations/0057` records the
choices worth knowing: criteria stored as JSON because they are always read whole,
genres/artists as text but albums as ids (mirroring the catalog), tracks with no duration
tag excluded because they cannot be counted toward a target, and the generated set stored
so loading a saved list **replays** it while Regenerate is the explicit re-roll. Track order
gets one further pass that spaces the same artist apart -- a pure permutation, so it cannot
change the set or the running time.

The **Queue** section makes the play queue visible. The queue always existed -- clicking a
track in any list set it, which is how Next knew what to play -- but nothing rendered it and
it died with the page. `migrations/0059` gives it a table, so it survives a reload and can be
looked at: reorder it, shuffle what is still to come, take tracks out, jump to any row, and
pick a repeat mode (off / all / one). Three things worth knowing, all recorded in that
migration: entries are addressed by **entry id, not track id**, because the same track may be
queued twice; there is **one queue, shared** by everyone using the app, like the playlists;
and a shuffle leaves the playing track where it is and reorders only what follows. The rules
about what plays next live in `src/lib/music/queue.ts` as pure functions -- they were four
lines inside a React callback before, and they mishandled a duplicated track. The player bar
carries a queue button, and the Queue screen is a real route, so it is bookmarkable.

The Queue toolbar can also **save the queue as a playlist** -- either naming a new one or
appending to an existing one. Both, not just "create", because a playlist name is unique:
a create-only button would dead-end the moment you re-saved a list you were still
tweaking. It adds no logic of its own, calling the same two actions the library's
selection bar uses; the queue screen just picks the tracks differently (all of them, in
queue order).

**Configuration carries an opt-in "auto-retrieve lyrics from the web".** Off by default.
With it on, opening the player for a track with **no cached lyrics row at all** sends the
lrclib.net lookup by itself instead of waiting for the *Get lyrics* button.
`migrations/0054` had ruled fetch-on-play out, on the grounds that it makes an outbound
request per track played that the owner never asked for -- so this is a switch, and it is
narrow: any *stored* answer is left alone, including the retryable `not_found` and
`failed`. Auto-retrying those would mean a request on every play for exactly the tracks
that never resolve; they stay on the button, which already reads "Try again". `instrumental`
is never retried at all. So a track is asked about at most once, ever.

### Icons

`icon` must be one of `MODULE_ICON_NAMES` in
[src/lib/modules/icon-names.ts](src/lib/modules/icon-names.ts): `building`,
`home`, `briefcase`, `wallet`, `chart`, `folder`, `shield`, `heart`, `book`,
`tool`, `journal`, `roster`, `music`.

**Prefer the closest existing fit.** Adding a concept is not a one-line change: it
has to be drawn by hand for the "classic" set *and* named in `TREE_CAND`-style
candidate maps for all 12 sets in `scripts/gen-icon-glyphs.mjs`, or the generator
fails — a missing module glyph is fatal there by design, since the toolbar has no
other artwork to fall back on. Reach for a new concept only when two modules would
otherwise share one glyph and the collision is confusing: that's what happened with
Journal and Attendance, which both sat on `book` until
`migrations/0050_journal_and_roster_module_icons.md` split them into `journal` (a
bound journal with a quill) and `roster` (a class register). It happened again with
Music Library, which borrowed `heart` from `0053` until
`migrations/0055_music_library_music_icon.md` added `music` (a beamed pair of eighth
notes) — worth reading as the worked example of what a new concept costs.

**Changing which of those names a module uses is an admin action, not a migration.**
Admin → Configuration → Module Configuration carries a glyph grid per module
(`ModuleIconControl`), which writes through `setModuleIcon` and saves on pick rather
than on the page's Save button — the same trade the carousel graphic makes, and for
the same reason: this one value draws the rail, the home grid and the admin card, so
an unsaved choice would leave them disagreeing. The grid previews in whichever icon
set is active under Configuration → Icons.

Two things that still belong in a migration. **Seeding a new module's icon** — that's
part of its `INSERT`. And **retiring a name from `MODULE_ICON_NAMES`**, which has to
move any row still on it (`UPDATE sys_modules`, scoped by slug *and* by the old value
so it doesn't stomp a hand-picked choice). Keep `DEFAULT_MODULES` in step either way:
it is what "Reset to Default" writes, so a default left stale will put the old icon
back over an admin's pick.

Section icons in a tree nav are a **different, larger set**, resolved by
`TreeIcon` ([src/components/tree-icons.tsx](src/components/tree-icons.tsx)) and
keyed by plain strings — `grid`, `users`, `classroom`, `chart`, `gear`. Don't
confuse the two lists.

### Carousel image

Optional per-module artwork on the home carousel, stored as a `BLOB` on
`sys_modules` (migration 0040) and served by its own route. Domain code sees only
`hasCarouselImage`, never the bytes — `sys_modules` is read on every
authenticated page, so a `SELECT *` here would ship a megabyte per render. Rules
in `coding-guide.md` → *Per-row images*.

### Background picture

Optional, per module, and **already built** — don't write a second one. A picture
uploaded from the module's own configuration screen sits behind every section of
that module. Stored in `sys_module_texture`, keyed by slug (migration 0064), with
opacity / cover-or-tile / blur alongside it. The **Music Library** is the only
user today (*Configuration → Appearance*).

To give another module one:

1. In the module's shell, read it and emit the wrapper — four lines, copied from
   `music-shell.tsx`:
   `moduleTextureCssVars(getModuleTexture(deps.moduleTextureRepo, SLUG))`, then
   `data-module-texture={vars ? "" : undefined}` plus `style={vars}` on a div
   around `{children}`.
2. Add three actions to that module's actions file, mirroring the
   `saveMusicTextureImageAction` / `remove…` / `saveMusicTextureSettingsAction`
   trio, and gate them the way the rest of *that screen* is gated.
3. Reuse the UI: `music-texture-control.tsx` is route-local by design. A **third**
   module wanting a picture is the point to promote it into `src/components/` with
   the slug and copy as props — see `components.md` → *Ask before creating*.

No migration, no new table: the table is keyed by slug and takes any module. Domain
code sees only `hasImage`, never the bytes; the BLOB is read by
`GET /api/modules/[slug]/texture` alone. Design constraints (why the layer wraps
section content and not the nav, why opacity defaults low) are in `design.md` →
*The one sanctioned exception*.

## Creating a new module

Plan first and wait for approval — `CLAUDE.md` requires it for any multi-file
change, and a module is the largest one there is. The plan must name the files,
the migration number and 3-letter prefix, any third-party dependency and whether
it's free, and the open questions.

Then work in this order. Bottom-up, because each step compiles against the one
below it.

### 1. Pick the slug, names, and prefix

- **Slug** — lowercase kebab-case, the URL segment. Permanent in practice:
  it's in bookmarks, in `DEFAULT_MODULES`, and hardcoded as a constant in the
  route files. Rename only with a migration.
- **Short and long name, description** — admin-editable later, so getting them
  perfect now doesn't matter much.
- **Sequence** — next unused integer. Ordering on the home grid; admin-editable.
- **Table prefix** — a new lowercase 3-letter namespace, not an abbreviation of a
  word. Check it against the table in `coding-guide.md`, and don't reuse `rei_`.

### 2. The library module — `src/lib/<name>/`

All logic lives here. Nothing in this folder may import `react` or `next`.
Mirror [src/lib/attendance/](src/lib/attendance/):

| File | Holds |
|---|---|
| `types.ts` | Domain types. No zod, no SQL. |
| `schema.ts` | The zod schemas that validate boundary input, plus their inferred types. |
| `ports.ts` | The `…Repository` interface the use-cases depend on — not a database. |
| `repository.ts` | The `Sqlite…Repository` implementation. The only file that knows SQL. |
| `<name>.ts` | The use-cases: functions taking data and returning data. |
| `<name>.test.ts` | Colocated Vitest, success **and** failure paths, against a fake repository. |
| `settings.ts` | Only if the module needs preferences — see step 6. |
| `index.ts` | The front door. Everything outside imports from here and nowhere else. |

### 3. The migration

Two files in [migrations/](migrations/), same number, next in sequence:

- `NNNN_create_<thing>.sql` — the module's tables, each named `<prefix>_<thing>`
  with `snake_case` columns. Read `coding-guide.md` first for the traps that have
  already cost time here: never put a date column in a unique index; a primary-key
  change means a full rebuild; a settings value is blank, never `NULL`.
- `NNNN_create_<thing>.md` — the log: what changed and *why*, including the
  reasoning behind anything unobvious. These logs are load-bearing documentation,
  not a formality.

Then a **separate, later-numbered** seed pair registering the module itself, like
[migrations/0048_seed_attendance_module.sql](migrations/0048_seed_attendance_module.sql):

```sql
INSERT INTO sys_modules (slug, short_name, long_name, description, sequence, is_visible, icon)
VALUES ('<slug>', '<Short>', '<Long>', '<Description>', <seq>, 1, '<icon>');
```

### 4. Register in `DEFAULT_MODULES`

Add the same values to
[src/lib/modules/defaults.ts](src/lib/modules/defaults.ts). **This is not
optional and not a duplicate to be tidied away**: the seed migration builds a
fresh database, and `DEFAULT_MODULES` is what admin "Reset to Default" restores
the table from. A module missing here vanishes the first time anyone resets. The
file says so at the top — keep both in sync, and update its comment to name your
new seed migration.

### 5. Wire the repository

Add one line to `deps` in [src/lib/wiring.ts](src/lib/wiring.ts):

```ts
<name>Repo: new Sqlite<Name>Repository(db),
```

This is the composition root. A presentation file must never construct a
repository itself.

### 6. Module settings — only if needed

Preferences go in `sys_module_settings` as key/value rows, not in a new table.
Add a `settings.ts` to the library module with a `…_SETTING_KEYS` map, a typed
`…Settings` interface, a `resolve…Settings(rows)` parser, and a
`…SettingsToEntries` writer — [src/lib/attendance/settings.ts](src/lib/attendance/settings.ts)
is the pattern. Parsing must be **forgiving**: a settings row can outlive the
thing it names, so a stale id is "not set", never a thrown error.

**If the setting arms a background job, its switch and interval belong in
Administration → Background Tasks, not on the module's own screen.** The rows still
live in `sys_module_settings` under the module — only the controls move. Two reasons,
both learned the hard way: three schedulers configured in three places left nobody
able to answer "is anything actually running?", and a switch shown apart from the
last-run record can be flipped on with no way to see it did nothing. Keep the job's
*configuration* (a watched folder, a threshold) with the module, and have the admin
card show those preconditions read-only so an armed-but-inert job explains itself.
Register the job in `JOB_DESCRIPTORS`
([src/lib/scheduled-jobs/types.ts](src/lib/scheduled-jobs/types.ts)) and stamp each
pass through `ScheduledRunRepository` — the screen and the CLI both iterate that list,
so a new job needs no new UI.

### 7. Sections and the nav

Skip this whole step for a single-screen module — CSV Analysis has no nav, and
that's a legitimate shape.

Otherwise, three files under
[src/app/(protected)/modules/[slug]/](src/app/(protected)/modules/[slug]/),
named `<module>-*`:

- **`<module>-sections.ts`** — the section list `as const`, its type, an
  `is<Module>Section()` guard, a `…_SECTION_INFO` record of label + description,
  a `…_SECTION_ICONS` record, and a `…SectionHref()` helper where `main` maps to
  the module root and everything else to a child route. **Not** a `"use client"`
  file: server components read these as real values, and a client module would
  hand them client-reference proxies instead, so `INFO[section]` would come back
  `undefined`. This has bitten before — the comment at the top of
  [attendance-sections.ts](src/app/(protected)/modules/[slug]/attendance-sections.ts)
  records it.
- **`<module>-nav.tsx`** — `"use client"`. Maps the section list into
  `TreeNode[]` and renders the shared `TreeNav`. Give it **its own**
  `storageKey` (`myhomebase:<module>-nav-collapsed`) so collapsing one tree
  doesn't collapse the others.
- **`<module>-section.tsx`** — a **server** component. Reads `deps`, loads only
  the data the requested section needs, renders `SectionLayout` with the heading,
  a `CollapsibleCard` of instructions, and the section body. Views get plain
  data, never `deps`.

Then register the nav in
[section-layout.tsx](src/app/(protected)/modules/[slug]/section-layout.tsx): add
the slug to the `nav` union and a branch to the picker. The nav is passed by
*name*, not as a component, because a server parent can't hand a client child a
render prop.

### 8. The routes

Both route files dispatch on the slug, and both need editing:

- [page.tsx](src/app/(protected)/modules/[slug]/page.tsx) — the module root. Add
  a slug constant and a branch in `ModuleBody` returning your section shell with
  `section="main"`. Without this the module renders the "Coming soon"
  placeholder.
- [[section]/page.tsx](src/app/(protected)/modules/[slug]/[section]/page.tsx) —
  every child route. Add a branch to `renderSection` gated on **both** the slug
  and your own `is<Module>Section(section)`. The double gate is deliberate: it
  stops one module's section name resolving under another module's slug, which
  would render a nav pointing at routes that don't exist.

Sections live under the dynamic `[slug]` segment on purpose. A static `expense/`
folder would shadow `/modules/[slug]` and break the module page itself.

Anything a screen should survive a refresh or a bookmark on — which class, which
date, which filter — travels as a search param, parsed in the route (take the
first element of a repeated value; never join) and passed down. Not client state.

### 9. Views and server actions

- `<module>-<section>-view.tsx` per screen, client components taking plain data.
- `<module>-actions.ts` — `"use server"`. Each action validates with the module's
  zod schema, calls the use-case through `index.ts`, and revalidates. No logic.
- `<module>-instructions.tsx` — per-section guidance. Give each section only its
  own text; the whole document above every screen is noise.

Before building any of it, read `components.md` and reuse what fits. If something
new looks reusable, ask "should this be reusable? give it a name", then put it
in `src/components/` and register it there.

Every screen must work at 1024px and below. Reach for `max-lg:` variants first —
they leave the desktop classes untouched, so a wide screen provably can't
regress. Only a genuinely *different component* justifies reading
`useViewport()` / `useIsCompact()`. Say how the screen behaves narrow when you
report the work.

### 10. The CLI path

Every use-case must be callable identically from the web and the CLI. Add a
command under [src/cli/](src/cli/) for the module's main use-case — importing
from the same `index.ts`, using the same `deps` — and register it in
`CLI_registry.md`. [src/cli/take-attendance.ts](src/cli/take-attendance.ts) is
the recent example.

### 11. Access

A module is granted per-user through `sys_user_module_access`. Both route files
already enforce it via `userHasModuleAccess`, so a new module needs no new
plumbing — but a freshly seeded module is granted to nobody. Grant it in admin
*User Management*, or the module 404s for everyone including you.

## Checklist

- [ ] Slug, names, description, sequence, 3-letter prefix chosen
- [ ] `src/lib/<name>/` with types, schema, ports, repository, use-cases, `index.ts`
- [ ] Colocated Vitest covering success and failure
- [ ] `NNNN_create_*.sql` + `.md` log
- [ ] `NNNN_seed_<slug>_module.sql` + `.md` log
- [ ] `DEFAULT_MODULES` updated, with its comment naming the new seed migration
- [ ] Repository added to `deps` in `wiring.ts`
- [ ] `<module>-sections.ts` (no `"use client"`), `-nav.tsx`, `-section.tsx`
- [ ] Nav registered in `section-layout.tsx`
- [ ] Branch added in **both** `page.tsx` and `[section]/page.tsx`
- [ ] Views, `-actions.ts`, `-instructions.tsx`
- [ ] Reused registered components; anything new added to `components.md`
- [ ] Works at 1024px and below, and you can say how
- [ ] CLI command added and registered in `CLI_registry.md`
- [ ] Module granted to at least one user
- [ ] This file's registry table updated
- [ ] `coding-guide.md` table-prefix table updated
- [ ] `/verify` green end to end
