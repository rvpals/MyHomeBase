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
| `games` | Games | Games & Puzzles | Play a quick game and keep a high-score board. | 8 | `game` | `gam_` |

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

**CSV import lives in its own section** — *Import*, top-level in the section panel
between Report and the Configuration group. It used to be an "Import from CSV" card at the
bottom of the home screen; importing is an occasional, deliberate act, and the mapping
table wants the full page width.

**CSV import is idempotent** (`migrations/0072`). Re-importing a file you have already
imported adds nothing; each repeated row is reported as *"Duplicate of an existing
entry"* in the same summary that reports a bad row. The Import screen has a **Skip
entries that already exist** checkbox, ticked by default, and the CLI has the matching
`--allow-duplicates`. Four choices worth knowing:

- **An entry is the same entry when its date, time and title match.** Content is
  deliberately excluded — a re-export whose body text was reflowed or lightly edited is
  still the same entry, and including it would import a second copy on every such edit.
- **The check counts rather than answers yes/no.** `entry_time` and `title` both default
  to `''`, so a bulk export can legitimately hold several untimed, untitled rows on one
  day. The importer compares how many copies the *file* holds against how many were
  *stored before the run began* and inserts the shortfall; a boolean would collapse them
  all into one entry. Same reasoning as `countMatchingTransactions` in `stock-positions`.
- **A match is declined by default, and overwritten only on request.** The plain import
  never updates an existing entry, so an edit you made in the app can't be clobbered by a
  stale CSV. The **Overwrite database from file** toggle (CLI: `--overwrite`) opts into the
  opposite and takes precedence over the skip checkbox — the two would otherwise disagree
  about what a duplicate means. It replaces the whole entry, so a blank cell clears that
  field, and it refuses a **locked** entry rather than unlocking it.
- **Overwrite confirms against a dry run.** `planJournalImport` walks the file and returns
  what each row *would* do without writing; the screen lists the entries about to be
  replaced and waits for Confirm or Cancel. Plan and import share one decision function
  (`walkJournalCsv`), so the list can't drift from what the import then does. Nothing locks
  the table between the two passes — in a single-user app the window is however long the
  dialog stays open, and the real run re-resolves each row anyway.
- **There is no `UNIQUE` index behind this.** `jrn_entries` still allows duplicates by
  design (0027), because typing the same title twice on one day by hand is the writer's
  business — uniqueness is an *import policy*, which is what lets the checkbox exist.
  0072 adds a plain index on `(entry_date, entry_time, title)` to make the count cheap.

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
Sections: Dashboard (the whole import/chart UI) and Configuration (a placeholder
until there is a setting worth persisting). Library: `src/lib/csv-analytics`,
`src/lib/csv-import`.

**Expense** (`expense`) — credit-card transactions imported from CSV, categorised
by post-import rules, with a dashboard and charts. Library: `src/lib/expense`.

The **Transactions** section is one grid under a `ViewModeSwitch`: **All**, or grouped by
**Account**, **Billing cycle**, **Vendor** or **Category**. Every grouping expands to the
*same* grid — identical columns, row actions, selection, bulk edit and export — because it
is one table looked at differently, not five screens. The rollup itself is pure
(`src/lib/expense/grouping.ts`), so the view only presents it. Four choices worth knowing:

- **It is a control in the page body, not a nav tier.** `design.md` puts a control that acts
  on the current page in the page body, so Transactions stays one section rather than
  sprouting four.
- **One group open at a time.** Several expanded grids on one page each carry their own
  toolbar, paging and footer total, at which point nothing reads as a summary any more.
- **A billing cycle belongs to a card, so cycles nest inside accounts.** Two cards closing
  on different days have different Augusts; pooling "August" across cards would put one
  label on several date ranges. `statement_close_day` therefore lives on the account
  (`migrations/0070`) and the cycle is *derived* at read time — nothing about a period is
  stored, so correcting a close day re-groups the history, which is what you want.
- **The close day is on the statement, and clamps in short months.** A card closing on the
  28th bills 29 Jul – 28 Aug; the 31st becomes 28 Feb (29th in a leap year), as every issuer
  resolves it. A card still on `0` — never told a day — is flagged in Meta Data and grouped
  on the default (28) rather than collapsing into one pile. The arithmetic is
  `src/lib/expense/billing-cycle.ts`, which never constructs a `Date`: dates here are
  `YYYY-MM-DD` strings, and `new Date(...)` would reinterpret them in the runtime's
  timezone.

Cycles are measured by **posting date, falling back to transaction date** — a statement is
assembled from posting dates, but plenty of card exports omit the column.

**Attendance** (`attendance`) — students, classes, enrollment, and daily
registers with a printable report. A class may be registered several times a day;
each save is its own timestamped session. A teacher-editable catalog of **student
actions** (Late, Extra Credit, …) is recorded per student per session and printed
on the report — the actions carry their own small glyph set
(`ATTENDANCE_ACTION_ICONS`), deliberately outside the user-selectable icon sets;
`migrations/0051_create_attendance_student_actions.md` records why. The newest
module and the cleanest template to copy. Library: `src/lib/attendance`.

