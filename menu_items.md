# Menu items

Every navigation node a signed-in reader can reach, with the module it belongs to
and the description the navigation itself shows.

> **This document is now a snapshot of a live system, not the system itself.**
> A **menu item** is a first-class concept in the code as of migration 0124: every
> destination below has a permanent unique id, an administrator can retitle it at
> Administration → Display Settings → Menu Items, and `menu-items list` prints the
> same table from a terminal. The id is the item's **icon slot id** — there is no
> second id space and no counter. See `coding-guide.md` → *Menu items: the id is the
> slot id, and it allocates itself*.
>
> **The ids are the addressable part.** This file lists titles and hrefs for reading;
> the id column in the admin screen and the CLI is what a personal toolbar stores.
> Counts here (78 nodes) exclude group headings, which the registry *does* carry as
> items — the live registry has **88**.

**Generated from the registries, not hand-written.** The source of truth is:

- `src/lib/navigation/tree.ts` → `HOME_SECTION` and `buildNavigationTree` (Home, then
  one heading per accessible module).
- `src/lib/modules/defaults.ts` → `DEFAULT_MODULES` (the ten module rows, their short
  names, descriptions, sequence and icons; mirrors the seed migrations).
- `src/app/(protected)/module-sections.ts` → `SECTION_BUILDERS`, which maps each module
  slug to its `*-sections.ts` file in `src/app/(protected)/modules/[slug]/`.
- `src/app/(protected)/admin/nav.ts` → `adminNav`, flattened into the tree by
  `flattenAdminNav` in `src/app/(protected)/admin-tree-module.ts`.

**Descriptions below are verbatim** from each section's `*_SECTION_INFO` entry (or the
`hint` on an `adminNav` node) — that same string is the nav hint and the page heading's
subtitle, so if one is wrong here it is wrong on screen.

Two things this table deliberately does *not* claim:

- **Reachability is per-reader.** `getAccessibleModules` filters the module list before
  the tree is built, so a reader without access to a module sees neither its heading nor
  any of its sections. Administration is admin-only. The table is the *full* set.
- **A section's own sub-routes are not nodes.** `/modules/journal/entries/42` is a record
  view reached from within a section, not a navigation target; only the section that owns
  it is listed. `findActiveSection` matches those by prefix precisely so they keep their
  section highlighted.

## Totals

| Area | Nodes |
|---|---|
| Top level (Home, Account) | 2 |
| Module sections (10 modules) | 56 |
| Administration | 22 |
| **Total reachable nodes** | **80** |

Plus the 10 module landing headings themselves (`/modules/<slug>`), which are the same
address as each module's `main` section — counted once, as the `main` row.

## Top level

| Node | Module | Href | Description |
|---|---|---|---|
| Home | — | `/?home=1` | The dashboard you land on. |
| Account | — | `/account` | The reader's own profile and password. Reached from the avatar menu, not the tree. |

`Home`'s href carries `?home=1` on purpose: it means "I clicked Home", which is what shows
the dashboard to a reader whose preference is to open a favourite module at startup. A bare
`/` would bounce straight back out to that module. There is no `/home` route.

## Investments — `/modules/investments`

Manage stock, ETF and fund investments. Icon `chart`, sequence 2. Section files are still
named `stock-*`: migration 0108 renamed the module, not the files.

| Section | Slug | Href | Description |
|---|---|---|---|
| Dashboard | `main` | `/modules/investments` | Portfolio value, today's move, total return and where the money sits. |
| Positions | `positions` | `/modules/investments/positions` | Every holding, with cost basis and gain — add, edit or refresh prices. |
| Transactions | `transactions` | `/modules/investments/transactions` | The buy and sell history behind those positions. |
| Account Performance | `accounts` | `/modules/investments/accounts` | Brokerage accounts and their value over time. |
| Watch & Test | `watch-test` | `/modules/investments/watch-test` | Watch lists, next-day signals, and what-if backtests on any ticker. |
| Chart & Analysis | `charts` | `/modules/investments/charts` | Volatility, correlation and Sharpe ratio across the portfolio. |
| Tax Lots | `tax-lots` | `/modules/investments/tax-lots` | Split-adjusted purchase lots, their return and CAGR, and which are long-term. |
| Export for AI Analysis | `ai-export` | `/modules/investments/ai-export` | Package the portfolio as an AI-ready prompt — holdings, weights and returns, with account names stripped. |
| CSV Import | `import` | `/modules/investments/import` | Define a reusable mapping per broker export, then import with it. |
| Configuration | `settings` | `/modules/investments/settings` | Thresholds the next-day scan uses to decide what's worth flagging. |

