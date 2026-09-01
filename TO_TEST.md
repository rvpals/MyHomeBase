# TO_TEST — manual test checklist

Comprehensive test list derived from `CHANGE_HISTORY.md`, `modules.md`,
`components.md`, `CLI_registry.md`, `e2e/smoke.spec.ts`, and the current working tree.

Tick a box when the check passes; leave it open and note the failure beside it.

## How to use this list

- **Sign in as an admin** granted **every module** (Admin → User Management).
- The list is split into **General** (platform-wide: shell, auth, admin, PWA, cross-cutting)
  and one section per module. Every module screen still needs its own pass.
- Check at desktop width first; items marked **📱** must also pass at ≤1023px.
- **Never test against the NAS production database.** Use the dev DB or a copy.
- `npm run verify` covers the automated gates; below are the things the gate cannot see —
  real clicks, real data, real edge cases.
- Clean up test rows after each section so the dev DB stays realistic.
- Items flagged 🔧 exercise working-tree work-in-progress (uncommitted changes).

---

# PART A — General (platform-wide)

## A1. Automated gates (run first)

> **Skipped in this manual pass** — these are covered by `npm run verify` / CI and
> don't need hand-testing. (typecheck, lint, lib-boundary, Vitest, migration dry-run,
> Playwright route sweep).

## A2. Shell, navigation & layout

- [ ] Signed-out visit to a protected page redirects to `/login`; signing in returns there.
- [ ] App bar (new `app-header.tsx`, 🔧) shows the wordmark and the module rail.
- [ ] Avatar menu holds My Account, the layout switch, Administration (admin only), Log out.
- [ ] The app-bar logo links to `/?home=1` and works even with a favorite-module startup.
- [ ] **Module rail** (`module-rail.tsx`, 🔧): granted modules only, admin-set order, icons.
- [ ] **Section panel** (`section-panel.tsx`, 🔧): a module's sections listed; active marked.
- [ ] Grouped headings (e.g. Journal Configuration → Preferences / Templates / Meta Data)
      open a dropdown; picking a child closes it and navigates.
- [ ] The compact sheet lists every section flat (group headings are not destinations).
- [ ] Module badge at the nav's head shows which module you are in on compact.
- [ ] Layout switch (full / rail / strip / compact) works and **persists** after reload.
- [ ] **📐 Boundary**: at 1024px the layout tilts to compact; desktop bar wraps, compact scrolls.
- [ ] Nav sits under the app bar and never under the music player bar (see Music section).
- [ ] Keyboard: Tab reaches the current section, Enter activates, brass focus ring visible.
- [ ] Nav bars and cards show their elevation (inset highlight + cast shadow) on every theme.
- [ ] No console errors while walking the admin and two module shells end to end.
- [ ] 🔧 The deleted nav modules (`app-chrome`, `tree-nav`, `puck`, the per-module `*-nav.tsx`)
      leave no dangling imports — typecheck proves this, confirm no 404 routes.
- [ ] 🔧 Each module's `*-shell.tsx` (Journal/Stock/Expense/Music/Attendance) renders its
      section screens identically to before.

## A3. Home / landing

- [ ] Module grid on desktop; coverflow carousel on phones (`ModuleCarousel`).
- [ ] A module with carousel artwork shows it; modules without show their icon tile.
- [ ] **Daily Glance** renders on the home page from the cached dashboard.
- [ ] **Today In History** (journal) shows past entries sharing today's month/day,
      labelled “N years ago”.
- [ ] **Startup message**: set one (Admin or `set-startup-message` CLI); the next visit
      shows the one-shot modal; OK clears it app-wide.
- [ ] A second browser/phone does not see an already-dismissed message.
- [ ] **Favorite module + open on startup**: enable in My Account; signing in lands inside
      that module; revoking access falls back to home (no redirect loop, no blank).

## A4. Auth, accounts & security

- [ ] `/login` accepts a valid username + password.
- [ ] Wrong password shows the same generic message whether the account exists or not
      (the audit log records the true reason internally).