A class carries the **weekday it meets on** (`class_weekday`, 1 = Monday to
5 = Friday, `migrations/0080`), and the home screen opens on today's register
because of it. Precedence is most-specific-first: `?classId=` in the URL, then
today's weekday class, then the configured default class setting, then nothing.
The weekday deliberately does **not** reach the Report screen — which day *that*
opens on is the `reportDefaultsToToday` setting's business. Monday-to-Friday only,
so a weekend simply falls through to the default; a class predating the migration
(or one the CSV importer created, since a file says nothing about when a class
meets) stores `0`, is never any day's class, and shows as "—" until someone picks
a day. The rule itself is pure and lives in `src/lib/attendance/weekday.ts`.

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

**Games** (`games`) — a small arcade with a shared high-score board. Sections:
**Arcade** (the list of games; Play opens the board full-bleed), **Scores**, and
**Configuration**. Library: `src/lib/games`. One table, `gam_scores`
(`migrations/0074`); registered by `0075`. Three games so far: **2048**,
**Arrow Clearing**, and **Tetris**.

Five choices worth knowing, all recorded in `0074`'s log:

- **The catalogue of games is code, not a table.** There is deliberately no
  `gam_games`: a game is only playable if the view that draws it exists in the build,
  so a row could name a game this deployment cannot run, and an admin could "add" one
  by inserting a row and get a card that goes nowhere. `GAME_CATALOGUE` in
  `src/lib/games/catalogue.ts` is the registry, exactly as `HOME_WIDGET_IDS` (0067)
  and `src/lib/market-indexes` are. *What the app can do is code; what the user did is
  data.* Adding a game is therefore one catalogue entry plus one branch in
  `games-arcade-view.tsx` — no migration and no nav change.
- **`game_key` is not a foreign key**, for the same reason, and a score outlives its
  game being retired from the catalogue. `formatScore` and both views tolerate an
  unknown key rather than throwing; validation happens on the way *in*, via
  `recordScoreSchema`, which is what stops a crafted request writing scores for a game
  that does not exist.
- **`user_id` carries no `REFERENCES sys_users` clause either** — and this one was a
  bug before it was a decision. It shipped with a real FK, and because
  `better-sqlite3` enables `PRAGMA foreign_keys` on every connection, deleting a user
  who had ever finished a game failed outright, breaking Admin → User Management. No
  other table in the project declares an FK to `sys_users`;
  `SqliteUserRepository.deleteUser` clears what it owns by hand and says so
  ("No FK to cascade (project convention)"). Every read LEFT JOINs instead, so an
  orphaned score renders as "Unknown player" rather than emptying the board.
- **The board is shared, not per-user.** It answers "who is best at this", so no read
  filters by the viewer. Same call as `stk_ticker_favorites` (0058).
- **A score is only saved when a game ends**, and the board is never sent to the
  server or re-simulated there. A determined player can post any number they like,
  which is accepted deliberately for a single-household arcade; `games-actions.ts`
  records what verifying it would cost. `played_at` *is* server-stamped, since a
  client-supplied timestamp would win every tie-break in the `score DESC,
  played_at ASC` ordering.

The 2048 rules live in `src/lib/games/game-2048.ts` as pure functions over a flat
16-cell board, with the RNG injected — which is what makes the merge rules testable
at all, since a real `Math.random` would mean asserting on wherever the new tile
landed. Nothing about the game is decided in the view. Two rules the tests pin down
because they decide most games: a gap between equal tiles does not prevent a merge,
and a tile merges at most once per move (a row of four 2s is two 4s, never an 8).
`canMove` answers "is there an empty cell?" first — defined purely as "does some
direction shift something", it reports game-over for an empty board, which is how a
fresh board could have been dead on arrival.

Tiles are coloured by **one theme token at increasing opacity** (`brass/10` through
`brass`), not a hardcoded ramp: there are 9 tokens and 11 tile values, and a literal
beige ramp would look wrong in the two light themes. The board is a square sized in
`min(28rem, 88vw)`, so it scales rather than reflowing, and it takes arrow keys, WASD
and touch swipes.

#### Arrow Clearing

A logic puzzle, following the mechanic of the mobile game *Arrows – Puzzle Escape*. Each
arrow is a **winding path** of up to eight cells with a head at the leading end; tap it
and it snakes off the board along its own route — but only if the straight line from its
head to the edge is clear. A blocked tap costs a life. Five lives, then the run ends.
Rules in [game-arrows.ts](src/lib/games/game-arrows.ts), board in
[game-arrows-view.tsx](src/app/(protected)/modules/[slug]/game-arrows-view.tsx).

Decisions worth keeping:

- **Levels are generated in reverse, which is what guarantees they are solvable.**
  Arrows are "shot in" from outside: each is placed only where its own exit is clear *at
  the moment it is placed*. Since clearing an arrow only ever frees cells, an arrow whose
  exit was clear when placed still has a clear exit once everything placed after it has
  gone — so replaying the placements backwards always empties the board. Scattering
  arrows and then testing solvability would need a search per candidate and an unbounded
  retry loop; this construction cannot produce a bad board at all. The test asserts it
  over 180 random boards rather than trusting the argument.
