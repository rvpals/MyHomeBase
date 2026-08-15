# Change History

## 2026-08-14 23:01 — My Journal: a filtered Entries browser, category/tag icons, and self-migrating deploys

Three bodies of work land together.

**Entries browser with saved filters** (migration `0043`, new table
`jrn_saved_filters`). A new **Entries** section in My Journal builds a condition
tree in the UI — one level of AND/OR groups, each holding N conditions — applies it
to the entry list, and can save it under a name to pick from a dropdown later.
New library modules `filters.ts` (`buildFilterSql`, `describeFilter`, the
per-field operator table) and `filter-query.ts` (a text query parser), plus
`findEntries` / `listFilters` / `getFilter` / `saveFilter` / `deleteFilter`
use-cases and route-local `journal-entries-view`, `journal-entries-panel`,
`journal-filter-builder`, `journal-taxonomy-view` and `journal-shared` views.
`filter_json` is a deliberate JSON-column exception on the same grounds as
`csv_chart_presets.options_json`: variable shape defined by the builder, replaced
wholesale on save, never queried by SQL. Correctness therefore lives in code —
`journalFilterSchema` validates the tree **on read as well as on write** using the
widening-envelope pattern, an unparseable row is reported as unreadable rather
than thrown, and `buildFilterSql` emits named parameters only, mapping field names
through a fixed allowlist so a JSON `field` is never used as a SQL identifier.
`UNIQUE (name)` makes save a single upsert, so saving under an existing name
overwrites it. GPS/location conditions are anticipated and deliberately not built.

**Icons for categories and tags** (migration `0042`). Each journal category and
tag takes an uploaded icon, served by new routes
`/api/journal/categories/[name]/icon` and `/api/journal/tags/[name]/icon` and shown
at the right of an entry's date/time row. Stored as a `BLOB` + mime type, matching
`exp_categories.icon_image` (0034) and `stk_investment_accounts.icon_image` (0037),
so the bytes never ride along in a page's JSON payload — the category/tag reads in
`repository.ts` moved to explicit column lists to keep the blob out of every normal
query. PNG/JPEG/WebP/GIF only, capped at 128 KB (`MAX_JOURNAL_ICON_BYTES`) via the
shared `image-upload.ts` helper; SVG is excluded because it can carry script from
the app's own origin. The same migration drops `jrn_icons`, dead schema since 0027
that no repository or route ever read or wrote. `EntryViewer` also gained
`onShowAllLocations` (a multi-pin map, only offered when an entry has more than one
location) with `#n` prefixes on the location rows matching the numbered pins, and
`CollapsibleCard` gained `titleIcon`.

**Deploys apply their own migrations.** `start.sh` now runs `migrate.cjs` in the
window after the old process stops and before the new one binds — the only safe
moment, since a schema change against a live database risks a locked write and
starting first would serve new code against an old schema. It's gated on
`DEPLOYED=1` so a crash-restart never migrates, and a migration failure is
deliberately fatal rather than bringing up a build whose schema didn't land. This
removes the one hand-run SSH step that could silently be skipped (and once was —
it shipped a screen answering "no such column"); `ADMIN_MANUAL.md` and
`INSTRUCTION_SETUP_SYNOLOGY.md` updated to match.

**Also:** the top toolbar and a module's `TreeNav` section bar now share a new
`--app-bar` theme token — a neutral dark grey, a step below `--paper`, so the two
pinned nav edges read as one chrome layer framing the page.

## 2026-08-14 — CSV Analytics: add columns without re-importing a file

Follow-up to the custom-columns feature (`058e8ef`): adding a new column during
append/truncate no longer requires dropping a new CSV file first — a new
`addColumns` repository method runs `ALTER TABLE ... ADD COLUMN` against the
entry's per-entry table directly (existing rows get SQLite's default `NULL`) and
updates its stored `columns_json`. This is a raw `ALTER TABLE`, not the
copy-rename-drop migration pattern, because it targets one of CSV Analysis's
user-generated per-entry tables (`csv_` prefix, created at runtime by
`buildCreateTableSql`) rather than one of the app's own fixed-schema tables — the
same runtime-DDL treatment those tables already get from create/drop.
`createEntry`'s new-column handling also had a bug fixed: it was reading new
columns' typed values by header, which doesn't exist for a column with no file
header — now reads by the column's `name`. Zod schemas for both create and
update gained a `.refine` requiring every new column to have a non-blank typed
value before submission.

## 2026-08-14 — ModuleCarousel: a grid on desktop, coverflow stays on phones