## Journal — `/modules/journal`

A place to keep a journal with daily recordings. Icon `journal`, sequence 3.

Journal is the one module with **groups**: `JOURNAL_GROUPS` flattens three groups to a
`group` label per section. The tree spends its one level of nesting on the module, so a
group becomes a label between rows rather than a second accordion.

| Section | Slug | Group | Href | Description |
|---|---|---|---|---|
| Home screen | `main` | — | `/modules/journal` | Today in history, recent entries, and quick actions. |
| New Journal Entry | `new-entry` | — | `/modules/journal/new-entry` | Write a new journal entry. |
| Entries | `entries` | — | `/modules/journal/entries` | Browse and manage all journal entries, written and logged. |
| Calendar | `calendar` | — | `/modules/journal/calendar` | See your journal entries on a calendar. |
| Views | `views` | — | `/modules/journal/views` | Custom views of your journal data. |
| Report | `report` | — | `/modules/journal/report` | Summaries and reports from your journal. |
| CSV Import | `import` | Data Management | `/modules/journal/import` | Import a CSV file, reset the journal, and bulk-correct entries. |
| Calendar Import | `calendar-import` | Data Management | `/modules/journal/calendar-import` | Import events from a Google Calendar .ics export. |
| Review Data | `review-data` | Data Management | `/modules/journal/review-data` | Tidy up what the journal already holds — several entries on one date. |
| Preferences | `configuration` | Configuration | `/modules/journal/configuration` | Preferences for how your journal works. |
| Templates | `templates` | Configuration | `/modules/journal/templates` | Define different templates used in the journal module. |
| Meta Data | `metadata` | Configuration | `/modules/journal/metadata` | Categories and tags, and the icons that stand for them. |
| Location Manager | `locations` | Locations | `/modules/journal/locations` | Saved places you can pick from when writing an entry. |
| Location Map | `location-map` | Locations | `/modules/journal/location-map` | Every saved place on one map, filtered by category and tag. |
| Location Meta Data | `location-metadata` | Locations | `/modules/journal/location-metadata` | Categories and tags for places — what a place *is*. |

The three Locations slugs and `new-entry` and `import` are load-bearing: the section icon
slots derive from them (`journal_section_locations` and friends), so renaming one silently
orphans an uploaded icon override.

## CSV Analysis — `/modules/csv-analysis`

Import a CSV file for analytics. Icon `folder`, sequence 4.

| Section | Slug | Href | Description |
|---|---|---|---|
| Dashboard | `main` | `/modules/csv-analysis` | Import a CSV, then chart and browse what is in it. |
| Import Files | `import` | `/modules/csv-analysis/import` | Drop several CSVs from the same kind of device into one dataset. |
| Compare | `compare` | `/modules/csv-analysis/compare` | Combined and per-source statistics, ranked, with every source on one chart. |
| Custom Views | `views` | `/modules/csv-analysis/views` | Build a saved view over a dataset: columns, criteria, order and page size. |
| Configuration | `configuration` | `/modules/csv-analysis/configuration` | Defaults for importing and charting CSV files. |

## Expense — `/modules/expense`

Track credit-card spending by category. Icon `wallet`, sequence 5.

| Section | Slug | Href | Description |
|---|---|---|---|
| Main (Dashboard) | `main` | `/modules/expense` | At-a-glance totals and what still needs your attention. |
| Transactions | `transactions` | `/modules/expense/transactions` | Browse, search and edit every transaction, or add one by hand. |
| Meta Data | `meta-data` | `/modules/expense/meta-data` | The credit cards, categories and rule types everything else refers to. |
| Charts and Analysis | `charts` | `/modules/expense/charts` | Where the money went, by category — and how this month compares to last. |
| Import Transaction | `import` | `/modules/expense/import` | Bring in statement CSVs. The rules that tidy them up live in Transaction Rules. |
| Transaction Rules | `transaction-rules` | `/modules/expense/transaction-rules` | The post-import rules that fill in vendor, category, status and notes. |
| Settings | `settings` | `/modules/expense/settings` | Automatic import folder and how often it runs. |