- **Only the cells *ahead* of the head are checked — but they are checked against every
  arrow, including this one.** The geometry does the exclusion: a straight arrow's tail is
  entirely behind it, so it never appears in `pathAhead` and cannot report itself blocked.
  A **winding** arrow can, and must: a U-shaped piece whose head points back into its own
  tail can never leave the board, so tapping it is a bad move and costs a life.

  This was wrong in both directions at once, from one bad assumption — that "the tail
  follows exactly where the head has already been", which holds for a straight arrow and
  fails as soon as paths turn. `isBlocked` excluded the arrow from its own check, so a
  self-blocked piece cleared straight through its own tail; and `growPath` validated exits
  against only the cells already on the board, so it *created* such pieces —
  **265 across 10 boards, making every one of them unsolvable.** `growPath` now refuses
  any tail cell in the head's exit lane, and `occupancy` no longer takes a `skipId` at
  all. Three tests cover it: the U-shape rule, a winding arrow that bends away from its
  lane (which must stay clear), and a generator invariant asserting no placed arrow blocks
  itself.
- **Placements are scored, because taking the first legal spot produced easy boards.**
  This was measured, not guessed: with placements in shuffled order, a 9×9 came out with
  ~12 of 22 arrows already free on move one, and **421 of 448** such arrows across 40
  boards had their head sitting *on the board edge*, where `pathAhead` is empty and
  nothing can ever block them. A third of every board was clearable in any order.
  `findPlacement` now ranks candidates on `exit.length * 3 + cells.length` — depth
  dominant so heads are pushed inward, length secondary so paths stay long. Ranking on
  depth *alone* was also tried and was worse in a different way: it picks the deepest
  head regardless of what fits behind it, which on a filling board meant 40 single-cell
  arrows and no winding paths at all. Both terms are needed. Result: ~92% full, ~5 free
  at the start. A test guards the ratio.
- **Arrow lengths come from a weighted distribution, sampled once per placement.** A
  board wants a mix — many 1-2 cell pieces, a good number of 3-5, a handful of long 6-12
  snakes — and `LENGTH_WEIGHTS` encodes that. Two ways this has been got wrong, both
  measured: asking `growPath` for the maximum every time produced a **barbell** (6.3
  single-cell and 4.6 max-length arrows a board, nothing between), because a walk either
  found room and ran to the cap or was boxed in at one cell. Then rolling the length
  *inside* the candidate loop was worse in a subtler way — `findPlacement` evaluates
  every free cell in every direction, so it rolled thousands of times and kept whichever
  candidate rolled longest. A weighted sample is only a sample if it is drawn **once per
  thing being decided**.
- **Depth and length are satisfied in priority order, not summed.** Scoring
  `depth * 3 + length` let the ranking re-pick the length. Scoring depth alone picked the
  deepest head regardless of what fitted behind it — the deepest spots on a filling board
  are cramped, so every arrow came out 1-2 cells and the board sat at 37% full. Now:
  collect all legal heads, keep those within `DEPTH_BAND` of the deepest, then take the
  first that can hold the rolled length (with the roomiest near-miss as fallback).
- **`arrows` is a ceiling the generator will not reach, and raising it does nothing.**
  Generation stops when no legal placement remains, and that saturation point is a
  property of the *board size*: at 18x18 a target of 120 and a target of 170 both settled
  at 84 arrows. To get more arrows, grow the board.
- **Solvable is not the same as winnable, and only the second matters to a player.** This
  shipped once as a 9x9 packed to 92% (~22 tangled pieces) against five lives. Every board
  was solvable by construction and a greedy solver cleared 200 of 200 — but a person ran
  out of lives with most of the board standing, and an end screen reading "15 arrows still
  on the board" is indistinguishable from a broken generator. A test now plays every board
  the careful way and requires it to come out empty, and the loss panel states outright
  that the board had a solution.

- **No single-cell arrows.** `MIN_ARROW_LENGTH` is 2 and `LENGTH_WEIGHTS[1]` is 0, so
  every piece has a head *and* a tail. A one-cell arrow draws as a bare arrowhead with no
  line behind it, which reads as a stray mark rather than part of the maze. `growPath` can
  still return a 1-cell run when a spot is cramped; those are refused outright, even as the
  fallback, which is what ends the run of placements late in generation.
- **Generation is O(1) per candidate, via `OccupancyGrid`.** This is what makes a board
  this size possible at all. The naive version — a `Set` of `"row,col"` keys plus
  `pathAhead` per candidate — cost O(size^5) for a whole board: measured **16 seconds at
  50x50**, which would visibly freeze the tab on "New board". The observation that removes
  the inner walk: a head's straight run to the edge is clear exactly when no occupied cell
  lies beyond it in that direction, so tracking the min/max occupied column per row (and
  row per column) answers all four directions with a comparison. Those extremes only grow
  as cells fill, so maintaining them is O(1) per cell. **41ms at 50x50** — a ~390x
  speedup. Cells live in a flat `Uint8Array`, so there is no per-cell string allocation.
  `ATTEMPT_LIMIT` bounds the path-growing loop, which is the other quadratic term.

**Current shape** (50x50, target 1500): ~359 arrows over ~71% of the board, ~360 taps to
clear. Lengths per board run roughly 76 at length 2, 155 mid (3-5), 79 long (6-8) and 48
very long (9-12). Simulated, a careful player who only taps what is visibly free wins
5/5; a random guesser never does. Generation takes ~41ms.

Note that **board fill falls as the board grows** (~80% at 20x20, ~71% at 50x50): a larger
grid has proportionally more interior, and the depth band keeps heads away from the edges,
so the generator runs out of legal deep placements with more surface still open.