`ModuleCarousel` (the home screen's module picker) now renders two different shapes
depending on `useIsCompact()`, not one: **on `full` it's a wrapping grid** of every
module's tile (image/icon, name, description) shown at once, and **on `compact` it
keeps the coverflow** (selected tile centred and scaled up, neighbours dimmed either
side, arrow keys / swipe / dots to rotate). Desktop has the width to show every
module without asking the reader to click through one at a time, so the coverflow's
reveal-one-at-a-time affordance no longer earns its keep there; a phone doesn't have
that width, so it keeps the original interaction. The rotate keydown handler is now a
no-op on `full`, since there's no selection to rotate. Also fixed two doc comments
that had drifted to say "height"/"vertical scroll" for values that are still used as
horizontal pixel offsets in the (still-present) coverflow code. `components.md`
updated to describe both shapes.

## 2026-08-14 00:03 — Today In History moved to the landing page

Moved the **Today In History** card off My Journal's home screen and onto the
app's landing page (`(protected)/page.tsx`), placed right after the Daily Quote
card. Extracted it into a new one-off `TodayInHistoryWidget`
(`(protected)/today-in-history-widget.tsx`), mirroring `DailyQuoteWidget`'s
pattern (a route-local widget, not a registered component) — it fetches via the
existing `listTodayInHistory` use-case, unchanged, and clicking a row still opens
that journal entry. My Journal's `JournalView` and `JournalSection` no longer
fetch or render it.

## 2026-08-12 — DataGrid: column headers popped up into a 3D bar

Gave the shared `DataGrid`'s column-header row a more pronounced, modern lifted look so it
reads as a raised bar floating above the scrolling rows (it affects every grid — User
Management, Stocks & ETFs, CSV Analytics, SQL Explorer, and MyJournal, since they share the
one component). Each header cell now casts a layered drop shadow — a brighter inset top
bevel for the lit edge, a faint inset bottom shade for depth, a deep diffuse cast shadow and
a tight grounding shadow — on top of the existing `bg-brass-soft` bar and sticky `top-0`
positioning. No markup, layout, or API changes; styling only.

## 2026-08-12 — My Journal: home-screen entry search

Added a **Search** card to the journal home screen. A small **Search** button on the card's
title line (always visible, even collapsed) opens the card to an inline input; submitting
searches the full journal text and shows a 3-column result grid — **Date/time, Title,
Content** — with the keyword **highlighted** (`<mark>`) wherever it appears. Clicking a row
opens that entry.

- New `searchEntries` use-case in `src/lib/journal/` (use-case → port → SQLite repo): a
  case-insensitive substring match across an entry's date, time, title, content, place,
  categories, and tags, newest journal date first, capped at 50 results. LIKE wildcards
  (`%`, `_`, `\`) typed by the user are escaped so they search literally. Blank terms return
  nothing rather than dumping the journal.
- New `searchJournalEntriesAction` server action and a route-local
  `JournalSearchView` (`journal-search-view.tsx`) wired into `JournalView` at the top of
  the home screen. The grid reuses the registered `DataGrid` (export + status bar), with its
  built-in search disabled so the card's own input is the only search box.
- The result content cell is clamped to 3 lines so a long entry doesn't explode the row;
  the highlight still shows where the keyword matched.

## 2026-08-12 — The journal entry viewer became `JournalViewer`

Renamed the registered `JournalEntryCard` component to `JournalViewer`
(`src/components/journal-viewer.tsx`), the journal counterpart to `TickerViewer` — the
single shared component for displaying a journal entry wherever it's viewed (currently the
entry screen at `/modules/journal/entries/[id]`; any future print/export view shares it).
No API change: same props, same behavior. Updated the one call site
(`entry-screen.tsx`), `components.md`, and `design.md`. The git history keeps the original
file via a rename, so `JournalViewer` is the same component under its new name, not a
duplicate.

## 2026-08-11 14:51 - Manual release

Manual release on 2026-08-11 14:51. Published to: NAS.

No described entry: this release was shipped with `scripts\manual-release.ps1`.
Run `/release` instead when the changes deserve a written summary.

## 2026-08-10 21:48 — The section tree became a bar, and surfaces learned to lift

**No migration in this release.**

Two bodies of work, both about the desktop layout. The section nav stopped being a column
down the side and became a bar across the top — finishing the direction the last two
releases set on the phone. And the nav bars and cards picked up a real elevation, so a
layered screen reads as layers rather than as flat panels butted together.

### [Changed] `TreeNav`'s `full` state is a horizontal bar, not a 256px column

The compact layout has been a bar since the release before last. Desktop kept the nested
tree in a `w-64` column — which meant a quarter of a 1024px window was spent, for the
whole visit, on navigation that gets read once on arrival. `full` is now the same shape as
the compact bar: a row of chips across the top of the section, with the content taking the
full width beneath it.

**Every chip is labelled here**, unlike compact, which names only the active one. That's
the whole reason the two states differ — a desktop row has room for eight labels and a
390px phone doesn't.

`rail` and `strip` are unchanged and still columns, which is the interesting consequence:
**the nav now changes orientation with its state, not just its width.** A shell laying nav
and content out in one flex row would squash a full-width bar against the content beside
it, so a shell has to stack for `full` and go side-by-side otherwise — and only the nav
knows which it currently is. Hence a new `onStateChange` prop, raised on every change *and
once on mount* after the stored preference is read; a shell told only about *changes*
would render side-by-side for one paint and jump when a stored `full` came back. It has to
be memoized — it's raised from an effect keyed on the callback.

### [Added] `GroupChip` — group headings became dropdowns

A bar can't nest, and the compact bar's answer (drop the headings) wasn't available on
desktop: Administration's `Configuration` is the **only** route to four screens. So a
heading is now a chip that opens its children beneath it — closed on outside click,
Escape, and on picking a child, and taking the accent when one of its children is current.
The listeners are attached only while open, rather than four handlers running on every
click in Administration.

**The full bar wraps; the compact bar still scrolls sideways.** A scroll container clips in
*both* axes — setting `overflow-x` computes `overflow-y` to `auto` — so a scrolling row
would cut the dropdown off at the bar's own bottom edge, which is exactly where it hangs.
Wrapping costs a second row only on a genuinely narrow desktop window. Compact has no
groups to open, so it keeps the scroll.

The flip side, stated plainly: **compact can't reach a grouped leaf that has no other
route**, because a dropdown affordance doesn't fit a 390px row.

### [Added] `SectionLayout`, shared by the two module shells

`ExpenseSection` and `StockSection` are *server* components — they read `deps` directly —
so neither can hold the nav's state. Both now hand their already-loaded body to a small
client component that owns the row/column decision. It takes the nav as a **slug**
(`"expense" | "stock"`) rather than the element, because a render prop wouldn't survive the
server/client boundary; it imports both navs and picks one. Admin does the same thing
inline, since it has one nav and already had the state.

### [Added] Elevation for nav bars and cards, as four CSS classes

`AppChrome`'s two bars had a hard-coded `shadow-[...]` arbitrary value each; `CollapsibleCard`
had no lift at all. Both now use named classes in `globals.css`:

- **`.nav-raised-top` / `.nav-raised-bottom`** — a 1px inset highlight on the lit edge plus
  a soft wide cast shadow. Two classes because the cast falls *away* from the light, so a
  bottom-pinned bar's shadow has to point up at the content it overlaps rather than off the
  screen. Used by the app bar, the module tabs and the section bar.
- **`.card-raised` / `.card-raised-hover`** — softer and flatter than the nav bars, and
  nothing like `Button`'s hard offset edge; `design.md` keeps cards calm. Three layers: the
  inset highlight, a hairline ring that deepens `border-line` from *outside* so the token
  still inverts per theme, and a tight cast shadow. Hover grows the shadow rather than
  translating the card, which would shift `CollapsibleCard`'s toggle out from under the
  pointer mid-click.

All the alphas sit in the range `design.md` calls safe for either polarity, so they read on
Daybreak (where `paperRaised` is pure white) as well as on the dark themes. Defined once
rather than inline at the call sites, so the pairs can't drift apart.

### [Removed] `getModuleCode` and the three-letter module code

Every module page printed a derived code — `REI`, `EXP` — above its title in brass
monospace. It was decoration: the heading directly beneath it already names the module, and
the code appeared nowhere else after the collapsed sidebar that once used it was retired.
`src/lib/modules/format.ts` and its test are gone, along with the now-unused `code` field on
`AppChromeLink`.

### [Added] `CLI_registry.md`

A reference for driving the app from a terminal: the 12 commands that exist today, the full
inventory of library use-cases a command *could* call, and the gap between them. Derived
from source rather than from running anything. Useful because discovery is currently by
failure — `npm run cli` with no arguments prints the list and exits 1.

`.claude/commands/release_myhomebase.md` was renamed to `.claude/commands/release.md`.

---

## 2026-08-08 22:29 — The app tells you when it has just been redeployed

**Adds migration `0041_seed_startup_message_setting`.** Seed data only — no schema change.

Three bodies of work: a deployment notice on the home screen, the finish of the compact
section bar the last release started, and a server-action authorization fix in user
management.

Publishing to the NAS is silent. The files land, the keepalive task cycles the process
within the minute, and anyone already looking at the app has no idea they're now on a new
build. This adds a one-shot notice: the first person to reach the home screen after a
deployment gets a modal saying so, clicks OK, and it's gone.

### [Added] `STARTUP_MESSAGE`, a one-shot home-screen notice

A new key in `sys_app_settings`. Non-blank means "show this on the home screen"; the OK
button clears it. A deployment writes `A new deployment is published on <timestamp>`, but
the mechanism is general — set it to anything and the next visitor sees it once.

**Dismissal is app-wide, not per-user.** It's one settings row, so whoever clicks OK
clears it for everyone. That's the intent for a deployment notice — it's an announcement,
not something personal — but it does mean dismissing on a desktop means the phone never
sees it. Per-user would need its own table.

**The value is blank, never NULL.** `sys_app_settings.value` is `TEXT NOT NULL`, and
relaxing that in SQLite means a full table rebuild for no behavioural gain, so blank is
the "nothing to show" sentinel. `getStartupMessage()` maps blank *and* whitespace-only to
`undefined`, so nothing outside the library ever compares against `""`. Written up in
`coding-guide.md`, since the next blankable setting will face the same choice.

`settingUpdateSchema` stays strict (`.min(1)`) — it's what the admin Application
Configuration screen posts, and blanking `application_name` there would leave the UI with
no wordmark. The blankable path got its own schema and its own upsert (`setValue`) rather
than loosening the shared one for every setting.

### [Added] The deploy writes the key on the target, never across SMB

`REBUILD_PUBLISH_NAS.bat` reaches the NAS only over a network share, and writing a live
SQLite database across SMB risks corrupting it — the app holds it open in WAL mode. So the
batch file doesn't touch the database at all. Instead:

- `publish-nas.mjs` bundles **`set-startup-message.cjs`** next to `migrate.cjs`, plain CJS
  so the NAS still needs no `tsx`. It's bundled rather than `tsc`-compiled because it
  imports from `src/lib/` and the `@/` alias has to resolve at build time.
- **`start.sh` runs it after a trigger-driven restart** — gated on `deploy.trigger`, so a
  crash-restart brings the app back without claiming a release happened. The timestamp is
  therefore when the build actually went live, not when the files were copied.

The setter **never exits non-zero.** Opening the database is inside the try block, so an
unreachable or missing DB warns and exits 0 rather than failing the publish — the new build
is already serving by then, and a missing banner is not a failed release.

`start.sh` is excluded from the publish on purpose, so **this one needs a manual
`scp` to the NAS** before it takes effect. `ADMIN_MANUAL.md` gains a
`grep -c set-startup-message` check alongside the existing `deploy.trigger` one.

### [Added] `set-startup-message` CLI command

The use-case is reachable from the terminal as well as the web app, per the architecture
rule: `--show`, `--clear`, a custom message, or no argument for the standard deployment
wording. `formatDeploymentMessage()` lives in the library so the CLI, the NAS and the
Windows publish all emit the same sentence instead of three drifting variants.

### [Changed] Windows publish, then retired

`REBUILD_PUBLISH.bat` also bundles and runs the setter, after its migration step and from
inside the destination folder. It was verified working — but the Windows target is being
retired in favour of the NAS, so this is likely its last release. `C:\webapp\MHB` is
untouched by this one.

### [Added] `Puck`, and the compact section bar finished

The previous release turned a module's `TreeNav` on its side below 1024px; this one
completes it. The round target a minimised bar leaves behind is now a registered
component — three of them are in play (top bar, module tabs, section bar) and they were
being rebuilt each time.

**Give each puck its own corner.** They're all `fixed`, so two sharing one stack
invisibly and only the top is ever pressable. `position` carries stacking as well as
placement because there's no `tailwind-merge` here — a built-in `z-40` couldn't be
reliably overridden by a caller's `z-30`.

The supporting CSS landed too: `tree-nav-sticky`, `tree-nav-bleed` and `tree-nav-puck` in
`globals.css`, all keyed to `html[data-viewport="compact"]` rather than a media query,
because the layout can be pinned and a 1400px window can legitimately be compact.
`TreeIcon` gained a `hasTreeIcon` companion — an unknown key renders `null`, which is fine
in a labelled row and a blank button on an icon-only puck.

### [Fixed] User-management actions checked authentication but not admin

Every action on that screen acts on *someone else's* account, and each one verified only
that the caller was signed in. The route layout redirects non-admins, so the screen was
unreachable — but **a server action is its own endpoint**, callable directly without ever
rendering the page. Any signed-in user could have driven them.

`getActingUserId` is now `getActingAdminId` and asserts `isAdmin`. The lesson generalises:
gating the page that renders a control is not gating the control.

### [Added] Admins can set another user's avatar

From the user list, using the same multipart `FormData` path as the module carousel image
— a couple of megabytes shouldn't be base64-encoded in the browser and inflated by a third
on the way over, and Next rejects a long string argument outright with "Maximum array
nesting exceeded."

---

## 2026-08-08 15:20 — Navigation moved to the edges, and every chart got a gear

**No migration in this release.**

Two bodies of work. The phone release before this one shrank the sidebar until it fit;
this one accepts that a 240px slab down the left is a desktop pattern and retires it. And
the charts stopped being fixed pictures — the reader now decides what a chart shows.

### [Changed] `AppChrome` replaces `Sidebar`

Navigation is now a **fixed top bar**, plus a **bottom module bar** on the compact layout.
The left slab is gone: it cost a phone 62% of its screen and, being `fixed` above the
content, swallowed taps meant for the page underneath. Moving the nav to the edges gives
every page the full width at every size — the `pl-24` gutter the shell used to reserve for
the icon rail is gone with it.

**The only thing that differs by layout is where the modules sit.** On `full` they're in
the top bar beside everything else; on `compact` there's no room, so they move to a bottom
bar, icons only, within thumb reach rather than in the corner hardest to hit one-handed.
App name, view switch, admin, account and log out are identical in both.

That bottom bar's spacing allowance keys off `html[data-viewport="compact"]` and **not** a
media query, deliberately: the layout can be pinned, so a 1440px window can legitimately
be in compact, and a `max-width` rule would draw the bar with no room reserved for it.

Both bars minimise to a small floating puck — top-left for the bar, bottom-right for the
tabs — and the state is remembered. As with the old sidebar, the `(protected)` layout is a
server component and the minimise state is client-side, so they meet through
`<html data-appbar>` / `<html data-moduletabs>` attributes and `globals.css` padding
rules, with a pre-paint script in the root layout applying the stored values before first
paint. Without that script every page renders padded for both bars and then shoves on
mount.

The design exception went with it: the sidebar was the one surface allowed `Button`'s hard
offset shadow. The nav bars are quiet — a hairline border and a soft shadow. `design.md`
now says no surface takes the button treatment.

### [Changed] The layout switch moved to the top bar

`ViewportSwitch` — compact/full — is now in the top bar, because it's the one control that
drives the whole UI's layout and belongs where it's always reachable. Choosing **pins** the
layout so `ViewportCorrector` stops second-guessing it; right-click unpins.

The Account page **lost its copy of the control** and now only describes the current state
("currently the compact layout, pinned by you"). Two controls for one setting only invite
them to disagree.

### [Added] Every chart carries its own display controls

A gear in the corner of each chart opens `ChartToolbar`: value labels, point markers,
legend, gridlines. Pass `displayStorageKey` and the reader's choices outlive the page.

The four options are declared **once**, as `ChartDisplayDefaults` in
`src/lib/shared/chart-options.ts`, and each chart's props interface `extends` it — so one
option means one thing on a line, an area and a bar, and the typechecker enforces the
vocabulary rather than letting a `showValues` alias appear on one chart and a `labelPoints`
on another.

**`pointLabels` is a mode, not a boolean.** The dataviz rule is *label selectively — never
a number on every point*, so `"all"` is honoured only up to a cap (12 by default, **4**
below 1024px) and past it draws the high and low instead, with the toolbar *saying* it
downgraded rather than appearing to ignore the choice. Four rather than six on a phone was
measured, not guessed: at six across 390px, `$40.33` and `$44.10` ran together.

Which points get labelled is decided in the lib (`selectLabeledIndexes`), not in the
components, with 24 tests. It **skips gaps rather than reading a missing value as `0`** —
the account series are sparse, and labelling a gap `$0.00` would state a balance that was
never recorded. "Latest" therefore means the last real number, not the last index.

Each chart in the app was given a starting mode chosen for what its reader is actually
looking for: `"last"` for balance and account histories (latest value at each line's end —
not every point, since the series are overlaid and labels would land on a neighbouring
line), `"extremes"` for the returns series (the best and worst day), `"all"` for bars.

`ChartBar` is exempt from the cap — a bar has a free end to print on and there are only
ever a handful — and its toolbar offers only None / Every bar, since "latest" and "high &
low" are time-series ideas and categories have no order. It also gained a tooltip, which
it went without.

### [Changed] Chart-builder presets no longer store display options

`showDots` used to be saved into a preset's `optionsJson`. Display options are the
*reader's*, not the preset's, so they moved to the gear control and persist per-chart in
`localStorage` instead. An older preset that still carries `showDots` is ignored rather
than being an error.

### [Added] `Button` accepts `title`, `ariaLabel`, `ariaExpanded`, `ariaControls`

Forced by the above: a bar of icon-only buttons and a gear that opens a panel had nothing
for a screen reader to read and no way to announce open/closed. `ariaLabel` is now
**required** when the children are only an icon or glyph.

### [Added] `ADMIN_MANUAL.md`

The day-to-day operator reference — deploy, restart, stop, switch builds — split out from
`INSTRUCTION_SETUP_SYNOLOGY.md`, which stays the first-time setup runbook and now links to
it. It documents the thing that catches people out: copying a build to the NAS does not
restart anything, so the old build keeps serving until `deploy.trigger` exists or the
process dies.

## 2026-08-07 23:23 — The app works on a phone, and installs to the home screen

**No migration in this release.**

Measured first. On an iPhone-sized viewport the sidebar took **240px of 390** — 62% of
the screen — and, being `fixed` above the content, it *swallowed taps* meant for the
page underneath; a Playwright click on a ticker failed with "aside subtree intercepts
pointer events". The Positions table was **1498px wide**, the Expense one 1027px. Two
pages scrolled sideways. That is what got fixed.

### [Added] One layout boundary, decided on the server

`src/lib/viewport` and `src/proxy.ts`. Everything below **1024px** gets the `compact`
layout, everything above gets `full`.

Named after the layout rather than the device on purpose: an iPad in portrait is 810px
and wants the compact one whatever it calls itself, and so does a half-width window on a
27" monitor. Calling it "phone" would make both read as bugs.

Three signals, strictly ordered — a layout **pinned** by the reader on the Account page,
then the **measured width**, then a **User-Agent guess**. The guess exists only because
the server has to render *something* before any JavaScript runs; `ViewportCorrector`
replaces it on mount. That matters more than it sounds: iPadOS Safari reports itself as
a Mac, and "Request Desktop Website" sends a desktop string from a phone. Verified all
three tiers in a browser, including that a pin survives navigation.

The layout is read from a cookie on the server, so the first paint is already right —
no desktop-then-phone flip after hydration.

### [Fixed] The sidebar and section trees no longer cover the page

Both now start at their rail below 1024px, taking the default from the viewport rather
than measuring, so server and client agree and there is no flash. A stored preference
still wins.

The section tree also **turns on its side** when it stacks: below `lg` the wrappers
stack, so a vertical rail was a 64px-wide column burning ~350px of height for eight
icons. It is now 262 × 50 and scrolls horizontally rather than wrapping — wrapping would
give the height straight back.

### [Added] `DataGridCompact` — one card per row

A 1498px table isn't a narrow table on a 390px screen, it's the wrong shape: a table's
premise is that columns line up across rows and there is room for them to. Each row is
now a card led by the column that identifies the record.

`DataGrid` **dispatches** to it, so no call site changed and every grid in the app got
it at once. That dispatch is a sibling component rather than an early return on purpose:
the full implementation calls fifteen-odd hooks, and returning before them would change
the hook count when the viewport flips — which it does, once, when the corrector
overrules the guess. React would throw.

It implements a deliberate subset — search, sort, row click — and caps at 50 cards with
a "Show more" button. The full grid paginates; without a cap a few thousand expense rows
would become a few thousand cards on exactly the hardware least able to absorb it.

### [Fixed] Two pages scrolled sideways

Neither was what it looked like. **Home** was the *Administration button* — icon, title
and button came to 447px in a row that couldn't wrap. **Admin → Modules** was the
section tree leaving the content area 64px, less than its own padding, plus a `flex-1`
grid without `min-w-0` shoving the reorder buttons 135px past the edge (a flex child
defaults to `min-width:auto` and refuses to shrink below its content).

Both now measure 390px on a 390px screen.

### [Added] Installable to the home screen

`src/app/manifest.ts`, served as `/manifest.webmanifest`. Dynamic rather than a static
file so the splash screen and status bar follow the **active colour theme** instead of
flashing a hardcoded one. Icons generated from `icon.svg`, including a separate
**maskable** variant — Android crops icons to its own shape and an `any` icon used as a
mask loses its edges.

Next emits the standardised `mobile-web-app-capable`, which **iOS only honours from
16.4**; the Apple-prefixed tag is set explicitly so older iOS still launches full screen
rather than inside Safari chrome.

Installing needs HTTPS, which the Synology reverse proxy already provides.

### [Changed] Every UI change now has to answer for both widths

The rule is in `CLAUDE.md` (loaded every session), the detail is in `design.md`, and
`components.md` requires a new component to state its narrow behaviour — that file is
already mandatory reading before building any UI.

The convention is `max-lg:` variants rather than `lg:`. Restyling that way leaves every
desktop class untouched, which makes "I didn't break the wide layout" **provable** rather
than hopeful. Proven here: identical geometry on all four sampled routes at 1440px,
before and after.

### [Added] `REBUILD_PUBLISH_NAS.bat`

Build and mirror to the NAS over SMB in one command, with `data\`, `.env`, `start.sh`,
`app.log` and `app.pid` excluded — `robocopy /MIR` never deletes what it is told to
skip, so the live database, the secrets and the boot script survive every republish.
Tested against a seeded destination: all five preserved, a stale file purged.

`REBUILD_PUBLISH_ARM.bat` and `START_PRD_SYN.bat` are gone, along with the line in
`REBUILD_PUBLISH.bat` that copied the latter into staging.

`/release_myhomebase` now covers both deployment targets rather than assuming Windows.

## 2026-08-06 23:54 — Ticker viewer rebuilt as cards, a home carousel, and two silent Yahoo bugs

**Two migrations in this release**, both already applied to production:
`0039_create_ticker_risk_cache` and `0040_add_carousel_image_to_modules`.

### [Changed] The ticker dialog is three tabs of cards, not nested tabs

Every tab used to hold a second tab strip. Sub-tabs hid sections a reader wanted side
by side — holdings against the trade history, the chart against the quote — and gave no
clue which ones had anything in them. Each tab is now a stack of `CollapsibleCard`s:
**Our data** (Holdings / Transactions / Watchlist & income), **Market** (Quote / Price
History / Events / Risks / News), and a new **Yahoo Finance Detail**.

Loading moved with it: it's per *tab*, not per card, so scrolling never meets a card
that hasn't started. One consequence worth knowing — the trade-timeline chart now loads
on dialog open rather than on a tab click, since it lives on the default tab. Nothing
blocks on it, but it is one provider round-trip per open that wasn't paid before.

### [Added] Events — what actually moved the price

Dividends, splits and reported quarters over the trailing year, newest first, each with
the close it happened against and a beat/miss verdict against the estimate. A row
expands in place to the full record. An event dated to a closed market takes the last
close before it, and says so, so every price shown is a real print.

### [Changed] Risk is cached, and only Recalculate refreshes it

`getTickerRisk` made **two** provider round-trips every single time the panel was shown
— a year of the ticker's closes plus a year of the benchmark's — and kept nothing.
Reopening the same ticker three times in a morning paid for it three times.

Now stored in `stk_ticker_risk_cache` (0039) and served **at any age**. Nothing expires
it; the only thing that refetches is the **Recalculate** button in the card header. That
was a deliberate choice over a TTL — provider traffic is fully predictable — and the
cost is that the card must state its age, so it prints `Calculated <date>` and turns
amber past a week. A failed recalculation keeps the stored row rather than blanking a
readable answer.

Deliberately **not** `stk_stock_volatility_cache`, which looks like the same thing: that
table is cleared wholesale by the analytics dashboard, so a per-ticker write there would
vanish on the next refresh.

### [Added] Yahoo Finance Detail — six sections, one request

Market Data, Company Profile, Analysis recommendations, Valuation & Trading, Financials
and Key statistics. `quoteSummary` takes a module list, so all six cost a single
round-trip. Coverage varies enormously by symbol, so each section renders only the
fields that came back and says "the provider reports no …" for a whole missing module
rather than drawing a grid of dashes — checked against an ETF, which has no company and
no income statement.

### [Fixed] Two silent bugs in the Yahoo client

Found while building Events, which came back with **no earnings at all**. Both failed
quietly because the earnings leg is `.catch(() => [])`:

- **No `User-Agent`.** Yahoo's crumb endpoint answers **429** to Node's default agent
  string. No crumb means the v10 `quoteSummary` endpoints 401.
- **A race on the crumb refresh.** Opening the dialog fires several use-cases at once,
  two of which reach `quoteSummary`. Both found no crumb, both refreshed, and the second
  overwrote the cookie the first was mid-flight with — Yahoo pairs the two, so both
  401'd. This is why earnings worked when probed alone and vanished whenever anything
  ran alongside. `refreshCrumb` is now single-flight.

The dividend-rate fallback was silently returning 0 for the same reason. Covered by the
module's first adapter-level tests, against a stubbed `fetch`.

### [Added] The dialog is a floating window

`Modal` gained `size="window"`: 80% of the viewport, draggable by its header, with a
maximize button that swaps to the old full-bleed treatment and back. Still a modal —
overlay, Escape, focus trap and scroll lock unchanged. The drag is clamped so the header
can never leave the screen, since it is the only handle.

### [Added] The section tree hides to a strip

`TreeNav` now has the same three states as `Sidebar`: `full` (icon + label) → `rail`
(icons) → `strip` (an accent edge you click to bring it back), with the same two
controls. Its stored value used to be a boolean, so the reader maps the legacy value
rather than springing every collapsed tree open on first load.

### [Changed] The home screen is a carousel

The grid of `ModuleCard`s is gone, replaced by a coverflow: the selected module's
graphic large and centred, neighbours scaled down either side, **title above the image
and description below**, and the centred graphic as the launch target. It rotates by
arrow, keyboard, dot, neighbour click or swipe, and wraps. It does not auto-advance.

`ModuleCard` was deleted with its last caller.

### [Added] Modules can carry their own artwork

`sys_modules.carousel_image` (0040), uploaded per module at Admin → Configuration →
Modules, falling back to the icon glyph when unset.

**This table is read on every authenticated page** — `listModules` in the protected
layout, `getModuleBySlug` on every module route — and both were `SELECT *`. A BLOB there
would have loaded a multi-megabyte image into every page render in the app for a value
no page uses. Both now name their columns, and presence is derived in SQL
(`carousel_image IS NOT NULL AS has_carousel_image`) so a boolean crosses the boundary
and the bytes have exactly one reader: the serving route.

### [Fixed] Image uploads: send a File, not a base64 argument

The existing image uploads pass base64 as a server-action argument. That works for a
128 KB icon and breaks for anything larger, in two ways that both surfaced as framework
errors rather than validation messages: base64 inflates a file ~33% against Next's 1 MB
body limit (an **800 KB** image already failed), and Next rejects long string arguments
outright with *"Maximum array nesting exceeded"* — raising the body limit doesn't help.

The module upload puts the `File` in `FormData`, which streams as ordinary multipart
with neither problem. `bodySizeLimit` is now 4 MB, and the size is checked client-side
so an oversized file is refused instantly in the app's own words. Written up in
`coding-guide.md`, since the four earlier uploads will hit the same wall.

### [Fixed] A stale `.next` could fail the build

`npm run build` inherited dev artifacts: `tsconfig.json` typechecks
`.next/dev/types/**`, and those generated route types outlive a deleted page — so a
build failed importing `admin/history/page.js`, a route removed in this same release.
`build` and `verify` both clear `.next` first now, and `verify` does it *before* the
typecheck rather than before the browser sweep, where the same artifact could fail
stage one.

### [Fixed] CSV import can no longer claim columns a file doesn't have

A mapping is stored as *column index → field* with no record of the file it was built
against. Applied to a narrower export, out-of-range entries were invisible — the mapping
table only draws a control per column that exists — but still applied and still saved.
That is how a 70-column mapping quietly rewrote a 16-column import.
`restrictMappingToColumns` drops them, and `findDuplicateFieldMappings` catches two
columns feeding one field, which fails in the worst way: `mapRow` writes in ascending
column order, so the higher index silently wins and the reader sees a plausible number
from the wrong column.

### [Changed] Change History moved into About

`/admin/history` is gone; **About** now reads and renders `CHANGE_HISTORY.md` itself, so
there is one page about the application rather than two. The file read moved behind a
`src/lib/change-history` repository rather than sitting in the page.

### [Added] The app runs on a Synology NAS

`npm run publish:nas` builds a copy-only deployment package, and
`INSTRUCTION_SETUP_SYNOLOGY.md` is the runbook — DSM certificate and reverse proxy, SSH
user, data move, boot/keepalive tasks, and the six failures the first install actually
hit.

Everything is built on Windows because the target is a DS223: 2 GB of RAM, a quad
Cortex-A55, already swapping at idle. `next build` there would thrash and be OOM-killed.
That works because the app has exactly **one** native module that matters —
`better-sqlite3`, whose arm64 binary is a published prebuild, so it is downloaded rather
than compiled. (`sharp` is in the tree but never loads: nothing imports `next/image`,
and it isn't even a declared dependency.) The migration runner is bundled to plain CJS
so the NAS needs no `tsx`, which would have dragged in esbuild's own platform binary.

Two things the script has to do that aren't obvious. Turbopack rewrites
`require("better-sqlite3")` to a hash-suffixed name and satisfies it with a **symlink to
an absolute Windows path** — dead the moment the folder leaves the machine, and the
cause of a `Cannot find module 'better-sqlite3-<hash>'` crash on first boot. And the
driver exists in **two** places in the tree, both needing the arm64 swap. The script
materialises every symlink, patches every copy, verifies each is an AArch64 ELF, and
refuses to finish otherwise.

**HTTPS is a prerequisite, not a nicety.** The session cookie is `Secure` in production,
and browsers reject those from a non-trustworthy origin — so over `http://<lan-ip>` you
log in, land on the home page, and bounce back to the login screen on the first tap.
Measured both ways before writing any of it down.

### [Fixed] The build was shipping a database and a .env

`.next/standalone` contains `data/myhomebase.db` and `.env` after every build. Next
traces them because the build opens the database while collecting page data, and
`outputFileTracingExcludes` does **not** stop it — verified on Next 16.2, with and
without a leading `**/` on the patterns.

The size is not the problem. `wiring.ts` falls back to `./data/myhomebase.db` when
`MYHOMEBASE_DB` is unset, so a shipped database means a misconfigured deploy silently
serves stale data instead of failing loudly. `publish:nas` deletes both from the
assembled output; the note in `next.config.ts` now says the exclusion doesn't work
rather than implying it does.

## 2026-08-05 23:39 — Sidebar strip, remembered account matching, and three new views

Five separate pieces. **No migration in this release** — the one schema-shaped change
needed none, for the reason below.

### [Added] The sidebar hides to its accent strip

A third state. `full` (labels) → `rail` (icons) → **`strip`**, where the slab is gone
and only its 12px accent edge is left; clicking the edge brings the rail back. The
chevron still moves between full and rail; a new `«` button hides. Two controls
rather than one cycling three, because a single control can only go one way and
overshooting would mean going all the way round.

**The page actually reclaims the space** — 96px of reserved gutter down to 40px. That
needed a seam: `(protected)/layout.tsx` is a *server* component and the state is
client-side `localStorage`, so `Sidebar` mirrors it onto `<html data-sidebar>` and
rules in `globals.css` read it. No context provider, and the shell stays a server
component.

A script in the root layout applies the stored state **before first paint**; without
it every page loads at the full gutter and shoves sideways when the mount effect
runs. That script mutates `<html>`, which is why the root layout now sets
`suppressHydrationWarning` on it — caught by running the app, not by typecheck.

In `strip` the slab isn't rendered at all, merely narrowed to zero: a hidden sidebar
you can still Tab into is worse than no sidebar.

### [Added] CSV import remembers which account a label means

The account-matching dialog already existed; what was missing was memory. A saved
mapping now stores it, so `Fidelity HSA` → *Fidelity Health Savings Account* is
answered once per broker instead of every import.

**No migration needed.** `csv_named_mappings.column_mapping_json` is a widening
envelope that had already grown once without one — `{columns}` → `{columns, options}`
→ `{columns, options, accounts}`. Every key is read defensively, so mappings saved
under either earlier shape still load. That codec moved from the repository into
`mapping.ts` purely so the backward-compatibility guarantee is unit-testable; losing
someone's saved broker mappings silently is the failure mode that matters.

Each match stores **both the account id and its name at the time**, because each
survives a different edit: renaming the account keeps the id valid, deleting and
recreating it keeps the name valid. Resolving neither way drops the entry and the
label is treated as unrecognised — never attached to the wrong account.

**The match step now always shows.** An earlier revision auto-imported when every
label was already known; that was wrong for financial data. Every name is listed with
a badge saying where its selection came from — **Remembered**, **Guessed**, **Your
choice**, **Skipped** — and a count of how many names are set to skip, since skipping
silently drops rows. Worth knowing: `Fidelity HSA` does **not** guess to *Fidelity
Health Savings Account*; HSA is an initialism, not a substring. That is exactly the
case remembering exists for, and an honest "Skipped" beats a confident wrong guess.

### [Added] Account Performance Over Time

A new card in Account Performance: every account's recorded value on one set of axes,
with a chip per account that drops its line. The table and the **Total recorded**
column follow the same selection, so what you read matches what you see.

Accounts are recorded on their own schedules, so the axis is the union of every date
anyone reported and an account has **no entry** on a date it didn't — not a zero, not
a carried-forward value. The chart joins across the gap, which is a visible
interpolation; the data underneath stays honest. A blank table cell means "not
recorded", and the total only sums accounts that reported that date. Toggling a line
off surfaced the corollary: rows where no *visible* account reported now read `—`
rather than `$0.00`, which would assert an empty portfolio.

Colour comes from each account's **stable** index, not its position in the filtered
array — otherwise hiding one line recolours the rest and the chips stop meaning
anything.

**Smooth the line** is off by default. A curve through quarterly balances looks like
it knows what happened in between.

`ChartLine` gained `connectNulls`, `curve` and `showLegend` to support this, all
defaulting to the previous behaviour so no existing chart changed.

### [Changed] Daily Glance: one table instead of three tiles

Stock, ETF and Other are now rows in a single table — Value, Today, % — with the
portfolio **Total** row that was already computed and simply wasn't shown. Reading
the same measurement down a column is the point; tiles made you scan sideways.

Also fixed: `gainClass` treated `0` as a gain, so an empty bucket rendered `+$0.00`
in gain-green. Zero is now neutral.

### [Changed] Positions: split by instrument type

Three tabs with counts — `Stocks` / `ETF` / `Others`. The split reuses
`snapshotBucketFor`, the same function behind the Daily Glance table and the daily
value history, so the tabs can't drift on what counts as "Other".

The **Type** column is dropped from Stocks and ETF where the tab already says it, but
**kept on Others**, which collapses Bond, MutualFund, Crypto and Other into one list
— there it's the only thing telling them apart. That gives Others a genuinely
different column set, so it keeps its own `storageKey`; sharing one across differing
sets is how a column reappears in the wrong tab. Column footers total per tab.

## 2026-08-05 11:40 — Ticker viewer, trade-performance chart, brokerage firm on trades, and a verification gate

Four separate bodies of work, released together.

**Migration 0038 is in this release and has already been applied to production.**
It adds two columns to `stk_stock_transactions` and replaces that table's unique
index.

### [Added] The ticker viewer — everything about one symbol, in one dialog

Clicking a ticker anywhere in the module — Positions, Transactions, a watch list, a
Daily Glance mover, or any of the three Chart & Analysis grids — opens a full-screen
dialog with seven tabs in two groups.

**The grouping is the feature.** *Our data* (Holdings / Transactions / Watchlist &
income) is what MyHomeBase recorded; *Market* (Quote / Price history / Risk / News) is
what the provider returned. A reader should never have to guess whether a number came
from their broker export or from Yahoo, and the new `src/lib/ticker-overview` module
enforces that split in code: `getTickerOwnData` never touches the network, and the
market use-cases never touch the database.

- **Cost:** one database read when the dialog opens. Each market panel is a provider
  round-trip paid for only when that tab is first opened, then kept while the dialog
  is up. Switching the price-history range refetches without blanking the chart.
- **A watched-but-never-held symbol opens too** — the holding figures read as empty
  rather than zero, which is the honest answer rather than a missing one.
- Reachable from the CLI as well: `npm run cli ticker-overview -- AAPL [--market]`.

### [Added] My past performance — trades against the market around them

Inside the Transactions tab, every trade is plotted against the provider's closing
price on the trading day **either side** of it, ending at the latest close. A trade
price on its own says nothing about whether it was a good fill; the bracket closes are
what make the chart worth reading.

- **"Day before" means the previous *trading* day.** A Monday purchase is bracketed by
  the previous Friday and the Tuesday. Weekends and holidays are skipped rather than
  assumed away.
- **Dividends, splits and reported quarters are marked on the same line** as a second
  series, and spelled out in the table's Note column beside whatever you typed against
  the trade. An earnings chip shows reported EPS against the estimate — green for a
  beat, red for a miss.
- An event dated to a day the market was shut is shown against the last close on or
  before it, so **every row's price is a real print**. Events falling outside the
  fetched history are counted under the table rather than plotted at a guessed price.
- A per-row **News** button opens that day's stories. Expect it to be empty on older
  rows — the provider's search only indexes recent coverage — and the panel says so
  rather than leaving an empty cell to read as "quiet day". Events have no such limit,
  which is exactly why they were added.
- One history call, one news call and one events call, however many trades there are.
  Both extras fail independently; neither loses you the chart.

### [Fixed] Migration 0038 — brokerage firm, broker reference, and honest duplicate detection

Adds `brokerage_firm` and `external_id` to `stk_stock_transactions`, both
`TEXT NOT NULL DEFAULT ''`.

**The old unique index was losing data.** It spanned
`(transaction_at, action, ticker, total_amount_cents)`, and `transaction_at` is a
*date*. Two buys of the same ticker for the same amount on the same day were identical
on all four columns, so the second was rejected as a duplicate — silently dropping
every lot after the first. Buying a position in several lots through a day is
completely ordinary.

Appending `brokerage_firm` (the original plan) would not have helped: both lots are at
the same firm. No column fixes it, because at date granularity the rows really are
identical. So uniqueness now applies only where the broker gave a reference to be
unique on (`UNIQUE (external_id) WHERE external_id <> ''`), and duplicate detection for
everything else moved into the importer, which counts how many matching rows the file
holds against how many are stored and inserts the shortfall.

**What this gives up:** adding the same transaction twice by hand now succeeds. That's
intended — the app can't know whether you meant it. Production held 0 transaction rows,
so nothing was back-filled. Generalised into `coding-guide.md` as a rule: never put a
DATE column in a unique index.

### [Added] A verification gate

`npm run verify` (or `/verify`) runs every quality gate in order, cheapest first:
typecheck → lint + library boundary → unit tests → migration dry-run against a *copy*
of the dev DB → a Playwright sweep of every route on a fresh dev server with `.next`
cleared.

- **No gate touches the real database.** Copies live in `.verify/`, and the copy step
  aborts if `MYHOMEBASE_DB` is unset or points inside the repo's `data/` folder.
- `check:lib-boundary` is now `scripts/check-lib-boundary.mjs` rather than a bare
  `grep`, which missed `import "react"` and couldn't name the offending file.
- A UI change that "isn't taking effect" is a stale `.next` cache until proven
  otherwise — the gate clears it rather than leaving it to memory.

### [Added] Stocks dashboard widgets

New `src/lib/stock-dashboard` module: which cards appear on the module's dashboard and
in what order, as a persisted per-user preference, configured under Configuration →
Dashboard widgets.

### Also in this release

- [Added] **`Modal` gained `size="full"`** — edge to edge, no gutter, no rounding, for a dialog
  that is a screen in its own right. Escape, the ✕, the focus trap and the body-scroll
  lock all behave identically, so it returns you to what's underneath.
- [Added] **A second `market-data` port, `MarketEventsClient`**, for dividends/splits/earnings,
  rather than a third method on `MarketDataClient` — prices and events are fetched
  independently, and folding it in would force every existing fake to implement a
  method it never calls. `YahooFinanceClient` implements both, and the crumb/cookie
  dance was factored out so the earnings call reuses it.
- [Fixed] `ChartXY` no longer resets its zoom window in an effect, which was committing one
  frame of the old window against new data.
- [Changed] `MARKET_BENCHMARK_TICKER` is exported from `stock-analytics`, so the viewer's
  per-ticker correlation measures against the same SPY the portfolio matrix does
  instead of duplicating the constant.

## 2026-08-05 00:05 — Stocks & ETFs: section tree, cost basis, daily snapshots, per-ticker news, rebuilt CSV import

The largest change to this module since it was ported. Three migrations, and the
module's single scrolling page becomes eight routed sections.

**Migrations in this release — 0035, 0036 and 0037 must be applied before the app
is served**, or the affected screens fail with "no such column".

### [Added] Migration 0035 — cost basis, identifiers, and an owning account on positions

`stk_stock_positions` is rebuilt (not `ALTER`ed): its primary key moves from
`ticker` to **`(account_id, ticker)`**, and ten columns are added.

- **Why the key changed.** `ticker` alone meant one row per symbol for the whole
  app, so importing a second broker's export silently overwrote the first instead
  of adding to it. Now "75 MSFT at Chase" and "69 MSFT at Fidelity" are two rows
  that sum. `account_id = 0` is a real, supported value meaning **Unassigned** —
  which is the state the production DB was in (4 positions, 0 accounts), so nothing
  had to be invented for existing rows.
- **New columns:** `cost_cents`, `unit_cost_cents`,
  `unrealized_gain_loss_cents`, `unrealized_gain_loss_pct`, `cusip`, `isin`,
  `asset_class`, `asset_strategy`, `est_annual_income_cents`,
  `income_earned_cents`.
- The module previously had **no cost-basis field at all**, so it could only ever
  show a day's change and never a total return. That was the gap this started from.
- `unrealized_gain_loss_pct` is stored rather than derived: a broker's own figure
  accounts for adjusted basis (wash sales, corporate actions) that
  `unrealized / cost` on stored cents can't reproduce.
- `asset_strategy` ("US Large Cap") is deliberately **not** folded into `type`
  (Stock/ETF/Bond). `type` drives the allocation split; strategy is the broker's
  cap-size bucket. Different questions, different columns.
- A rebuild forced the trigger to be dropped *before* the table and recreated
  against the compound key, and added `idx_stock_positions_ticker` — with
  `account_id` leading the primary key, "who holds NVDA" no longer has a usable key
  prefix.

### [Added] Migration 0036 — daily portfolio snapshots

New `stk_daily_snapshots`, one row per calendar day, `snapshot_date` as the primary
key so a capture **upserts**: pressing Refresh All twice in a day recalculates that
day rather than appending.

- Stores **both value and gain/loss**, per bucket (stock / ETF / other / total),
  because neither derives correctly from the other. Differencing two days' values
  isn't performance — pay $10k in on Wednesday and the diff reads as a $10k gain.
  Day gain/loss (price move × shares held that day) excludes contributions, but
  can't be reconstructed from stored values for that same reason.
- `other_*` is stored so the parts sum to the total; the portfolio holds a
  money-market sweep line, and stock + ETF alone wouldn't add up.
- **No back-fill and no gap-filling.** History starts at the first Refresh All —
  the app stores each position's *current* price, not a per-day series for whatever
  was held back then — and a day with no capture has no row. The period rollups
  report the day count they actually had rather than inventing a flat day.

### [Added] Migration 0037 — an icon per investment account

`stk_investment_accounts` gains `icon_image` (BLOB) + `icon_image_mime_type`,
following `sys_users.avatar` (0011), `exp_creditcard_accounts.card_image` (0031)
and `exp_categories.icon_image` (0034).

- Bytes are served by `/api/stocks/accounts/[id]/icon`, never inlined as a base64
  data URL. **`listAccounts` / `getAccountById` were switched from `SELECT *` to a
  named column list** in the same change — otherwise the icon bytes would ride
  along in every account list, positions page and CSV-import render.
- 128 KB cap, PNG/JPEG/WebP/GIF only. **SVG is excluded**: it can carry script and
  these bytes are served from the app's own origin.

### [Changed] The module is now eight routed sections

`TreeNav` down the left, exactly like Expense — each section a real route, so it's
bookmarkable and highlights on `pathname`:

Dashboard · Positions · Transactions · Account Performance · Actionables ·
Chart & Analysis · CSV Import · Configuration

- New `stock-sections.ts` (a **plain** module, not `"use client"`, so server
  components read the labels as real values rather than client-reference proxies),
  `stock-nav.tsx`, `stock-section.tsx`, and `stock-instructions.tsx` with per-section
  guidance.
- `[section]/page.tsx` was hardcoded to Expense; it now dispatches per module, and
  each validates **its own** section names so an Expense section can't be reached
  under the Stocks slug.
- Data is loaded **per section**, so opening the dashboard no longer reads every
  watch list and analytics cache the way the old single page did.
- **Actionables** holds the watch lists and the next-day scan. **Configuration** got
  real content: the three scan thresholds are now editable in-module, writing the
  same module settings Administration → Module Configuration writes.

### [Added] Dashboard: Portfolio Summary, Daily Glance, and Refresh All

- **Refresh All** walks positions one at a time *from the client*, showing a live
  line per ticker ("NVDA — today's price is $220.15") and a progress bar. A single
  server action returns once and so can't report progress; the upstream quote fetch
  dominates either way, so this costs nothing but buys the running commentary. A
  ticker that can't be priced goes red and the loop continues. When it finishes it
  captures the day's snapshot.
- **Portfolio Summary** card — total value, today's move, the value-over-time line
  chart (total / stock / ETF), and the full snapshot history as a `DataGrid`. Its
  Day G/L column footer sums over the *filtered* set, so filtering the date column
  to one month turns the footer into that month's P&L.
- **Daily Glance** card — Stock and ETF gain/loss with percentages, then Top 5
  gainers and losers with stocks and ETFs ranked **together** and a ticker held in
  two accounts counted once. A **Measure by Total value / Per share** selector
  switches both lists: a thousand shares up a penny beats two shares up $200 on
  total value and loses badly per share. The percentage is identical under both.
- **Week / month / year to date** tiles **sum each day's move** rather than
  differencing endpoint values, for the contribution reason above. Each shows its
  day count, so a day you never captured is visible rather than silently
  under-reported.
- Headline numbers come from the live positions, not the newest snapshot, so the
  card is right even before today's Refresh All.
- Numbers that aren't known read **"—", not 0** — a position with no imported cost
  basis has a value but no return, and the dashboard says so rather than printing a
  fake 0.00%.

### [Added] Per-ticker news

New `src/lib/ticker-news/`, over Yahoo Finance's unauthenticated search endpoint
(same host as the existing quote client, no API key).

- A **News** button on each mover row fetches the story most likely to explain the
  move. Fetched on click, not prefetched: prefetching meant ten upstream calls per
  page load for stories nobody opened.
- Providers tag stories loosely — a piece headlined "AMD Stock Tumbles" comes back
  tagged `["AMD", "SPCX", "NVDA"]`, and served raw that becomes NVDA's explanation
  for the day. `pickTopStory` prefers today's stories, then ones the ticker *leads*
  or is named in the headline, then newest. When the ticker is only a passing
  mention, or nothing was published today, **the UI says so** instead of implying
  the headline explains this morning.
- Word-boundary matching, so Cloudflare (`NET`) isn't matched by "NETWORK".
- Tickers are validated against `^[A-Za-z0-9.\-^]+$` before reaching the provider
  URL.

### [Changed] CSV import, rebuilt

One screen with a type selector (Positions / Transactions / Account Performance)
replacing three stacked panels. `ImportType` already had all three values, so no
enum change was needed.

- The mapping table is now the shared **`CsvMappingTable`** component; the Expense
  statement importer was refactored onto it.
- **Every row is listed, numbered and in file order** — not the 10 random samples
  the preview showed before — and each row has a **×** to leave it out. Removed
  rows stay visible, dimmed and struck through, so the numbering keeps matching the
  file. `CsvPreview` gained `rows` for this.
- **Per-row Type dropdown** on a positions import, in an importer-owned column
  before the file's own. It starts on what the file implies and you correct the
  rows that are wrong — the answer for an export that mixes ETFs and stocks without
  saying which is which. **Set all…** in its header stamps every row at once.
- **`= fixed value`** box under each mapped column: type a literal and every row
  gets it, ignoring the cells. Map any spare column to Type, type `ETF`, and the
  file imports as ETFs. Saved with the named mapping, so next quarter's export is
  one dropdown away.
- Precedence is three deep, least to most specific: **cell → column-wide fixed
  value → per-row override**.
- **Save-as-new *and* update-selected** (the old stock importer could only create).
- The **date-format box now actually works** — `importTransactionsFromCsv` honours
  it, so `03/04/2026` is read strictly rather than guessed. It was decorative
  before.
- New `restrictMapping`: auto-mapping guesses from header text without knowing the
  import type, so a positions file's "Value" column came back aimed at a
  performance-only field. Now filtered per type.
- Chase header aliases added — the sample export auto-maps 14 columns on drop.
- **Excluded rows are dropped, not reported as skips.** A skip is something that
  surprised the importer; a row you removed deliberately isn't. The count is
  reported separately. The shared `selectImportRows` helper preserves each surviving
  row's **original** number — filtering and re-indexing would have reported a
  failure on the file's row 4 as "row 2".

### [Changed] Refactors this pulled in

- **`src/lib/shared/image-upload.ts`** — `decodeImageUpload` and the mime allowlist
  were private to `lib/expense`; the account icon made them a second caller.
  Promoted with tests, and Expense re-exports the old names so its surface is
  unchanged. The allowlist is a security boundary (no SVG), and two copies were one
  edit away from drifting. The cap is checked against *decoded* length, not the
  base64 string, which is ~33% longer.
- **`src/lib/shared/date.ts`** — `todayIsoLocal` was defined inline in a page file.
  Now shared with `startOfWeekIso` / `startOfMonthIso` / `startOfYearIso` and 15
  tests. The one that matters: at 23:30 local, `toISOString()` files an evening
  snapshot under *tomorrow*.
- **`POSITION_TYPES` moved into the lib**, derived from `positionTypeSchema.options`
  rather than hand-written, so a new instrument type can't exist in the schema and
  be missing from a picker.
- **`resolvePositionType`** extracted from the importer so the per-row Type dropdown
  shows what will actually be stored; duplicating the rules in the view would have
  drifted.
- `importPositionsFromCsv` takes an **options object** — it was heading for seven
  positional parameters, and `import(repo, csv, m, 0, {}, [1], {})` told a reader
  nothing.

### Behaviour worth knowing

- **Refresh All replaces `value_cents`.** It's always `currentPriceCents ×
  quantity`, recomputed server-side and never accepted from a caller. Also replaced:
  price, day range, day gain/loss, dividend rate, and `name` when the quote supplies
  a `shortName`. **Untouched:** quantity, cost basis, unit cost, CUSIP/ISIN, asset
  class/strategy, income. Anything a quote feed legitimately knows is replaced;
  anything only you or your broker knows survives.
- The unrealized gain **is** recomputed against the stored basis on refresh, so a
  fresh price can't sit next to a stale gain figure.
- `dividend_rate_cents` is overwritten from the quote, which is often 0 even for a
  payer. This doesn't affect the dashboard's Annual Income, which prefers the
  broker's `est_annual_income_cents`.
- Footnote blocks a broker appends after the data (`FOOTNOTES`, `W,"…wash sale…"`)
  are dropped by `parseCsv`'s "fewer than half the header's fields" rule. That
  threshold scales with the header, so it handles a wide export like Chase's 71
  columns but would not detect footnotes on a narrow file.

### Known issues in this release

- `src/lib/stock-positions/stock-positions.ts` carries more formatting churn than
  its logic changes warrant: `prettier` was run on it to fix indentation after a
  scripted edit, and the repo has **no checked-in prettier config**, so it
  reformatted at the default 80 columns. It was re-run at 100 to match the codebase
  (siblings run to ~110), and the code is unchanged in behaviour — but the diff is
  noisy. **The repo should get a `.prettierrc`.**
- Three pre-existing lint errors remain, all `react-hooks/set-state-in-effect` in
  `csv-analytics-view.tsx` and `chart-xy.tsx` — untouched by this work, and two
  fewer than before it.
- The CSV-import account picker is a native `<select>` and so can't show an account
  icon; that would mean swapping it for `IconSelect`.
- News results are not cached, so pressing News twice re-fetches.

Verification: 736 tests pass, typecheck clean. All three migrations were applied to
a **copy** of the production DB and checked before being run for real — row counts
preserved, compound key and trigger working, the same ticker coexisting across two
accounts, `integrity_check` ok.

## 2026-08-03 23:18 — Full-width layout, floating sidebar, Expense spend stats + auto-import switch

No schema changes in this release — every DB-backed piece rides on existing tables.

### [Changed] Layout: one page width, and the sidebar floats over it

- **Every full-page screen now shares one container**, `PAGE_CONTAINER` in
  `src/app/(protected)/page-container.ts` (`mx-auto w-full max-w-[160rem]`).
  Screens used to pick their own cap — `max-w-3xl` for most modules, `4xl` for the
  admin forms, `6xl` for the wide ones, and a bespoke `EXPENSE_PAGE_CONTAINER` —
  which left most of a large display as empty margin either side of the content.
  All 12 screens under `(protected)` were converted; `containerClassFor` and
  `WIDE_LAYOUT_SLUGS` are gone. The 160rem cap deliberately sits past a 2560px
  monitor so it doesn't bind on one; it exists only to stop a table spanning a
  3440px ultrawide.
- **`Sidebar` is `fixed` and raised above the page** (`z-40`) instead of being a
  column in the flow, so the layout reserves only its *collapsed* width
  (`pl-24` = 4rem rail + 2rem gutter) and a module gets the rest of the screen.
  Expanding it overlays content rather than reflowing it.
  - `z-40` is chosen: above `DataGrid`'s sticky header (z-10), its resize handles
    (z-20), `IconSelect`'s dropdown (z-30) and Admin's floating save bar (z-20),
    but **below `Modal` (z-50)** so a dialog's overlay still covers it. Anything
    new that stacks has to respect that ceiling.
  - It carries `Button`'s hard offset shadow **rotated to point right** — a
    floor-to-ceiling slab has no bottom edge to cast from — plus a soft second
    shadow for the lift, and `rounded-r-2xl`. No press/translate mechanic: it
    isn't a button. This is a deliberate exception to "surfaces never take the
    offset-shadow treatment", now recorded in `design.md`.
  - Its `nav` scrolls independently, since a fixed viewport-height rail can no
    longer just make the page taller.
  - Collapsed, the header is only the toggle. The app glyph on its own did
    nothing — not a link, and it read as a duplicate of the Home icon below it.

### [Changed] Chevrons, and per-tree collapse state

- `TreeNav`'s panel toggle and `Sidebar`'s were `«`/`»`; both are now the same
  `&rsaquo;` chevron the node rows and `CollapsibleCard` already use, rotated 180°
  when expanded.
- **The Expense section tree is collapsible.** That needed a fix first:
  `TreeNav` persisted its collapsed state under one module-level constant, so a
  second collapsible tree would have shared state with Administration's —
  collapse one, the other collapses too. New `storageKey?` prop, defaulting to the
  old key so Admin's remembered state is untouched; Expense passes its own.
- The Expense nav wrapper lost its `lg:w-64`: a collapsible `TreeNav` owns its
  width (`w-64` → `w-16`), and a fixed width on the wrapper pins the rail open.

### [Added] Expense: "Interesting stats" on the dashboard

- New collapsible card showing **top 5 spenders by vendor** and **top 5 by
  category**, side by side. It replaces the standalone "Top categories" section,
  which was the same top-5 list.
- New `src/lib/expense/vendors.ts`. A statement line carries two names for the
  same shop — the tidied `vendor` post-import processing sets, and the raw
  `transaction_description` — and only some rows have the first, so grouping on
  `vendor` alone hides most of the spend. `vendorKeyFromDescription` derives a
  brand key from the description when `vendor` is blank: upper-cases, strips
  payment-processor prefixes (`SQ *`, `TST*`, `PAYPAL *`), cuts the per-order
  reference after a `*`, drops punctuation and store numbers, skips leading filler
  (`THE`), and takes the leading brand word — so `COSTCO WHSE #1017 SEATTLE WA`
  and `COSTCO GAS #1017` roll up as `COSTCO`, and `AMAZON.COM*2A34B5C6` as
  `AMAZON`. Vendor names are upper-cased for grouping, so a tidied `Costco` and
  derived `COSTCO` rows merge, and the tidied spelling wins as the label
  (`isDerived` records which you got).
- `vendorTotals` is pure (the dashboard already holds the rows, so it doesn't
  re-read the table); `totalsByVendor` is the repo-backed use-case. No new port
  method — the fuzzy match is text work, not SQL. 15 colocated tests.

### [Added] Expense: "Automatic importing csv from folder" switch

- A master switch for the background importer, stored as the module setting
  `csv_autoimport_enabled`. Off means the scheduler never imports, whatever the
  folder and interval say.
- **A missing row reads as on**, so an install already auto-importing keeps doing
  it after this deploys. It still needs a folder and interval, so a fresh install
  is off regardless.
- The two questions were conflated in one predicate and are now split:
  `isAutoImportConfigured` (folder + positive interval — what one pass needs, and
  the guard on `runAutoImport`) versus `isAutoImportEnabled` (configured **and**
  switched on — what the scheduler asks). Consequence: **"Run import now" still
  works with the switch off**, which is how you test a folder before arming the
  service.
- No `instrumentation.ts` logic change — the 60s heartbeat already gated on
  `isAutoImportEnabled`, and it re-reads settings every tick, so flipping the
  switch takes effect within a minute with no restart.

### [Added] Two CLI commands

- `npm run cli expense-top-spenders -- --limit 10` — the same two rollups the
  dashboard card shows, for eyeballing the vendor grouping against real data.
- `npm run cli explain-rule -- --id <n>` / `-- --description <text>` — why a
  post-import rule did or didn't fire: the description JSON-quoted (so invisible
  characters show), the current field values, the `processed` flag, every rule in
  evaluation order with match/no-match, which one wins, and per field either the
  assignment or the reason it was skipped. Calls the same `listRules` /
  `planRuleApplication` the real clean-up does, so its verdict is the run's.

### Known issues, unchanged by this release

- `npm run check:lib-boundary` fails on Windows for any tree: the script is
  `! grep -rE ...` and `!` isn't a cmd builtin. The check itself passes when the
  grep is run directly.
- 5 pre-existing lint errors in files this release doesn't touch:
  `csv-analytics-view.tsx` (2× `set-state-in-effect`), `csv-import-view.tsx`
  (2× unescaped `"`), `chart-xy.tsx` (1× `set-state-in-effect`).

## 2026-08-03 15:24 — Category icons, ticker logos, grid filters/aggregates, three more themes

Four independent pieces of work that were in the tree together at this checkpoint.

### [Added] Expense: category icons (migration 0034)

- Each category can carry a small uploaded image, shown wherever the category
  appears: the picker on the transaction form and the bulk-edit dialog, the
  Category column of the grid, the post-import rules (editor and list), the
  dashboard rollup and the charts totals.
- `exp_categories` gains `icon_image` (BLOB) + `icon_image_mime_type`, both
  nullable — "no icon" is a real state. Same pattern as
  `exp_creditcard_accounts.card_image` (0031) and `sys_users.avatar`: bytes are
  served by `/api/expense/categories/[name]/icon`, never inlined in a page
  payload, with `updatedAt` as a cache-buster.
- **`listCategories` / `getCategoryByName` changed from `SELECT *` to an explicit
  column list.** Without this, adding a BLOB to that table would drag every
  category's icon bytes into every page render.
- One upload schema now covers both images: `CARD_IMAGE_MIME_TYPES` →
  `EXPENSE_IMAGE_MIME_TYPES`, `cardImageSchema`/`CardImageInput` →
  `expenseImageUploadSchema`/`ExpenseImageUploadInput`, sharing a
  `decodeImageUpload` helper. Caps stay distinct: 512 KB for card art,
  **128 KB** for icons. Uploading to a category that doesn't exist is refused.
- The category list under Meta Data is now a row per category rather than chips —
  a chip had no room for the icon controls.

### [Added] New component: `IconSelect`

- A combobox whose options carry an image, because neither `<select>` nor
  `<datalist>` can render one — which is what the three category pickers needed.
  Keyboard-driven (arrows/Enter/Esc), closes on outside click, and by default
  typing still filters *and* commits, so naming a brand-new category on a
  transaction or a rule keeps auto-registering it. Registered in `components.md`.

### [Added] Stocks: ticker logos (migration 0033)

- `stk_ticker_logos` caches logo bytes in the DB; `/api/stocks/tickers/[ticker]/logo`
  downloads on first request and serves from cache afterwards. A "nothing found"
  result is cached too, so a symbol isn't re-requested on every render.
- New `TickerLogo` component (monogram fallback — a missing logo is the normal
  case for ETFs), used across the positions, transactions, watch list, analytics
  and next-day-actions grids.

### [Added] DataGrid: filter expressions, aggregates, and a shared `Modal`

- Column filters understand comparison and range expressions
  (`parseFilterExpression` in `src/lib/shared/table.ts`).
- Columns can declare an `aggregate` (`sum`/`avg`/`min`/`max`/`count`) with a
  footer total that follows the current filters — used for net spend in the
  Expense grid.
- Dialog markup extracted into a registered `Modal` component (overlay, Esc and
  focus handling) and adopted by the views that had hand-rolled it.

### [Added] Three more themes, three more icon sets

- Themes: **Sea Glass** (second light theme), **Midnight Slate**, **Copper Vault**.
- Icon sets: **Tabler**, **Material Symbols**, **MingCute**, with glyphs baked by
  `npm run gen:icons`.

## 2026-08-02 23:28 — Expense: automatic CSV import, post-import processing, tree-nav overhaul

### [Added] Automatic CSV import

- Two module settings (`csv_autoimport_path`, `csv_autoimport_interval_minutes`)
  and a background runner armed from `src/instrumentation.ts` at server startup.
- The runner ticks on a fixed 60-second heartbeat and re-reads the settings each
  time, importing only once the configured interval has elapsed — so changing the
  interval takes effect without a restart, and a slow import can't overlap the
  next one. Guarded against dev-mode hot reload arming it twice, and it never
  throws into the server.
- The watched folder holds **one sub-folder per card, named after it**
  (`/csv_import/Visa Gold/*.csv`), which selects both the account and its saved
  column mapping; files inside can be named anything. Processed files are renamed
  `<name>_<timestamp>.backup` (which also takes them out of the `*.csv` scan) and
  failures `<name>_<timestamp>.failed`, so nothing is retried forever. A CSV left
  loose at the top level is reported rather than silently ignored.
- File access sits behind a `CsvFolderPort`, so the whole flow is tested with an
  in-memory folder against a real in-memory SQLite built from the migrations.

### [Added] Post Import Processing (migration 0032)

- Transactions gain **`vendor`** (the tidy name) and **`processed`** (the
  clean-up queue, indexed).
- Rules go from *pattern → category* to **one condition → any number of field
  assignments**: `*TGI*` can set Vendor, Category, Status and Note at once.
  `exp_category_rules` is replaced by `exp_post_import_rules` +
  `exp_post_import_rule_actions`, with existing rules migrated across (ids
  preserved) rather than discarded.
- **"Manually Run Import Clean up"** with a real progress bar and log
  (`Processing 41 of 216 — rule "*TGI*" used, vendor set to "TGI Friday"…`). It
  runs in client-driven batches, because one long server action can't report
  progress; since `processed` *is* the queue, an interrupted run resumes.
  **Re-queue all** sweeps history after adding a rule.
- A rule only fills a field that's still blank (status: still `new`), so manual
  edits are never overwritten and re-running is safe. Rows nothing matched are
  still marked processed.

### [Changed] Interface overhaul

- The module is now a **`TreeNav` of six sections**, each a real bookmarkable
  route: Main (Dashboard), Transactions, Meta Data, Charts and Analysis, Import
  Transaction, Settings — each with a one-line description. Sections live under
  `[slug]/[section]` so a static `expense/` folder can't shadow `/modules/[slug]`.
- Data is loaded **per section**, so the dashboard no longer reads every
  transaction, rule and mapping. The 600-line `expense-view.tsx` is gone.
- New Charts and Analysis section (spend-by-category `ChartBar` + totals table),
  a **To processed** counter, and dashboard counters that link to the section
  where the work is. Page width widened to 120rem — the old 6xl cap left most of
  a large display as empty margin.
- Added `list`, `chart` and `upload` glyphs to `tree-icons.tsx`.

### [Fixed] Fix: client/server boundary crash

- Section constants were exported from the `"use client"` nav module and read by
  server components, which receive **client-reference proxies** rather than real
  values — so `EXPENSE_SECTION_INFO[section]` was `undefined` and `.label` threw
  during serialization. Moved to a plain `expense-sections.ts` that both sides
  import. Typecheck, lint and build all passed while this was broken; only
  running the app surfaced it.

### Also

- [Added] `START_PRD_SYN.bat` — a Synology/DSM production start script (bash, despite the
  name, for consistency with `START_PRD.bat`): finds node when Task Scheduler
  gives it a bare PATH, loads `.env` itself, binds `0.0.0.0`, checks the database
  path before starting, frees the port, and rotates its log. Both publish scripts
  now copy it into the deployment folder.

## 2026-08-02 09:19 — Expense tracker module; newsletter→quotes importer

### [Added] Expense — a new module

A credit-card expense tracker: record or import transactions, categorise them,
and let fuzzy vendor rules do most of the categorising.

- **Schema** (migrations `0029`, `0030`, `0031`): four `exp_` tables —
  `exp_transactions` (transaction/posting dates, account, raw description, one
  category, `amount_cents`, note, status, `created_by_user_id`),
  `exp_creditcard_accounts`, `exp_categories`, and `exp_category_rules` — plus
  the module's own row in `sys_modules` and a card image on each account.
  Charges are positive and refunds negative; money is INTEGER cents throughout.
- **Fuzzy auto-categorisation.** A rule matches the raw statement description
  with a case-insensitive glob (`AMAZON*` → `online-purchase`, optionally also
  setting a status). `*` is a wildcard, a pattern with no `*` matches anywhere,
  and every other character is literal — card descriptions are full of `*`, `#`
  and brackets, so patterns are never treated as regular expressions. Lowest
  `priority` wins. Rules only fill a **blank** category, so they never overwrite
  a manual choice and re-running them is safe; "Apply rules now" backfills
  existing rows.
- **CSV import**, plugged into the existing `csv-import` module as a new
  `Expense` type: save a column mapping per card company and pick it next time.
  Reads `$20.33`, `1,234.56`, `(45.00)` and trailing-minus amounts, supports a
  single amount column or separate debit/credit columns, offers a sign flip, and
  **skips rows already imported** (same card, date, description and amount),
  reporting them in the summary.
- **Card images.** A small BLOB per account (PNG/JPEG/WebP/GIF, ≤512 KB, SVG
  rejected as it can carry script), served by an auth-gated route exactly like
  user avatars. Account reads now list columns explicitly so the bytes never
  load with a list. The thumbnail identifies the card in the accounts list and
  the grid's Account column.
- **UI**: summary tiles, transactions grid with inline edit, spend-by-category,
  cards & categories, rules with a pattern help box and a "test this pattern"
  match count, statement import, and a collapsed **Instruction** card
  documenting the non-obvious behaviour (sign convention, duplicate matching,
  delete semantics).
- Guard rails: deleting a card is refused while transactions reference it;
  deleting a category keeps the transactions and just uncategorises them.

### [Added] Daily Quote — import from a newsletter

- Parses a pasted James Clear "3-2-1" issue into quote candidates **without an
  LLM** — the format is regular enough to read deterministically (numbered
  headings, Roman-numeral items, quoted passages, `Source:` footers).
- Blocks are sliced by section and numeral rather than by quote marks, because a
  passage can quote something internally; the closing mark is only stripped when
  the quote marks balance. Tests run against a real issue verbatim, zero-width
  characters included.
- Paste → **Parse** → review and edit each candidate (quote, author, source,
  category, include/skip) → **Import**. Parsing happens in the browser, so
  nothing is written until approved, and unrecognised sections are reported as
  warnings rather than guessed at.
- Migration `0028` adds `source` to `sys_daily_quotes` so citations survive; the
  add/edit form and grid gained the field.

## 2026-07-30 22:27 — Result grid: search, filters, sticky header, column control, row selection

Upgraded the shared `DataGrid` (the "result grid") used by User Management,
Stocks & ETFs, CSV Analytics, SQL Explorer, and MyJournal. Every change is
additive — no caller needed updating.

- [Changed] **Mechanics moved into the library.** New `src/lib/shared/table.ts` holds the
  pure parts (compare/sort, search and per-column matching, page slicing, CSV
  escaping) with 16 unit tests, so null ordering, numeric-aware text sorting
  ("item 2" before "item 10"), multi-term search, and page clamping are actually
  covered. The component now holds only view state.
- [Added] **Search + per-column filters.** A toolbar search box (terms are AND-ed across
  columns, so extra words narrow the result) plus a "Filters" toggle that reveals
  a filter input per column. The record count reports "filtered from N", there's
  a Clear filters action, and a filtered-empty result gets its own message. Sort,
  pagination, and CSV export all follow the filtered set.
- [Added] **Sticky header and honest page sizes.** The header stays visible while the body
  scrolls (capped by a new `maxHeight`, default `70vh`). Page sizes are now
  10/25/50/100/200/500/1000/ALL, and pagination triggers when rows exceed the
  chosen page size — previously it was hard-wired to 100, so a caller asking for
  `defaultPageSize={25}` silently got every row on one page.
- [Added] **Column visibility and order.** A "Columns" panel with checkboxes and up/down
  reordering, plus Reset. An optional `storageKey` remembers the arrangement in
  `localStorage`. Hiding the last visible column is refused (it would leave an
  empty grid), and a saved layout naming columns that no longer exist is ignored.
- [Added] **Row selection.** Opt-in `enableSelection` adds a checkbox column with a
  select-all covering the whole filtered set (indeterminate when partial), and
  `renderSelectionActions(selectedRows, clearSelection)` supplies bulk actions.
  Checkbox clicks no longer trigger `onRowClick`.
- [Changed] **Status bar is raised, not recessed** — a top highlight plus a cast shadow, the
  same bevel mechanic as the header bar. The grid container gained
  `overflow-hidden` so the toolbar/status-bar backgrounds stay inside its rounded
  corners.
- [Changed] **`components.md` restructured** into a fuller registry: an index table, then a
  per-component section with source link, import line, client/server note, a props
  table, a usage snippet, and a real call site to copy from.

## 2026-07-30 00:02 — MyJournal: entry authoring, GPS + weather, entry screen, Today In History

Built out the MyJournal module from "list + CSV import" into a full authoring and
browsing experience.

Entry authoring:

- [Added] **New Journal** collapsible card on the module page: a create form (date
  defaulting to today, time, title, place, categories, tags, content) with
  autocomplete from existing categories/tags. New `createJournalEntryAction`.
- [Changed] The entries list is now the **25 most recent** via a new `listRecentEntries`
  use-case (ordered `entry_date`/`entry_time`/`id` descending with a SQL `LIMIT`,
  rather than loading every row to show 25).

Locations and weather (no schema change — `jrn_entry_locations` and the entry's
weather columns already existed from migration 0027):

- [Added] **GPS location picker** built on Leaflet + OpenStreetMap (chosen over Google
  Maps so no API key or billing is needed): search a place, or click the map to
  drop a pin, with the name suggested by reverse geocoding and multiple locations
  per entry. New deps `leaflet`, `react-leaflet`, `@types/leaflet`.
- [Added] New `src/lib/geocoding` module (`GeocodingClient` port + `NominatimGeocodingClient`).
  Geocoding runs **server-side** through actions because Nominatim's usage policy
  requires a descriptive `User-Agent`, which a browser `fetch` cannot set.
- [Added] New `src/lib/weather` module (`WeatherClient` port + `OpenMeteoWeatherClient`,
  plus a WMO weather-code → description map) and a **"Fetch today's weather"**
  button that uses the entry's first location, falling back to a default location.
- [Added] **Preferences** card storing a default location and °C/°F in the journal's
  module settings (`resolveJournalPreferences` mirrors the Stocks module's
  `resolveThresholds`).

Entry screen (new route `/modules/[slug]/entries/[id]`):

- [Added] New registered `JournalEntryCard` component showing every stored field, with
  **Print/Save-PDF**, **Edit**, **Lock/Unlock** and **Delete** (behind an inline
  confirm). Blank fields are hidden so an entry only shows what it recorded.
- [Added] Printing uses a new `@media print` block in `globals.css` that prints the
  `.print-sheet` element alone as ink-on-white, independent of the app chrome.
- [Added] **Inline editing** seeds *and* resubmits weather, locations, and the pinned flag,
  because `updateEntry` replaces the whole aggregate — without that, editing text
  would silently drop them. Removing weather is an explicit checkbox.
- [Added] **Previous/Next** navigation via a new `getEntryNeighbors` use-case, using
  SQLite row-value comparison so adjacency matches the list's exact ordering.
  Previous = older, Next = newer.
- [Added] Per-location **Map** button opens a read-only Leaflet panel plus deep links to
  OpenStreetMap and Google Maps. `JournalEntryCard` itself stays free of any
  mapping dependency (it raises the intent; the route renders the map).
- [Changed] Rows in both journal grids now open the entry screen — `DataGrid` gained an
  additive `onRowClick` prop (existing callers unaffected).

Other:

- [Added] **Today In History** card: past entries sharing today's month and day (any year
  but this one), each labelled "N years ago".