- [ ] `/login/register` creates an account (username, full name, password ≥ 8).
- [ ] Registration redirects to `/login?registered=1`; the new account can sign in.
- [ ] Signing up with the admin-invite secret elevates to admin.
- [ ] Google sign-in auto-registers by email when `GOOGLE_CLIENT_ID` is configured.
- [ ] A disabled user cannot sign in; an admin can re-enable them.
- [ ] Logout clears the session; the back button cannot reopen protected pages.
- [ ] A user without a module gets 404/redirect when hitting its route
      (e.g. revoke Journal, try `/modules/journal`).
- [ ] Admin → Security shows sign-ins (success/failure, timestamp); the daily prune drops
      events older than 90 days.
- [ ] Password change works; other sessions for the user invalidate.
- [ ] Avatar upload and removal from My Account works and persists.
## A5. Administration

- [ ] The 13 admin routes in `e2e/smoke.spec.ts` render without overlay or console errors.
- [ ] **About**: change-history markdown renders inline (headings, code, `[Added]` tags).
- [ ] **User Management**: edit, disable, delete, set admin (fair guard for the acting admin);
      per-module grants checked; a new grant takes effect on the next load.
- [ ] **SQL Explorer**: list tables; a `SELECT` runs and returns a grid + result count;
      a non-SELECT (or a CTE) is rejected by the read-only guard; as admin, a real write
      statement applies and the affected table reflects it.