The board is **SVG**, not a grid of divs: a run of bordered divs cannot draw the corner
where a winding path turns, which `stroke-linejoin` gives for free. Arrows are drawn as
**thin lines** — `STROKE` is 15% of a cell, not the 52% it first shipped at. A thick bar
fills its cell so neighbouring pieces touch and the board reads as a mass of blocks
rather than a maze of routes; the arrowhead is an open chevron scaled to the *cell* (not
to the stroke, which made it vanish when the line was thinned), and an invisible stroke
five times the width carries the pointer events, since a 1.6-unit line is far below a
thumb-sized tap target. The clearing
animation **straightens the piece as it leaves**, tadpole-fashion: the head runs down its
exit lane and each tail cell follows the route the head took, so a U-shaped arrow is a
straight line by the time it slips off the edge. It is modelled as a fixed-length chain on
a track — the arrow's own cells with the exit lane appended in front — and advancing one
`progress` value slides every cell forward along it.

That runs on `requestAnimationFrame`, in `useClearingPoints`, and it has to: **CSS cannot
interpolate an SVG `points` attribute** from one geometry to another, so a stylesheet can
only ever slide the bent shape rigidly. Three earlier attempts, each wrong differently:
`stroke-dashoffset` *retracts* a line rather than moving it; a CSS `transition` had no
committed starting value (the element mounts already cleared) so the piece simply
vanished; and a CSS keyframe transform moved the whole rigid shape sideways, which reads
as furniture being dragged rather than an arrow escaping. `CLEAR_MS` is 700ms — across
fifty cells, 420 outran the eye. Reduced motion is handled in the loop rather than in a
media query, since the motion is no longer CSS to attach one to.

A **Show grid lines** checkbox toggles the cell lattice, off by default — 98 hairlines at
50x50 read as a grey wash behind the arrows, but the lattice genuinely helps when checking
whether a head and a blocker share a row, so it is the player's call rather than a
decision made for them. It is a deliberate one-off native `<input type="checkbox">`:
`components.md` has no checkbox yet, and one control in one game is not the place to
define the app's.

**Zoom is the `viewBox`, not a CSS transform.** A 50x50 board puts a cell at about 12
screen pixels — readable, but small to hit — so + / − / Fit step through fixed levels
(1x to 6x, giving 12px to 72px cells) and dragging pans when zoomed in. Narrowing the
viewBox shows a smaller slice of the same coordinate space, so the arrows, the hit areas
and the clearing animation need to know nothing about it; a CSS transform on a wrapper
would have scaled the stroke widths and tap targets along with everything else. Zooming
keeps the centre of the view fixed rather than the origin, or pressing + would throw away
whatever you were trying to look at. Stroke widths are divided by the zoom so their
apparent weight holds steady. Fit-to-board stays the default: the overview is what makes
the puzzle solvable.

**A drag must never read as a tap.** `DRAG_SLOP` (6px) separates them — past that the
gesture pans and the arrow under the finger is left alone, so dragging across the board
does not clear everything it passes over. Two subtleties: the travel record is reset on
*pointerdown*, not pointerup, because a click fires after pointerup and clearing it there
would erase the flag microseconds before the click handler reads it; and the check lives
in a plain function called from `onClick` at the call site rather than inside
`onArrowClick`. That second point is a lint constraint worth knowing —
`react-hooks/immutability` forbids modifying a ref that has been captured by a hook's
dependency closure, so a ref written by raw pointer handlers has to stay out of every
`useCallback`.

**Any stroke on this board is measured in board units, not pixels**, and that has bitten
twice. The viewBox is `size * CELL` units (500 at 50x50) scaled into roughly 600 CSS
pixels, so one unit is about 1.2px: the grid shipped at `strokeWidth={0.12}`, which lands
near 0.14px and the browser renders as *nothing at all* — the toggle appeared to be
broken. The arrowhead had the same class of bug earlier, sized from the stroke width so
that thinning the line erased it. Sound is synthesized via Web Audio (no asset files), with the context
created on first gesture — a browser blocks an autoplayed one and warns on every load.

Scoring is 100 a cleared arrow less 15 a wasted tap, floored at a tenth of full marks so
a long fumbling run outranks a short one. A lost run still scores for what it cleared, so
the number means "how far you got".

#### Tetris

The classic well: pieces fall, full rows clear, and the run ends when the stack reaches
the spawn area. Rules in [game-tetris.ts](src/lib/games/game-tetris.ts), board in
[game-tetris-view.tsx](src/app/(protected)/modules/[slug]/game-tetris-view.tsx).

**The arcade's first real-time game**, and that is the only structurally new thing about
it: 2048 and Arrow Clearing both advance only when the player acts, so neither needed a
clock. Decisions worth keeping:

- **Gravity is a pure `tick(state, random)`; only the timer lives in the view.** The
  library owns the whole rule — including `dropIntervalMs(level)`, the difficulty curve —
  and the view owns nothing but a `setInterval` that calls it at that period. A
  `setInterval` is a browser concern and cannot live under `src/lib/`, but its *period*
  is a game rule and must not leak into a `.tsx`. This is what makes drop speed, lock
  delay and line clears testable without waiting on a real clock, and it is the same
  trade `game-2048.ts` makes by taking its RNG as an argument.
- **The interval re-subscribes on `level` only, deliberately.** Depending on the whole
  state would restart the timer on every keypress, which lets a player postpone gravity
  indefinitely by holding a key down — the piece would never fall. The `exhaustive-deps`
  disable at that effect says so.