- [Added] **Show SQL** on the journal entries grid, admin-only. Added
  `executeReadOnlyQuery` to `src/lib/sql-explorer`, which accepts only `SELECT` —
  deliberately stricter than the existing admin `executeStatement`, whose
  non-read-only path executes writes. The admin check is enforced in the server
  action, not just by hiding the button.
- [Added] **Daily Quote widget**: a small refresh button draws another random quote
  without reloading the page.

## 2026-07-27 23:18 — MyJournal module (schema, CSV importer, UI); plus batched pre-existing tree work

MyJournal (this session):

- [Added] **Schema** — migration `0027_create_journal_tables`: 8 `jrn_` tables —
  `jrn_entries` (weather flattened to columns; multiple entries per date
  allowed), `jrn_categories`, `jrn_tags`, `jrn_entry_categories`,
  `jrn_entry_tags`, `jrn_entry_locations`, `jrn_entry_images`, `jrn_icons`.
  INTEGER keys, no DB FKs (cascade handled in the repository), `updated_at`
  triggers.
- [Added] **Library** `src/lib/journal/` — the entry as an aggregate (its categories,
  tags, and locations), zod schemas, `SqliteJournalRepository` with
  transactional create/update/delete cascades, and use-cases (create/update/
  delete, pin, lock, category & tag management), with colocated tests. Wired as
  `deps.journalRepo`. Rules: referenced categories/tags auto-register; names
  trim/de-dupe; a locked entry blocks edit and delete until unlocked.