- [ ] **SQL Explorer → Truncate**: the button sits beside Open on every table row; the
      dialog quotes the *current* row count ("There are N record(s) in table X, are you
      sure?") and the confirm button is disabled until that count lands; Cancel leaves the
      table untouched; confirming empties it and the next insert gets id 1. Escape and an
      overlay click are ignored while it is running. On a phone the column list truncates
      instead of pushing Open/Truncate off the row.
- [ ] **Daily Quote**: add a quote; **Import from Newsletter** parses a pasted 3-2-1 issue;
      the admin quote list shows them.
- [ ] **Modules**: reorder with arrows; rename short/long names → rail, home grid, and nav
      badge all read the new names (no hardcoded copy); pick a module icon; set/remove a
      carousel image; Reset to defaults restores stock names/glyphs.
- [ ] **Themes**: apply each theme (Daybreak light + darks); tokens invert correctly; the
      choice persists across tabs and visits.
- [ ] **Icons**: switch the global icon set (classic + themed sets); module, section, and
      inline glyphs update; row actions (pencil/trash/refresh/search/star) stay hand-drawn.
- [ ] **Dashboard Texture** (🔧 migration `0063`): upload, see it on the home screen, remove it.
- [ ] **Application Configuration**: app name/theme/reset-to-defaults; blanking
      `application_name` is rejected.

## A6. PWA / installable

- [ ] Manifest `id` is `"/"` (stable identity — reinstalling updates, doesn't duplicate).
- [ ] Home-screen shortcuts derive from the visible modules; renaming/hiding a module
      updates them.
- [ ] iOS Add-to-Home-Screen shows the launch screen; the app is usable at 390px (📱).
- [ ] A periodic (non-deploy) restart does **not** show the “new deployment” banner.

## A7. Responsive & accessibility (📱 where noted)

- [ ] Every screen passes ≈390px with no horizontal page scroll (tables scroll inside
      their own card instead).
- [ ] The compact section bar scrolls sideways; only the active section is labelled.
- [ ] Icon-only buttons carry a `title` **and** `ariaLabel`; a visible brass focus ring on
      keyboard navigation.
- [ ] Modals close via ✕, overlay click, **and** Escape; a busy write suppresses all three.
- [ ] DataGrid rows are keyboard-focusable; Enter “opens” the row where `onRowClick` is set.
- [ ] Record-view modal excludes action columns.
- [ ] Filter/search inputs are labelled (not placeholder-only) — the smoke test relies on this.
- [ ] Print preview drops every `no-print` control and keeps the printable sheet ink-on-white.
- [ ] Category/tag images have `alt` equal to the name and hover `title`.

## A8. Cross-module & data integrity

- [ ] Deleting a user removes their sessions, module grants, and `sys_user_preferences` rows
      (no orphan rows).
- [ ] Revoking a previously-favorite module redirects to home rather than into a denied route.
- [ ] Migration dry-run runs over a **copy**; a fresh DB migrates 0001 → 0063 in one clean pass.
- [ ] Re-running migrations is idempotent (no duplicate seeded rows).

## A9. Deployment & ops (NAS)

- [ ] `npm run dev` boots locally; run `npm run clean:next` after a branch switch.
- [ ] `REBUILD_PUBLISH_NAS.bat` copies only files (never the live DB).
- [ ] After a manual copy, the NAS needs the touch/trigger to restart the server
      (`deploy.trigger`).
- [ ] A phone on the LAN reaches the NAS over HTTPS, signs in, and opens one module.
- [ ] The deployed app reads the freshly shipped `CHANGE_HISTORY.md` on the About page.
- [ ] `.verify/` copies never leak into the real `data/` (verify aborts otherwise).

## A10. General CLI

Run each with `npm run cli -- <command>`.

- [ ] `list-users`, `create-user` (rejects a duplicate username), `set-startup-message
      --show` / `--clear` (never exits non-zero on a missing DB).
- [ ] `user-preferences`, `run-scheduled-refresh`.
---

# PART B — Per module

## B1. My Journal

### Home screen (`/modules/journal`)

- [ ] **New Entry** button toggles the New Journal card; date defaults to today, time to now.
- [ ] Category/tag autocomplete suggestions come from existing categories/tags.
- [ ] **GPS** button fills the place and adds a location via geolocation.
- [ ] **Fetch today's weather** fills Weather (°C/°F per Preferences, WMO code shown).
- [ ] Saving an entry shows it at the top of Recent entries.
- [ ] **Prefill template**: selecting one fills only blank fields; a typed-in field is never
      overwritten; `current date`/`current time` modes resolve to now at apply time.
- [ ] Statistics card shows Top Tags and Top Categories with their icons; clicking a row
      opens the filtered Entries list.
- [ ] Recent entries grid: search, per-column filters, sort, export CSV; row click opens
      the entry screen.
- [ ] **Home search**: matches across date/time/title/content/place/categories/tags
      (case-insensitive), newest date first, capped at 50; blank term shows the grid.
- [ ] Show SQL (admin): re-runs the recent-entries query in the grid; Back to entries
      restores the list.
- [ ] Import from CSV (journal) works with a saved or auto-derived mapping.
- [ ] Re-importing the same journal export is a no-op — every row reports *skipped*, not
      imported, whether the file writes time as `15:30` or `15:30:00`. A time typed as
      `9:05` is stored as `09:05`, and an entry with no time still imports.

### Entries section (`/modules/journal/entries`)

- [ ] Rows open the entry screen; newest-first ordering matches the home list.
- [ ] **Filter browser**: choose or type a query (e.g. `category = Name`, tags any-of);
      the filtered list is a shareable `?filter=` URL that survives refresh.
- [ ] **Saved filters**: save, load from the dropdown, delete.
- [ ] Category/tag links produced by `journalEntriesFilterHref` land on the right filter.

### Entry screen (`/modules/journal/entries/[id]`)

- [ ] Every non-blank field renders; blank fields are hidden (place/weather/locations).
- [ ] **Print / Save PDF** prints only the entry sheet, ink-on-white, no buttons/nav.
- [ ] **Edit** opens the form prefilled; saving refreshes the screen.
- [ ] **Lock** disables Edit + Delete (both show “Unlock the entry…”); the use-case rejects
      edits to a locked entry; Unlock reverses.
- [ ] **Delete** guarded by inline confirm; a locked entry cannot be deleted.
- [ ] **Previous / Next** walk the neighbours; the caption shows older/newer dates;
      oldest shows “This is the oldest entry.”
- [ ] **Map** (per location) opens the leaf panel; “Map All Locations” only when >1;
      OpenStreetMap and Google Maps deep links open in a new tab.
- [ ] **Pictures of this date** (photos card, 🔧) appears between content and Misc Info;
      thumbnails open in the photo lightbox (🔧 `photo-lightbox.tsx`).

**Jump to calendar (running shoe) — the new feature:**

- [ ] On the entry screen a running-shoe icon sits directly right of the date field.
- [ ] Hovering shows the tooltip **“Jump to calendar”**; a screen reader hears the
      matching aria-label.
- [ ] Clicking navigates to `/modules/journal/calendar?anchor=<entry-date>&date=<entry-date>`
      with the scope defaulting to **month**.
- [ ] The calendar shows the **month containing the entry's date**, the day cell is
      **selected**, and that day's entries are listed **below the grid**.
- [ ] Back/forward preserves the selected day; a refresh keeps it.
- [ ] The icon is hidden from printed output (`no-print`).
- [ ] Misc Info: Category/Tag chips (header icons and chips) link to the `?filter=` list.

### Calendar section (`/modules/journal/calendar`)

- [ ] Week / Month / Year segmented control; the active scope is highlighted.
- [ ] ‹ › steps by the current scope; stepping back from Jan 31 lands on Feb 28 (clamped);
      ‹ then › returns to the start month/day.
- [ ] **Today** both moves the anchor and selects today.
- [ ] Clicking a day lists its entries below the grid; clicking the selected day clears.
- [ ] Clicking a padding day (neighbour month) also moves the anchor to that month.
- [ ] Clicking an entry title in a cell opens it in the modal viewer (no Edit there).
- [ ] **Jump box**: parses per the chosen format (default MM/DD/YYYY), lenient separators;
      a native date picker sits beside it.
- [ ] The Jump format persists in `localStorage` between visits.
- [ ] Year view: 12 mini-months with a heat scale for busy days; weekends present.
- [ ] Cell titles elide to ~30 chars; hover shows the full title.
- [ ] A day's entries order timed-first, then by id — same in the panel below.
- [ ] Bookmarks: a month/week/year URL reopens the exact period and selected day.

### Templates (`/modules/journal/templates`)

- [ ] Create/upsert a template by field; delete removes it; enable/disable toggles its
      presence in the New Entry dropdown.
- [ ] CLI: `journal-templates list` / `show` / `apply` / `set` / `enable` / `disable` /
      `delete`; `journal-templates apply --name` prints the same prefill the form would use.

### Preferences & Meta Data

- [ ] Default location + °C/°F saved in Preferences; weather fetching honours them.
- [ ] Categories & Tags: create/rename/delete; upload an icon; **Generate icon** (lightning
      bolt) works; icons appear in Statistics, entry headers, calendar rows, and the editor.
- [ ] No icon ⇒ the empty slot is skipped everywhere (never an empty square).
- [ ] Replacing an uploaded icon busts the cache (`?v=` param) on reload.

### Journal CLI

- [ ] `journal-calendar` (month/week/year; `--day`) prints the same grid the web shows.
- [ ] `journal-templates` (see Templates above).
- [ ] `import-journal-csv --file` imports using the auto mapping or a named saved mapping.
## B2. Stocks & ETFs

### Dashboard (`/modules/stock-etfs`)

- [ ] Daily Glance: portfolio total, today's move, total return on the home card.
- [ ] **Refresh & snapshot** beside the heading drives a live progress strip one position
      at a time; today's snapshot row is upserted (two refreshes ⇒ one row).
- [ ] **Ticker search** (magnifier): partial-match suggestions; a held/watched symbol opens
      on “Our data”, an unknown one opens on the “Yahoo” tab instead.
- [ ] **Favorites star** in the ticker viewer toggles; the favorites jump list shows starred
      symbols; selling a position never auto-removes the star.
- [ ] Sector-allocation chart groups by sector (funds under “ETFs & funds”; blank sector
      shown truly blank; a failed fetch stores no cached row).
- [ ] The dashboard widget order/preference persists.

### Positions

- [ ] Add a position (symbol, shares, cost/date) → it appears with basis and gain.
- [ ] Edit / refresh prices; **Split by instrument type** (Stocks / ETF / Others) survives
      a refresh.
- [ ] Row click opens the ticker viewer.

### Transactions

- [ ] Buy increments shares / cost basis; sell decrements; cash figure correct.
- [ ] **Trade performance**: ticker detail shows how far a trade has moved since you made it.
- [ ] Brokerage firm recorded per trade (back-filled for old imports).
- [ ] Grid: sort, filter expressions, aggregates, record view, export.

### Accounts (`/accounts`)

- [ ] Create / edit / delete a brokerage account.
- [ ] **Account performance over time** plots every account on one set of axes, points shaped
      by type; sparse gaps are skipped (never a $0.00 label); “latest” = last real value.
- [ ] CSV broker-import remembers which account a label maps to.

### Watch & Test (`/watch-test`)

- [ ] Watch lists: create, add/remove symbols, chart them.
- [ ] Next-day signals honour the configured thresholds.
- [ ] Favorite stars show next to watched symbols where applicable.
- [ ] Simulation runs a backtest on any ticker; the three cards (Watch Lists,
      Next-Day Signals, Simulation) each fold away independently.

### Charts & Analysis (`/charts`)

- [ ] Volatility, correlation, Sharpe render.
- [ ] Chart-type selector (line/bar/area/scatter) and point labels (none/latest/high&low/all);
      “all” caps and signals the downgrade below 1024px (📱).

### CSV Import (`/import`)

- [ ] Upload a broker statement, define a named mapping per broker, preview, import.
- [ ] Re-importing an overlapping statement skips “already imported” duplicates.
- [ ] A wrong account id fails fast with one clear error.

### Ticker viewer (dialog)

- [ ] **Our data**: price, history, news, risk, sector/industry (negative cache semantics).
- [ ] **Yahoo tab**: quote data; opening from a never-seen symbol lands here.
- [ ] **Line ↔ Candles** toggle; candles clamp their wick so high never draws inside the body.
- [ ] Favorite star in the header matches the starred state everywhere the symbol appears.
- [ ] Ticker logo serves from the cache with `?v=` busting.

### Configuration (`/settings`) & CLI

- [ ] Threshold fields save and reload; the next-day scan respects them.
- [ ] CLI: `refresh-positions`, `compute-analytics`, `ticker-overview --market --refresh`,
      `favorite-quotes`.
## B3. Expense Tracker

### Dashboard (`/modules/expense`)

- [ ] Totals card (spent, by card), and the “needs attention” (status `new`) count.
- [ ] Spend stats render (top categories / latest period).

### Transactions

- [ ] Browse/search/sort/filter the grid; per-column filters, aggregates, record view.
- [ ] Add a transaction by hand: category, card, amount (charges positive, credits negative),
      status new/reconciled/irreconcilable, note.
- [ ] Bulk edit a selection (category/status) applies to exactly the rows chosen.
- [ ] Export CSV reflects the current filter/sort.

### Overlapping CSV re-import (the key dedupe scenario)

The importer matches an existing row on **(account, transaction date, description, amount)**
and skips it as “already imported”. It is an application-level check, not a DB unique index.

- [ ] Import statement A, then the **same file** again → every row “already imported”, no
      duplicates in the grid.
- [ ] Import file A then file B covering **overlapping dates** on the same card → only the
      genuinely new rows insert.
- [ ] Different cards, same file → all rows insert (never cross-deduped).
- [ ] An identical purchase whose description differs by one character is treated as new
      (expected caveat).
- [ ] Summary counts rows: imported / skipped-with-reason / duplicateCount / categorisedCount.
- [ ] Import of an overlapping file after adding a NEW rule does not re-categorise the old
      rows (they're skipped as duplicates); manual clean-up covers that.

### Meta Data (`/modules/expense/meta-data`)

- [ ] Credit cards: create/rename/delete; upload a card image (served via its route, `?v=`
      busts the cache).
- [ ] Categories: create/rename/delete; icon upload/generation mirrors the journal flow.
- [ ] Deleting a category with transactions is blocked or surfaced clearly.

### Charts & Analysis

- [ ] Category breakdown renders from `totalsByCategory`; a filtered set changes the chart.

### Import (`/modules/expense/import`)

- [ ] **CSV import**: choose file, map columns (transaction date / posting date / description
      / amount / separate debit & credit columns / category / note), date format, invert
      amounts if the export lists purchases negative.
- [ ] **Post-import rules**: a rule matching the raw description assigns category/vendor/
      status/note; newly imported rows arrive complete; rules run once so manual edits are
      never overwritten.

### Settings / auto-import & CLI

- [ ] Auto-import path + interval saved; enabling the switch imports a dropped CSV.
- [ ] The scheduled runner (scheduled-runs, 🔧) fires and logs a run; disabling stops it.
- [ ] CLI: `expense-top-spenders`, `explain-rule`.
## B4. Attendance

- [ ] **Home**: pick a class → today's register with every rostered student.
- [ ] **Two registers a day**: save a session, then take another for the same class/date;
      each session is its own timestamped row and both appear in the report day.
- [ ] Mark present/absent; a partially-saved register persists.
- [ ] **Student actions** (Late, Extra Credit, …): catalog CRUD; recording one attaches it
      to that student in that session; glyphs render from the action icon map.
- [ ] **Rosters**: add a student, create a class, enrol students; **roster CSV import** (🔧
      `attendance-roster-import-view.tsx`) reports per-row results.
- [ ] **Report**: print a class's register for the selected day — grid + notes, printable;
      the `?classId=&date=` URL reopens the same report.
- [ ] Configuration: preferences saved and honoured by the register logic.
- [ ] CLI: `take-attendance`, `attendance-report` (class + date).

## B5. Music Library

### Library & scanning

- [ ] **Scan Music**: pick a NAS folder; configured formats scanned into the catalog;
      rescan adds new files and updates changed ones without duplicates.
- [ ] Browse by album / artist / genre / All Songs; search across titles/artists/albums.
- [ ] Clicking a track in any list sets it as the now-playing entry.

### Player

- [ ] Play/pause/seek/next/prev; now-playing artwork, title, and artist.
- [ ] **Player bar** sits above the bottom without covering the section nav, on desktop and
      phone (📱), and clears the iOS home indicator.
- [ ] **Lyrics**: *Get lyrics* fetches and caches (lrclib); `not_found`/`failed` show
      “Try again” and are never silently re-asked; the **auto-retrieve** toggle (off by
      default) fetches for a fresh track with no cached answer; `instrumental` never retries.
- [ ] A track asked once is never asked again even after many plays.

### Queue

- [ ] The queue route is bookmarkable and the queue survives a reload.
- [ ] **Reorder / remove / shuffle-rest / jump-to-row**; shuffle never moves the playing track.
- [ ] The same track queued twice is two entries, each individually addressable.
- [ ] **Repeat off / all / one** cycles correctly; repeat-one loops just that entry.
- [ ] **Save queue as playlist**: naming a new playlist or appending to an existing one both
      work; playlist names are unique.

### Magic Playlists

- [ ] Pick genres/artists/albums (OR within a field, AND across fields) + target length;
      generation fills toward the length.
- [ ] **Regenerate** produces a different valid set for the same criteria.
- [ ] Replaying a saved list runs in the stored order; the artist-spacing pass keeps the same
      artist from clustering.
- [ ] Folders (🔧 migration `0060`): create, drop generated lists into folders, view them.
- [ ] CLI: `magic-playlist` generation matches the web result for identical criteria.

### Configuration

- [ ] File-format includes/excludes affect the next scan immediately.
- [ ] Auto-lyrics toggle saved.

## B6. CSV Analytics (no sections — single view)

- [ ] Create an entry: display name, base table name, optional primary-key columns; the
      `csv_<name>` table is created from the imported file.
- [ ] Grid renders with pagination, sort, per-column search, filters, export.
- [ ] **Add custom columns without re-importing**: the schema editor appends columns that
      appear on existing rows (append/truncate path).
- [ ] Chart builder: build a chart, save a preset, reload it exactly.
- [ ] **Chart type selector** (line/bar/area/scatter) and point labels apply per chart;
      presets do not store display options (they persist per-chart in `localStorage`).
- [ ] Old presets carrying a stale `showDots` are ignored, not errors.
- [ ] CLI: `list-csv-analytics`, `create-csv-analytics-entry`, `delete-csv-analytics-entry`.

---

*Legend: 📱 = must also be verified at ≤1023px / 390px. 🔧 = exercises uncommitted
working-tree work-in-progress. Items without a module above are covered in PART A.*

*Suggested order: A1 gates → PART A platform checks → each PART B module (its highest
-churn area first: Journal / Expense / Music).*