- **Lock delay is a tick counter in state, not a timestamp.** A piece that locked the
  instant it landed would make it impossible to slide one under an overhang, which is a
  move the game is expected to allow. A counter rather than a wall-clock deadline is what
  lets a test assert the grace period by ticking `LOCK_DELAY_TICKS + 1` times.
- **Pieces are dealt a shuffled bag of all seven at a time**, not `random()` per piece.
  The obvious implementation can deal five S-pieces in a row and starve you of an I for
  thirty turns, both of which read as the game cheating rather than as bad luck. A bag
  bounds the worst-case gap between two I pieces at twelve, which is the guarantee
  players actually expect.
- **Rotation is arithmetic, not four transcribed tables.** Turning a point clockwise in a
  box of side *n* sends `(row, col)` to `(col, n - 1 - row)`; applying it `rotation`
  times is cheaper to verify than four hand-written copies of each shape and cannot drift
  out of sync the way four transcriptions can.
- **A rotation that collides is nudged, not refused.** Without wall kicks, rotating flush
  against a wall silently does nothing, which is the single most common way rotation
  feels broken. The kick table is collapsed to one list per piece class rather than the
  full per-rotation-pair SRS table: this arcade does not score T-spins, so the only thing
  the exact table buys is which of two equally valid kicks wins in a rare cramped spot.
  **O is returned untouched** — a square is the same square in every orientation, and
  running it through the kick table would let it shuffle sideways for free.
- **Hold is once per piece**, and that rule is load-bearing rather than traditional:
  without it, holding swaps the same two pieces forever and gravity never advances, so a
  player could park a game indefinitely.
- **Top-out is checked on spawn**, not by looking for blocks in the buffer rows. A piece
  may legitimately rest partly in the two hidden rows above the visible board without the
  game being over; what ends a run is the *next* piece having nowhere to go.
- **Pieces are one theme token at seven strengths**, not the traditional seven literal
  colours — the same call the 2048 tile ramp makes, and for the same reason: the theme
  provides one accent family, so a hardcoded cyan/yellow/purple palette would ignore the
  active theme and read wrong in the light ones. Distinguishing them matters less here
  anyway, since a tetromino is identified by its shape rather than by its fill.

**A line clear is animated, and the state carries what the animation needs.** Clearing
happens inside `lockPiece`, so a completed row is filled and gone in a single state
transition — there is no frame in which it exists to be drawn, which is exactly why the
first version read as "the row was never there". `clearLines` therefore reports *which*
rows went, and `lockPiece` hangs a `lastClear` on the state: the row indexes, the board
**with those rows still on it**, and an id. None of it is read by any rule; it exists so
the view can play the clear out. The pre-clear board has to be carried rather than
re-derived, because by the time the new state exists the rows are gone from `field`. The
id is the piece count at the lock, and it is load-bearing: two clears of the same rows
are otherwise identical values, so React would see no change and the animation would not
restart.

The effect itself is three layered pieces, because a clear is three coincident events —
the row completes, it is destroyed, and the stack falls in. Animating only the last is
what made it plain. So: the cells burst outward on a per-column delay struck from the
middle of the row, a bar of light sweeps the full width (the part that says a *line* went
rather than some blocks), and a four-row clear flashes the whole board edge, since the
reward for stacking deep has to be visible and not merely numerical. Keyframes live in
`globals.css` beside the Arrow Clearing ones, transform- and opacity-only so they stay
off the layout path, with a `prefers-reduced-motion` fallback that keeps a plain fade —
dropping the effect entirely would leave the board appearing to change on its own.

**Gravity is suspended for exactly `LINE_CLEAR_MS`.** Otherwise the next piece falls over
the top of the animation, and at a high level the effect never gets shown at all. That
makes 320ms a gameplay number as much as a cosmetic one; the CSS reads it through a
`--tetris-clear-ms` custom property set on the board, so the freeze and the keyframes
cannot drift apart.

The board is sized `min(18rem, 78vw, 26vh)` — the `vh` term halved from the usual budget
because the well is twice as tall as it is wide. Below 1024px the next/hold panel moves
above the board and a button pad appears under it (`max-lg:` only, so the desktop layout
provably cannot regress); the pad uses `onPointerDown` rather than `onClick`, since a
click fires on release and makes the controls feel a beat behind the board.

Scoring is the classic table — 100/300/500/800 for one to four rows, times the level the
rows were cleared *at* — plus 1 a row for a soft drop and 2 for a hard drop. The jump
from 500 to 800 is the one number that changes how the game is played: it is the whole
reason to stack deep rather than clear singles.

#### Sudoku

Three difficulties — Easy, Medium and Hard, at 44 / 34 / 26 clues — chosen with a button
that deals a new board immediately rather than arming a separate "New game". Rules in
[game-sudoku.ts](src/lib/games/game-sudoku.ts).

Decisions worth keeping:

- **A wrong digit is entered, not refused.** It shows red and counts as a mistake.
  Refusing it would turn the board into an oracle: you could find every answer by trying
  nine digits in a cell and watching which one takes.
- **`clues` is a target, not a guarantee.** The remover stops early on a stubborn grid
  rather than ever producing a puzzle with two solutions. Removal is not rotationally
  symmetric — difficulty over prettiness.
- **The solver picks the most-constrained cell**, not the next empty one. Same lesson as
  `OccupancyGrid` in `game-arrows.ts`, where a 50x50 board went from 16s to 41ms.