- [Changed] **CSV import** — generalized the shared `csv-import` module: per-column
  options (`delimiter`, `dateFormat`) held in a parallel map so the Stock
  importer's `ColumnMapping` was untouched; a `Journal` import type; editable
  named mappings (`updateNamedMapping`); a 10-random-row preview sample. Fixed
  `src/lib/shared/csv.ts` with a record-aware `parseCsvRecords` so multi-line
  quoted cells parse correctly (also benefits Stocks/CSV-Analysis).
- [Added] **Apply-adapter** `src/lib/journal/csv-import.ts` (record → `createEntry`,
  best-effort with a per-row summary) + `autoMapJournalHeaders`; new
  `import-journal-csv` CLI command. Verified against a real 785-row export:
  785 imported, 0 skipped.
- [Added] **Web view** — replaced the journal "Coming soon" placeholder with a
  read-only entries `DataGrid` plus a CSV import panel (file drop, sample grid,
  per-column field + option controls, named-mapping load/save/edit/delete,
  import summary). Deferred: the create/edit/pin/lock entry editor, and the
  `images`/`icons`/`widgets`/`attachments` features.

Pre-existing uncommitted work batched into this commit (described from the diff,
not this session's conversation):

- [Changed] **Real Estate removed** — deleted `src/lib/real-estate/**`,
  `src/lib/property-watch/**`, their module views/actions, and 8 property CLI
  commands; dropped migrations 0013/0014 and added `0026_drop_real_estate_module`.
- [Changed] **Module-prefixed table names** — every table renamed to a lowercase 3-letter
  prefix (`sys_`/`stk_`/`csv_`); historical `CREATE` migrations (0001–0023),
  affected repositories, and `scripts/migrate.ts` updated
  (`reconcileLegacyTableNames` migrates an existing DB in place). Added
  `coding-guide.md` and `0024_rename_tables_to_module_prefixes`.
- [Added] **Daily Quote** — `src/lib/daily-quote/**`, an admin management screen, and
  migration `0025_create_sys_daily_quotes` (seeded starter quotes); plus a
  `list-users` CLI command and a `show_users.bat` helper.

## 2026-07-25 22:11 — Self-signup with hidden admin elevation; user-selectable icon sets; Daybreak light theme

Self-signup (this session):

- [Added] Added a public "Create account" flow reachable from the login screen. New
  `registerUser` use-case in `src/lib/user` always creates a `user`-role
  account with zero module access (mirroring the Google auto-create policy);
  its schema deliberately has no `role` field so the form can't self-elevate.
- [Added] Optional admin elevation at signup: a matching `adminSecretKey` (compared
  constant-time via a new `src/lib/shared/secret.ts` `secureCompare`) creates
  an admin instead. The expected value comes from a new `ADMIN_SIGNUP_SECRET`
  env var wired in as `deps.adminSignupSecret`; unset means admin signup is
  off, and a wrong/absent-secret attempt is a hard failure (no silent
  downgrade). New `InvalidAdminSecretError`.
- [Added] New `/login/register` route (page + view). The "Admin secret key" field is
  hidden until the visitor types the sequence `a` `d` `m` anywhere on the
  page. On success the visitor is returned to `/login?registered=1` with a
  confirmation banner (no session is created). Colocated tests for
  `registerUser` and `secureCompare`; documented the env var in `.env.example`.

Icon sets + light theme (pre-existing uncommitted work in the tree, described
from the diff rather than this session's conversation):

- [Added] Module icons are now a user-selectable "icon set" (parallel to color
  themes): new `ICON_SETS` registry in `src/lib/settings/icon-sets.ts`, an
  `icon_set` app setting (migration `0023`, default `solar-bold-duotone`,
  mirrored in `DEFAULT_APP_SETTINGS`), an Admin → Configuration → Icons picker
  screen, and an `IconSetProvider`/`useIconSet` context read once in the root
  layout. Glyph SVGs are baked into `module-icon-sets.generated.ts` by
  `scripts/gen-icon-glyphs.mjs` (`npm run gen:icons`) from `@iconify-json/*`
  devDependencies — no runtime icon dependency.
- [Changed] `ModuleCard` redesigned to lead with a prominent icon badge (solid-accent
  tile for monochrome sets, neutral `bg-paper` tile for colorful sets);
  registry (`components.md`) and `design.md` updated accordingly.
- [Added] Added **Daybreak**, the first light theme (rose accent on warm paper), plus
  design.md guidance to design for both light and dark surfaces.

Not committed: `Google_Client_Info.md` — it contains a live Google OAuth
client secret and is intentionally excluded (recommend rotating it and moving
the values into a gitignored `.env.local`).

## 2026-07-12 23:34 — User management, authentication, and Google sign-in

- [Added] Added user management: a `users` table (username, full name, description,
  hashed password via Node's `scrypt`, role, disabled flag), a
  `user_module_access` grant table, and a `sessions` table backing a
  cookie-based login flow. New `src/lib/user` and `src/lib/auth` domain
  modules, plus a `create-user` CLI command to bootstrap the first admin.
- [Added] Gated the whole app behind login: moved the existing routes into a new
  `src/app/(protected)/` route group whose layout redirects to `/login` for
  anyone without a valid session. The sidebar now shows the logged-in user's
  name and a logout button, hides "Administration" for non-admins, and only
  lists modules the user has been granted (admins implicitly get every
  module, including future ones).
- [Added] Added a "User Management" screen (new top-level Administration node) built
  on a new reusable `DataGrid` component: create users, elevate/demote,
  enable/disable, reset passwords, edit per-user module access, and delete —
  with guards preventing an admin from locking themselves out.
- [Added] Added "Sign in with Google" as an additional login method, hand-rolled
  (no new dependency): a `google_email` column links an existing account to
  a Google address; unlinked/unverified Google accounts are rejected, never
  auto-registered. Feature is off by default and only appears once
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` are set
  (see new `.env.example`).
- [Fixed] Fixed a relative-import bug in `admin/about/page.tsx` (`../../package.json`)
  left over from the route-group move — it needed one more `../` to still
  reach the repo root.
- [Fixed] Fixed `.gitignore`: the blanket `.env*` rule was also swallowing
  `.env.example`, which is meant to be committed; added `!.env.example`.

## 2026-07-12 22:10 — Administration section, Module Settings, and visual polish

- [Added] Added a full Administration section: tree nav with a distinct SVG icon per
  node, a collapsible tree panel (flattens to icon-only when collapsed),
  Module/Application Configuration, 10 color themes, About, and a Change
  History page that renders this file.
- [Added] Added the Module Settings feature: a new `module_settings` table (per-module
  key/value store), a `src/lib/module-settings` domain module, and a
  `CollapsibleCard`-based editor per module, wired into the existing Save
  Settings / Reset to Default flow.
- [Fixed] Fixed a data-integrity bug: `resetToDefaults` on `modules` now upserts by
  slug instead of delete-then-insert, so a module's id (and its settings)
  survives "Reset to Default" instead of being silently orphaned.
- [Added] Added a second module, Stock & ETFs, and a combined home/AI-magic/finance
  themed SVG app icon (favicon + in-app branding, next to the wordmark).
- [Changed] Sidebar/home screen visual pass: restyled the sidebar from dark to light per
  feedback, added Home and Administration as their own nav rows (own icons,
  out of the cramped header), centered the home screen header row, and gave
  the Administration button and module cards deeper, more separated 3D drop
  shadows.
- [Changed] Rewrote the `build_project` skill into a full release checkpoint (log →
  verify → sync docs → commit).
- [Added] Initialized git and linked the GitHub remote
  (`https://github.com/rvpals/MyHomeBase.git`).