Expense also publishes a deep-link helper to Transactions with one group pre-opened (used by
the Meta Data cards). The grouping and group key travel in the URL, so the result is a real
bookmarkable address — but it targets the Transactions section above, not a separate node.

## Attendance — `/modules/attendance`

Take daily attendance for a class. Icon `roster`, sequence 6.

| Section | Slug | Href | Description |
|---|---|---|---|
| Home screen | `main` | `/modules/attendance` | Pick a class and take today's attendance. |
| Rosters | `rosters` | `/modules/attendance/rosters` | Add students and enroll them into a class. |
| Classes | `classes` | `/modules/attendance/classes` | Create classes and manage who is in them. |
| Student actions | `actions` | `/modules/attendance/actions` | The list of things you can note about a student on the day. |
| Edit records | `edit` | `/modules/attendance/edit` | Open a past day's register and correct it. |
| Report | `report` | `/modules/attendance/report` | Print a class's attendance for a day. |
| Configuration | `configuration` | `/modules/attendance/configuration` | Preferences for how attendance works. |

## Music Library — `/modules/music-library`

Browse and stream your music collection. Icon `music`, sequence 7.

| Section | Slug | Href | Description |
|---|---|---|---|
| Library | `main` | `/modules/music-library` | Browse and search everything in the catalog. |
| Magic Playlist | `magic` | `/modules/music-library/magic` | Pick genres, artists and a length; get a random playlist that fits. |
| Player | `player` | `/modules/music-library/player` | The current track, with artwork and lyrics. |
| Queue | `queue` | `/modules/music-library/queue` | What is lined up next. Reorder it, shuffle it, or take tracks out. |
| Scan Music | `scan` | `/modules/music-library/scan` | Pick a folder on the NAS and catalog what is in it. |
| Configuration | `configuration` | `/modules/music-library/configuration` | Which file formats to include when scanning. |

## Games — `/modules/games`

Play a quick game and keep a high-score board. Icon `game`, sequence 8.

| Section | Slug | Href | Description |
|---|---|---|---|
| Arcade | `main` | `/modules/games` | Pick a game and play. |
| Scores | `scores` | `/modules/games/scores` | The shared high-score board across every game. |
| Configuration | `configuration` | `/modules/games/configuration` | How the Games module behaves. |

Individual games are launched from the Arcade screen, not from navigation — they are not
tree nodes.

## Picture Gallery — `/modules/picture-gallery`

Browse the photo archive and the pictures you have kept. Icon `photo`, sequence 9. Section
files are named `gallery-*`.

| Section | Slug | Href | Description |
|---|---|---|---|
| Home screen | `main` | `/modules/picture-gallery` | A photograph drawn at random from the archive, redrawn whenever you ask. |
| Favorite photos | `favorites` | `/modules/picture-gallery/favorites` | The photographs you've kept. Watch them as a slideshow, or download a few. |
| Albums | `albums` | `/modules/picture-gallery/albums` | Collections you've put together. Play one as a slideshow, or export every picture in it. |
| Magic List | `magic-list` | `/modules/picture-gallery/magic-list` | Conjure a set of photographs from the archive by date, size and resolution — then play it, export it, or keep it as an album. |

## Tools — `/modules/tools`

This module list all the utilities and tools. Icon `tool`, sequence 10.

| Section | Slug | Href | Description |
|---|---|---|---|
| Dashboard | `main` | `/modules/tools` | The utilities and tools available here. |
| TODO Lists | `todo` | `/modules/tools/todo` | The household's shared lists of things to do. |
| SQLite File Browser | `sqlite-browser` | `/modules/tools/sqlite-browser` | Upload a SQLite file and browse, filter and delete the rows inside it. |
| CSV File Browser | `csv-browser` | `/modules/tools/csv-browser` | Upload a CSV or text file and browse, filter, edit and delete the rows in it. |

The lists this section works from are administered at Administration → TODO Lists
(`/admin/todo`) — same subject, two screens, which is why they share the `clipboard` icon.

## Household — `/modules/household`

Recipes, receipts and the HSA — the household's paperwork. Icon `household`, sequence 11.

Household is the other grouped module: `HOUSEHOLD_GROUP_LABELS` flattens two halves the
same way Journal's three are flattened.