- **`solution` rides on the client state.** The board is never persisted mid-game, so
  there is nothing here a player with their own dev tools does not already have.
- Generation runs inline on the main thread — tens of milliseconds. A worker would be the
  answer if it ever grew.

#### Blackjack

A bankroll run rather than a single hand: 1000 chips, bets 25–250, a six-deck shoe
reshuffled between rounds. Rules in
[game-blackjack.ts](src/lib/games/game-blackjack.ts); the deck primitives are
game-agnostic in [playing-cards.ts](src/lib/games/playing-cards.ts).

Every rule choice has a reason, and they are the interesting part:

- **Max bet is a share of the *starting* bankroll**, so a run cannot be decided by one
  all-in hand and the ceiling does not creep upward as you win.
- **Six decks**, because single-deck counting is easy enough to change how the game is
  played.
- **Dealer stands on all 17s**, soft included — simpler, and fewer special cases.
- **Naturals pay 3:2, not 6:5.** The shorter price is a house-edge increase dressed as a
  rule, and there is no house here.
- **No insurance and no surrender.** A button for a bad bet is just a trap.
- **Bust is checked first in `resultFor`** — the one rule that must not be reordered.
- The stake leaves the bankroll at the deal, so `chips` always reads as chips in hand.
- Chips are reported as `scoreUnit: "points"` to avoid a third unit. The scoreboard will
  say "1,450 pts" for chips; that mismatch is confined to one column.
- **It is the only game that saves a row for a loss**, on the reasoning that the
  scoreboard's `played` count should reflect that somebody sat down.

#### Minesweeper

Beginner, Intermediate and Expert — 9x9/10, 16x16/40, 30x16/99. Rules in
[game-minesweeper.ts](src/lib/games/game-minesweeper.ts).

Decisions worth keeping:

- **Mines are laid on the first click**, not up front and relocated. The first click and
  its whole neighbourhood are guaranteed clear, and relocating a mine would change two
  neighbourhoods' adjacent counts anyway. A fresh board is therefore deterministic, so it
  can be built during render — unlike Sudoku and Blackjack, which must be seeded in a
  mount effect to avoid a hydration mismatch.
- **Chording does not check your flags first.** Clicking a satisfied number with a
  misplaced flag detonates. Refusing would make the chord an oracle for verifying flags.
- **Flood fill is an explicit stack, not recursion.** An expert blank region deep enough
  to blow the call stack would take the tab with it.
- **Neighbours are computed, not precomputed.** The hot path visits each cell once, so a
  480-entry table built per board would cost more than the arithmetic it saves — the
  opposite call to Sudoku's 81-cell `PEERS` table, and for a reason worth keeping
  straight.
- **The eight number colours are literal**, per design.md's *semantic red/green stays
  literal* exception: at expert density you read the board by colour long before you read
  the digits.
- Expert scrolls horizontally rather than shrinking cells below a 1.75rem touch floor.

#### Adding another game

A game is **code plus one catalogue entry** — no migration, no new table, no nav
change, and nothing to register in `sys_modules`. That is the whole point of the
catalogue decision above, and it is what makes this a four-step job rather than a
module-sized one. Work bottom-up, as always.

**1. The rules, as pure functions.** A new file in `src/lib/games/` — mirror
[game-2048.ts](src/lib/games/game-2048.ts). Nothing about the game may live in the
view: the board shape, every legal move, the score arithmetic and the
is-it-over test all belong here, because that is what makes them testable and what
lets a CLI print the same game. **Inject the randomness** (`random: Random`) rather
than calling `Math.random` inside — a real RNG means a test asserting on a board is
also asserting on wherever the new tile happened to land, which is why every
`game-2048.ts` function takes it as an argument.

**2. A colocated Vitest**, success *and* failure paths, as `CLAUDE.md` requires. Pin
down the rules a player would argue about, not just the happy path — for 2048 those
were "a gap does not prevent a merge" and "a tile merges at most once per move". Two
traps worth knowing, both of which the 2048 tests actually caught:

- **An "is it over?" predicate defined purely as "does any move change the board"
  reports true for an *empty* board**, because sliding nothing changes nothing. Check
  for a free cell first. This shipped as a real bug and the test is what found it.
- **Assert the board orientation explicitly.** Up/down/left/right are easy to get
  transposed, and a merge that works left will silently do the wrong thing upward.

**3. The catalogue entry** in [catalogue.ts](src/lib/games/catalogue.ts):

```ts
{
  key: "sudoku",          // stored in gam_scores.game_key -- PERMANENT once a score exists
  name: "Sudoku",
  description: "One line, shown on the Arcade card.",
  status: "available",    // or "coming-soon" to list it before it is playable
  scoreUnit: "seconds",   // "points" | "seconds" -- how formatScore labels it
}
```

Two fields carry real weight. **`key` is permanent** — it is written into every score
row, and renaming it orphans them exactly the way renaming an icon slot id orphans an
upload. **`scoreUnit`** is what lets the shared scoreboard label a column without
knowing what the game is; if a new game scores in something that is neither points nor
seconds, widen the union in [types.ts](src/lib/games/types.ts) and the branch in
`formatScore` together.

`status: "coming-soon"` is a legitimate half-step: the card renders with a *Soon* badge
and no Play button, so a game can be announced before step 4 exists.

**4. The view, and one branch.** A `game-<name>-view.tsx` beside
[game-2048-view.tsx](src/app/(protected)/modules/[slug]/game-2048-view.tsx), plus a
case in [games-arcade-view.tsx](src/app/(protected)/modules/[slug]/games-arcade-view.tsx):

```tsx
{open.game.key === "sudoku" && <SudokuView bestScore={open.best?.score ?? 0} />}
```

The view owns presentation state only, and calls `saveScoreAction(key, score, moves)`
when the game **ends** — once. Guard that call with a ref: `over` alone re-fires on
every subsequent render and posts the same score repeatedly. Nothing else in the
module needs touching — the Arcade list, the scoreboard, the CLI and the Configuration
screen are all driven off `GAME_CATALOGUE` and pick a new game up for free.

**The game plays inside a `Modal size="full"`,** opened from the card's Play button —
not as a card below the arcade list, which made the board the least prominent thing on
a screen that exists to show it. Two consequences for a new game's view:

- **Size the board against `vh` as well as `vw`.** A square capped only by width
  overflows a short landscape window vertically and pushes its own controls
  off-screen. Both existing games use a three-term `min()`: a `rem` cap for a large
  monitor, a `vw` term for a phone, and a `vh` term for the dialog.
- **Don't render a `Modal` inside it** — for a win overlay, a confirmation, anything.
  Both instances register their Escape handler on `document` in the **capture** phase
  and call `stopPropagation`, so the outer one wins and Escape closes the whole game
  instead of the inner dialog; the two focus traps then fight over one tree. Arrow
  Clearing's win panel is a plain bordered `div` for exactly this reason.

Two things a new game does **not** get to decide, because they are module-wide: the
score is stamped server-side (`played_at` from the use-case, never the client), and
the board is not re-simulated on the server — see the fifth bullet above for why that
trade is deliberate and what changing it would cost.

### Icons

`icon` must be one of `MODULE_ICON_NAMES` in
[src/lib/modules/icon-names.ts](src/lib/modules/icon-names.ts): `building`,
`home`, `briefcase`, `wallet`, `chart`, `folder`, `shield`, `heart`, `book`,
`tool`, `journal`, `roster`, `music`, `game`.

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
set is active under Display Settings → Icons.

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

### Icon slots — replacing the icon in one specific place

The two lists above are keyed by *concept*, and a concept is shared: `quote` is used by
the home screen's Daily Quote card **and** by a Journal nav section, so "change the quote
icon" would necessarily change both. A **slot** is the way to change just one of them.

A slot is a code-registered id for one icon *position*
(`homescreen_card_daily_quote`) that declares a default concept (`quote`).
[`ICON_SLOTS`](src/lib/icons/slots.ts) is the registry — and the only queryable map of
where this app shows icons, which is what lets **Admin → Display Settings → Icons** list
positions rather than making an admin guess at concept names. Resolution runs:

```
override for (slot, active set)  →  the active set's glyph for defaultConcept  →  hand-drawn fallback
```

The last two steps are what already happened, so **a slot nobody has overridden renders
exactly as before.** Adopting a slot at a call site is therefore a safe one-line change:
add the registry entry, then swap `<TreeIcon name="quote" …>` for
`<SlotIcon slot={QUOTE_SLOT} …>`.

Every slot also carries a **`where`** field — the click path to the icon in plain English
("Home screen → the Daily Quote card header, immediately left of the title"). It is shown
under each row in the admin list, and it is load-bearing rather than decoration: `label`
alone is ambiguous once there are fifty-odd positions, because all five modules have a
"Dashboard" section and two admin entries share the `palette` glyph.

**86 positions are registered and all 86 are wired up** — every module's section nav,
the whole Admin nav, and the home screen's Daily Quote, Photo of the Day and Random
Photo cards. A slot that is registered but not yet converted at its call site would be
inert (it appears in the admin list and accepts an upload, yet the screen keeps
rendering the default concept); the `wired` flag on the slot drives that note in each
row, and there are currently none in that state.

### Two adoption patterns

**A named call site** — swap `<TreeIcon name="quote" …>` for `<SlotIcon slot={SLOT} …>`,
where `SLOT` comes from `getIconSlot("…")` at module scope. This is how the Daily Quote
card works, and how the remaining card headers should be done.

**A data-driven nav** — `SectionPanel` renders all six navs from `*_SECTION_ICONS` maps and
`adminNav`, so there is no call site to name a slot at. Instead the shell passes
`iconNamespace="expense"` and the panel derives the slot with
`sectionSlotId(namespace, node.id)`. That is why 51 section icons became replaceable
through **one** change in `section-panel.tsx` rather than 51 edits.

The derivation is why slot ids for a section must equal `<namespace>_section_<slug>` with
hyphens turned to underscores — Expense's slugs are kebab (`meta-data`), as are all of
`adminNav`'s. A mismatch doesn't throw; it silently stops matching the override, so
`slots.test.ts` enumerates every real section slug and asserts each resolves.

**What does not get a slot:** row actions (pencil, trash, refresh) and state glyphs
(`star` vs `star-filled`, `heart` vs `heart-filled`). Those are buttons and states rather than places — the same line
`ALWAYS_CLASSIC` already draws in `tree-icons.tsx`. Full reasoning, including why uploaded
SVG is sanitized rather than stored verbatim, is in
`migrations/0066_create_icon_slot_overrides.md`.

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

### Home screen cards