| Section | Slug | Group | Href | Description |
|---|---|---|---|---|
| Home screen | `main` | — | `/modules/household` | What the household keeps track of here. |
| Recipes | `recipes` | Recipes | `/modules/household/recipes` | The recipe box — what to cook, and how you made it last time. |
| Import | `recipes-import` | Recipes | `/modules/household/recipes-import` | Bring recipes in from a CSV, mapping its columns onto the recipe fields. |
| Overview | `hsa` | HSA Tracker | `/modules/household/hsa` | Health savings account contributions and claims. |

## Administration — `/admin`

Users, modules, appearance and diagnostics. Icon `shield`.

**Not a module** — it has no `sys_modules` row, so `buildNavigationTree` cannot produce it
from the module list. It is declared as `ADMIN_TREE_MODULE` and appended by `NavTree`.

`Configuration` and `Display Settings` are **pure headings with no route of their own**;
their boxes render an unclickable header. `Daily Quote` is the one group heading that also
has its own page, which is why `All Quotes` exists as an explicit child — a group heading
in `SectionPanel` renders as a disclosure button and drops its href, so without that child
the listing was reachable only from the home dashboard's Daily Quote widget.

| Node | Group | Href | Description |
|---|---|---|---|
| Module Configuration | Configuration | `/admin/configuration/modules` | Configuration of modules in the application |
| Application Configuration | Configuration | `/admin/configuration/application` | General settings that apply across the application |
| Color Themes | Display Settings | `/admin/configuration/themes` | Change color theme for the application |
| Icons | Display Settings | `/admin/configuration/icons` | Change the module icon set for the application |
| App Texture | Display Settings | `/admin/configuration/texture` | Set an optional background picture for the home dashboard |
| Dashboard Widgets | Display Settings | `/admin/display-settings/widgets` | Choose which cards the home screen shows, and in what order |
| Floating Components | Display Settings | `/admin/display-settings/floating` | Choose which components may float over the application |
| Border Weight | Display Settings | `/admin/display-settings/borders` | Set how thick the application's borders are drawn |
| Chrome Style | Display Settings | `/admin/display-settings/chrome` | Set the border treatment for the header and the navigation tree |
| Scratchpad Categories | Display Settings | `/admin/display-settings/scratchpad` | Set the tabs the Scratchpad shows, for everyone |
| User Management | — | `/admin/user-management` | Manage users, roles, and module access |
| All Quotes | Daily Quote | `/admin/daily-quote` | Browse, edit and delete every quote in the collection |
| Add Quote | Daily Quote | `/admin/daily-quote/add` | Add a single quote by hand |
| Import from Newsletter | Daily Quote | `/admin/daily-quote/import` | Paste a 3-2-1 issue and import the quotes it contains |
| TODO Lists | — | `/admin/todo` | Add, rename, reorder and remove the household's TODO lists |
| Security | — | `/admin/security` | Sign-in history and failed login attempts |
| Background Tasks | — | `/admin/background-tasks` | What the server runs on a timer, and when each job last ran |
| Message Queue | — | `/admin/messages` | Read the application-wide message queue, and delete messages from it |
| SQL Explorer | — | `/admin/sql-explorer` | Run read-only or ad-hoc SQL against the application database |
| About | — | `/admin/about` | Version, system information, and the project's change log |

Two Administration routes exist that are **not** tree nodes, reached from within a screen:

| Route | Reached from | What it is |
|---|---|---|
| `/admin` | The Administration heading itself | The admin landing page. |
| `/admin/user-management/preferences/[userId]` | A row on User Management | One user's preferences, per user. |

## The three ids you must never rename

Three kinds of id in this table are **permanent once shipped**, because something
persisted derives from them:

1. **Section slugs** — `SectionPanel` derives each section's icon slot id from the slug
   (`journal_section_locations`), so renaming a slug orphans any uploaded icon override.
2. **`adminNav` node ids** — same derivation. This is why the Display Settings children
   keep `configuration-*` ids and routes under `/admin/configuration/` even though they
   are grouped under Display Settings: it was a regrouping of the nav, not a move of the
   screens.
3. **Floating component ids** — persisted in the enabled list and in each reader's state
   rows.

## Keeping this file true

Nothing regenerates this file automatically — it is a snapshot of the registries as of
the commit it was written on. When you add a module, a section, or an `adminNav` entry,
update the matching table and the totals. `modules.md` step 7 is the recipe for the
module side; a new module also needs its entry in `SECTION_BUILDERS` before any of its
sections appear here or in the tree.