Which cards the home screen draws, and in what order, is configured from
**Administration → Display Settings → Dashboard Widgets** and stored as the single
`home_widgets` app setting (migration 0067). `src/lib/home-dashboard` owns the catalogue
and the encoding; the screen and `src/app/(protected)/page.tsx` only present.

The layout is **global** — one value for the whole install, like `color_theme` beside
it, so an admin arranges the home screen for everyone. `resolveHomeWidgets` takes a
plain string rather than a settings array precisely so a later move to a per-user layout
(`sys_user_preferences`, migration 0044) would touch only the route layer.

Four things worth knowing before touching it:

- **Visibility is an AND with each card's own condition, never an override.** Ticking
  Stock Daily Glance cannot conjure positions, and Daily Quote still needs a quote. The
  home screen keeps every guard it had; a tick can only ever *take a card away*.
- **Two of the things the home screen renders are deliberately not in the catalogue**
  — the one-shot deployment message (it clears itself once acknowledged, so a permanent
  "hide" would configure something already gone) and the failed sign-in alert (a
  security signal, shown only to admins while failures are unreviewed). Neither is a
  card you arrange.
- **A hidden card skips its own fetch.** The layout is read before any card data, so an
  unticked Random Photo costs no directory listings over the photo share and an unticked
  Daily Glance reads no positions. Hiding a card makes the page cheaper, not just quieter.
- **Spacing is positional, not per-card.** The carousel used to be first and carried no
  top margin while the others hardcoded `mt-8`. Once any card can be first, the gap has
  to follow position — and it follows the first *drawn* card, not the first ticked one,
  because a ticked-but-empty card would otherwise leave a stray gap at the top.

Adding a card: append its id to `HOME_WIDGET_IDS`, give it `HOME_WIDGET_INFO` copy, and
add a `case` to the switch in `page.tsx`. **No migration** — `resolveHomeWidgets`
inserts an id missing from a saved layout at its catalogue position (not appended, which
is the bug `stock-dashboard` shipped once) and drops an id that is no longer a card.

Not to be confused with the **Stocks & ETFs** module's own dashboard widgets
(`src/lib/stock-dashboard`), which are a different catalogue stored as a *module*
setting and configured from that module's Configuration section.

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

Skip this whole step for a single-screen module — that's a legitimate shape.
Every module currently shipping has a nav, though: CSV Analysis was the last
single-screen one and gained Dashboard + Configuration.

Otherwise, these files under
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
- **`<module>-section.tsx`** — a **server** component. Reads `deps`, loads only
  the data the requested section needs, renders `SectionLayout` with the heading,
  a `CollapsibleCard` of instructions, and the section body. Views get plain
  data, never `deps`.

There is **no central nav picker to register with** — an earlier version of this
document pointed at a `section-layout.tsx`, which does not exist. Each module's
`<module>-section.tsx` renders its own shell directly (see
[csv-section.tsx](src/app/(protected)/modules/[slug]/csv-section.tsx)), and the shell
hands `sections` to `TwoTierShell`, which renders `SectionPanel`. Nor is a
`<module>-nav.tsx` needed: no module ships one, because the section panel is
data-driven from the list above.

**Then register the section icon slots.** Add one `ICON_SLOTS` entry per section in
[src/lib/icons/slots.ts](src/lib/icons/slots.ts), with the id derived as
`<slug>_section_<section>` (hyphens → underscores), and pass
`iconNamespace="<slug>"` to `TwoTierShell` in the module's shell. That is the whole
wiring — `SectionPanel` derives the rest, so there is nothing per-section to edit.
Extend the section list in `src/lib/icons/slots.test.ts` so a later rename can't
silently orphan an override.

**Propose the ids and labels first and wait for confirmation** — they are user-facing
and permanent. See `coding-guide.md` → *Propose the labels — don't invent them
silently* for the table to present.

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

This is the checklist for a **new module**. Adding a *game* to the existing Games
module is a much smaller job with its own four-step recipe — see *Per-module detail*
→ **Games** → *Adding another game*; none of the items below apply to it.

- [ ] Slug, names, description, sequence, 3-letter prefix chosen
- [ ] `src/lib/<name>/` with types, schema, ports, repository, use-cases, `index.ts`
- [ ] Colocated Vitest covering success and failure
- [ ] `NNNN_create_*.sql` + `.md` log
- [ ] `NNNN_seed_<slug>_module.sql` + `.md` log
- [ ] `DEFAULT_MODULES` updated, with its comment naming the new seed migration
- [ ] Repository added to `deps` in `wiring.ts`
- [ ] `<module>-sections.ts` (no `"use client"`), `-nav.tsx`, `-section.tsx`
- [ ] Nav registered in `section-layout.tsx`
- [ ] Icon slot ids + labels **proposed and confirmed** before being written
- [ ] `ICON_SLOTS` entries added; `iconNamespace` passed to `TwoTierShell`
- [ ] Section/tab slug lists in `src/lib/icons/slots.test.ts` extended
- [ ] Branch added in **both** `page.tsx` and `[section]/page.tsx`
- [ ] Views, `-actions.ts`, `-instructions.tsx`
- [ ] Reused registered components; anything new added to `components.md`
- [ ] Works at 1024px and below, and you can say how
- [ ] CLI command added and registered in `CLI_registry.md`
- [ ] Module granted to at least one user
- [ ] This file's registry table updated
- [ ] `coding-guide.md` table-prefix table updated
- [ ] `/verify` green end to end
