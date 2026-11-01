# Menu items

Every navigation node a signed-in reader can reach, with the module it belongs to
and the description the navigation itself shows.

> **This document is a snapshot of a live system, not the system itself.**
> A **menu item** is a first-class concept in the code as of migration 0124: every
> destination below has a permanent unique id, an administrator can retitle it at
> Administration → Display Settings → Menu Items, and `menu-items list` prints the
> same table from a terminal. The id is the item's **icon slot id** — there is no
> second id space and no counter. See `coding-guide.md` → *Menu items: the id is the
> slot id, and it allocates itself*.
>
> **The ids are the addressable part.** This file lists titles and hrefs for reading;
> the id column in the admin screen and the CLI is what a personal toolbar stores.

**Generated from the registries, not hand-written.** The source of truth is:

- `src/lib/navigation/tree.ts` → `HOME_SECTION` and `buildNavigationTree` (Home, then
  one heading per accessible module).
- `src/lib/modules/defaults.ts` → `DEFAULT_MODULES` (the twelve module rows, their short
  names, descriptions, sequence and icons; mirrors the seed migrations).
- `src/app/(protected)/module-sections.ts` → `SECTION_BUILDERS`, which maps each module
  slug to its `*-sections.ts` file in `src/app/(protected)/modules/[slug]/`.
- `src/app/(protected)/admin/nav.ts` → `adminNav`, flattened into the tree by
  `flattenAdminNav` in `src/app/(protected)/admin-tree-module.ts`.

**Descriptions below are verbatim** from each section's `*_SECTION_INFO` entry (or the
`hint` on an `adminNav` node) — that same string is the nav hint and the page heading's
subtitle, so if one is wrong here it is wrong on screen. The **Icon** column is the
section's `defaultConcept`: the glyph it draws when no icon has been uploaded for its
slot, from the module's `*_SECTION_ICONS` map.

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
| Module sections (12 modules) | 80 |
| Administration | 26 |
| **Total reachable nodes** | **108** |

Plus the 12 module landing headings themselves (`/modules/<slug>`), which are the same
address as each module's `main` section — counted once, as the `main` row. Administration
adds four group headings (`Configuration`, `Display Settings`, `Daily Quote`,
`Locations`), which the registry carries as items but which are not destinations; they
are excluded from the 26 above.

## Top level

| Node | Module | Href | Description |
|---|---|---|---|
| Home | — | `/?home=1` | The dashboard you land on. |
| Account | — | `/account` | The reader's own profile and password. Reached from the avatar menu, not the tree. |

`Home`'s href carries `?home=1` on purpose: it means "I clicked Home", which is what shows
the dashboard to a reader whose preference is to open a favourite module at startup. A bare
`/` would bounce straight back out to that module. There is no `/home` route.

## Investments — `/modules/investments`

Manage stock, ETF and fund investments. Icon `chart`, sequence 2.

Section files are still named `stock-*`: migration 0108 renamed the module, not the files.

| Section | Slug | Icon | Href | Description |
|---|---|---|---|---|
| Dashboard | `main` | `grid` | `/modules/investments` | Portfolio value, today's move, total return and where the money sits. |
| Positions | `positions` | `list` | `/modules/investments/positions` | Every holding, with cost basis and gain — add, edit or refresh prices. |
| Transactions | `transactions` | `history` | `/modules/investments/transactions` | The buy and sell history behind those positions. |
| Account Performance | `accounts` | `database` | `/modules/investments/accounts` | Brokerage accounts and their value over time. |
| Watch & Test | `watch-test` | `stock-quote` | `/modules/investments/watch-test` | Watch lists, next-day signals, and what-if backtests on any ticker. |
| Chart & Analysis | `charts` | `chart` | `/modules/investments/charts` | Volatility, correlation and Sharpe ratio across the portfolio. |
| Tax Lots | `tax-lots` | `history` | `/modules/investments/tax-lots` | Split-adjusted purchase lots, their return and CAGR, and which are long-term. |
| Export for AI Analysis | `ai-export` | `quote` | `/modules/investments/ai-export` | Package the portfolio as an AI-ready prompt — holdings, weights and returns, with account names stripped. |
| CSV Import | `import` | `upload` | `/modules/investments/import` | Define a reusable mapping per broker export, then import with it. |
| Configuration | `settings` | `sliders` | `/modules/investments/settings` | Thresholds the next-day scan uses to decide what's worth flagging. |

## Journal — `/modules/journal`

A place to keep a journal with daily recordings. Icon `journal`, sequence 3. Long name "My Journal".

Journal is the one module with **groups**: `JOURNAL_GROUPS` flattens three groups to a
`group` label per section. The tree spends its one level of nesting on the module, so a
group becomes a label between rows rather than a second accordion.

`new-entry` and `import` are load-bearing: the section icon slots derive from them, so
renaming one silently orphans an uploaded icon override.

Journal no longer has a Locations group. Its three sections and the `journal_section_location*`
icon slots were retired with the journal's own location library (migration 0141); saved
places now live under **Administration → Locations**.

| Section | Slug | Icon | Href | Description |
|---|---|---|---|---|
| Home screen | `main` | `grid` | `/modules/journal` | Today in history, recent entries, and quick actions. |
| New Journal Entry | `new-entry` | `new-journal` | `/modules/journal/new-entry` | Write a new journal entry. |
| Entries | `entries` | `list` | `/modules/journal/entries` | Browse and manage all journal entries, written and logged. |
| Calendar | `calendar` | `history` | `/modules/journal/calendar` | See your journal entries on a calendar. |
| Saved Locations | `saved-locations` | `pin` | `/modules/journal/saved-locations` | Your saved places, and the entries written at each one. |
| Topics | `topics` | `network` | `/modules/journal/topics` | Pick a subject and see the entries about it, and how they connect. |
| Report | `report` | `chart` | `/modules/journal/report` | Summaries and reports from your journal. |
| CSV Import | `import` | `upload` | `/modules/journal/import` | Import a CSV file, reset the journal, and bulk-correct entries. |
| Calendar Import | `calendar-import` | `calendar` | `/modules/journal/calendar-import` | Import events from a Google Calendar .ics export. |
| Review Data | `review-data` | `clipboard` | `/modules/journal/review-data` | Tidy up what the journal already holds — several entries on one date. |
| Recycle Bin | `recycle-bin` | `trash` | `/modules/journal/recycle-bin` | Entries you deleted — restore them, or remove them for good. |
| Preferences | `configuration` | `sliders` | `/modules/journal/configuration` | Preferences for how your journal works. |
| Templates | `templates` | `note` | `/modules/journal/templates` | Define different templates used in the journal module. |
| Meta Data | `metadata` | `shapes` | `/modules/journal/metadata` | Categories and tags, and the icons that stand for them. |
| Home screen layout | `home-screen` | `window` | `/modules/journal/home-screen` | Choose which cards your home screen shows, and in what order. |

## CSV Analysis — `/modules/csv-analysis`

Import a CSV file for analytics. Icon `folder`, sequence 4. Long name "CSV Data Analysis".

| Section | Slug | Icon | Href | Description |
|---|---|---|---|---|
| Dashboard | `main` | `grid` | `/modules/csv-analysis` | Import a CSV, then chart and browse what is in it. |
| Import Files | `import` | `upload` | `/modules/csv-analysis/import` | Drop several CSVs from the same kind of device into one dataset. |
| Compare | `compare` | `chart` | `/modules/csv-analysis/compare` | Combined and per-source statistics, ranked, with every source on one chart. |
| Custom Views | `views` | `sliders` | `/modules/csv-analysis/views` | Build a saved view over a dataset: columns, criteria, order and page size. |
| Configuration | `configuration` | `gear` | `/modules/csv-analysis/configuration` | Defaults for importing and charting CSV files. |

## Expense — `/modules/expense`

Track credit-card spending by category. Icon `wallet`, sequence 5. Long name "Expense Tracker".

Expense also publishes a deep-link helper to Transactions with one group pre-opened (used by
the Meta Data cards). The grouping and group key travel in the URL, so the result is a real
bookmarkable address — but it targets the Transactions section above, not a separate node.

| Section | Slug | Icon | Href | Description |
|---|---|---|---|---|
| Home screen | `main` | `grid` | `/modules/expense` | At-a-glance totals and what still needs your attention. |
| Transactions | `transactions` | `list` | `/modules/expense/transactions` | Browse, search and edit every transaction, or add one by hand. |
| Meta Data | `meta-data` | `database` | `/modules/expense/meta-data` | The credit cards, categories and rule types everything else refers to. |
| Charts and Analysis | `charts` | `chart` | `/modules/expense/charts` | Where the money went, by category — and how this month compares to last. |
| Import Transaction | `import` | `upload` | `/modules/expense/import` | Bring in statement CSVs. The rules that tidy them up live in Transaction Rules. |
| Transaction Rules | `transaction-rules` | `clip` | `/modules/expense/transaction-rules` | The post-import rules that fill in vendor, category, status and notes. |
| Settings | `settings` | `sliders` | `/modules/expense/settings` | Automatic import folder and how often it runs. |

## Classroom — `/modules/classroom`

Attendance registers and exams. Icon `roster`, sequence 6.

Was **Attendance** until migration 0143, which renamed the module and moved the prefix
`att_` → `cls_`. Its sections carry both the attendance registers and the exam screens;
`CLASSROOM_ATTENDANCE_SECTIONS` and `CLASSROOM_EXAM_SECTIONS` split them for the screens
that need one half, while the tree shows the one flat list below.

| Section | Slug | Icon | Href | Description |
|---|---|---|---|---|
| Home screen | `main` | `grid` | `/modules/classroom` | Pick a class and take today's attendance. |
| Rosters | `rosters` | `users` | `/modules/classroom/rosters` | Add students and enroll them into a class. |
| Classes | `classes` | `classroom` | `/modules/classroom/classes` | Create classes and manage who is in them. |
| Student actions | `actions` | `sliders` | `/modules/classroom/actions` | The list of things you can note about a student on the day. |
| Edit records | `edit` | `pencil` | `/modules/classroom/edit` | Open a past day's register and correct it. |
| Report | `report` | `chart` | `/modules/classroom/report` | Print a class's attendance for a day. |
| Configuration | `configuration` | `gear` | `/modules/classroom/configuration` | Preferences for how attendance works. |
| Exams | `exam` | `clipboard` | `/modules/classroom/exam` | Every exam you have built, ready to edit or print. |
| Exam Maker | `exam-maker` | `note` | `/modules/classroom/exam-maker` | Create an exam and record its answer key. |
| Grader | `exam-grader` | `magic` | `/modules/classroom/exam-grader` | Scan completed answer sheets and grade them against the key. |

## Music Library — `/modules/music-library`

Browse and stream your music collection. Icon `music`, sequence 7. Long name "My Music Library".

| Section | Slug | Icon | Href | Description |
|---|---|---|---|---|
| Library | `main` | `grid` | `/modules/music-library` | Browse and search everything in the catalog. |
| Magic Playlist | `magic` | `magic` | `/modules/music-library/magic` | Pick genres, artists and a length; get a random playlist that fits. |
| Player | `player` | `player` | `/modules/music-library/player` | The current track, with artwork and lyrics. |
| Queue | `queue` | `list` | `/modules/music-library/queue` | What is lined up next. Reorder it, shuffle it, or take tracks out. |
| Scan Music | `scan` | `upload` | `/modules/music-library/scan` | Pick a folder on the NAS and catalog what is in it. |
| Configuration | `configuration` | `gear` | `/modules/music-library/configuration` | Which file formats to include when scanning. |

## Games — `/modules/games`

Play a quick game and keep a high-score board. Icon `game`, sequence 8. Long name "Games & Puzzles".

Individual games are launched from the Arcade screen, not from navigation — they are not
tree nodes.

| Section | Slug | Icon | Href | Description |
|---|---|---|---|---|
| Arcade | `main` | `grid` | `/modules/games` | Pick a game and play. |
| Scores | `scores` | `chart` | `/modules/games/scores` | The shared high-score board across every game. |
| Configuration | `configuration` | `gear` | `/modules/games/configuration` | How the Games module behaves. |

## Picture Gallery — `/modules/picture-gallery`

Browse the photo archive and the pictures you have kept. Icon `photo`, sequence 9. Long name "My Picture Gallery".

Section files are named `gallery-*`.

| Section | Slug | Icon | Href | Description |
|---|---|---|---|---|
| Home screen | `main` | `photo` | `/modules/picture-gallery` | A photograph drawn at random from the archive, redrawn whenever you ask. |
| Favorite photos | `favorites` | `heart-filled` | `/modules/picture-gallery/favorites` | The photographs you've kept. Watch them as a slideshow, or download a few. |
| Albums | `albums` | `album` | `/modules/picture-gallery/albums` | Collections you've put together. Play one as a slideshow, or export every picture in it. |
| Magic List | `magic-list` | `magic` | `/modules/picture-gallery/magic-list` | Conjure a set of photographs from the archive by date, size and resolution — then play it, export it, or keep it as an album. |

## Tools — `/modules/tools`

This module list all the utilities and tools Icon `tool`, sequence 10. Long name "Tools & Utilities".

The lists the TODO section works from are administered at Administration → TODO Lists
(`/admin/todo`) — same subject, two screens, which is why they share the `clipboard` icon.

| Section | Slug | Icon | Href | Description |
|---|---|---|---|---|
| Dashboard | `main` | `grid` | `/modules/tools` | The utilities and tools available here. |
| TODO Lists | `todo` | `clipboard` | `/modules/tools/todo` | The household's shared lists of things to do. |
| SQLite File Browser | `sqlite-browser` | `database` | `/modules/tools/sqlite-browser` | Upload a SQLite file and browse, filter and delete the rows inside it. |
| CSV File Browser | `csv-browser` | `csv-file` | `/modules/tools/csv-browser` | Upload a CSV or text file and browse, filter, edit and delete the rows in it. |

## Household — `/modules/household`

Recipes, receipts and the HSA — the household's paperwork. Icon `household`, sequence 11.

Household is the other grouped module: `HOUSEHOLD_GROUP_LABELS` flattens two halves the
same way Journal's three are flattened.

| Section | Slug | Icon | Href | Description |
|---|---|---|---|---|
| Home screen | `main` | `grid` | `/modules/household` | What the household keeps track of here. |
| Recipes | `recipes` | `list` | `/modules/household/recipes` | The recipe box — what to cook, and how you made it last time. |
| Import | `recipes-import` | `upload` | `/modules/household/recipes-import` | Bring recipes in from a CSV, mapping its columns onto the recipe fields. |
| Receipts | `hsa` | `clipboard` | `/modules/household/hsa` | Every HSA expense, its receipt, and whether it has been reimbursed. |
| Configuration | `configuration` | `gear` | `/modules/household/configuration` | Where HSA receipts are filed, and the cards offered in Paid with. |

## Clips — `/modules/clips`

Rich-text notes with tags and pasted images, linkable to a journal entry. Icon `folder`, sequence 12.

The home screen **is** the module: it absorbed the old All Clips section, so writing,
filtering and editing all happen at `/modules/clips`.

| Section | Slug | Icon | Href | Description |
|---|---|---|---|---|
| Home screen | `main` | `grid` | `/modules/clips` | Every clip — write one, filter them, pin what matters. |
| Categories & Tags | `metadata` | `list` | `/modules/clips/metadata` | The two lists a clip is filed under, and their icons. |
| Recycled Clips | `recycled` | `trash` | `/modules/clips/recycled` | Deleted clips, kept until you empty the bin. Restore one, or remove it for good. |
| Configuration | `configuration` | `gear` | `/modules/clips/configuration` | How Clips behaves. |

## Documents — `/modules/documents`

Filed documents with categories, tags and their attachment files. Icon `folder`, sequence 13. Long name "Document Library".

Seven sections and deliberately **flat**: grouping them would cost a level of nesting to
organise seven rows that already fit on screen. `new` and `edit` are absent on purpose —
they are where the editor opens, not destinations, so they carry no nav row and no icon
slot.

| Section | Slug | Icon | Href | Description |
|---|---|---|---|---|
| Home screen | `main` | `grid` | `/modules/documents` | Every document — file one, filter them, open what you need. |
| Document Tree | `tree` | `network` | `/modules/documents/tree` | Browse by category, narrow by tag, and read a document beside the list. |
| Keywords | `keywords` | `search` | `/modules/documents/keywords` | The words your documents actually contain, ranked — pick one to see them. |
| Categories & Tags | `metadata` | `list` | `/modules/documents/metadata` | The two lists a document is filed under, and their icons. |
| Prefill Templates | `templates` | `copy` | `/modules/documents/templates` | Named sets of field values a new document can start from. |
| Recycled Documents | `recycled` | `trash` | `/modules/documents/recycled` | Deleted documents — restore one, or remove it for good. |
| Configuration | `configuration` | `gear` | `/modules/documents/configuration` | Where the files are kept, and what the Document Library allows. |

## Administration — `/admin`

Users, modules, appearance and diagnostics. Icon `shield`.

**Not a module** — it has no `sys_modules` row, so `buildNavigationTree` cannot produce it
from the module list. It is declared as `ADMIN_TREE_MODULE` and appended by `NavTree`.

`Configuration`, `Display Settings` and `Locations` are **pure headings with no route of their own**;
their boxes render an unclickable header. `Daily Quote` is the one group heading that also
has its own page, which is why `All Quotes` exists as an explicit child — a group heading
in `SectionPanel` renders as a disclosure button and drops its href, so without that child
the listing was reachable only from the home dashboard's Daily Quote widget.

| Node | Group | Href | Description |
|---|---|---|---|
| Module Configuration | Configuration | `/admin/configuration/modules` | Configuration of modules in the application |
| Application Configuration | Configuration | `/admin/configuration/application` | General settings that apply across the application |
| Backup Data | Configuration | `/admin/configuration/backup` | Where attachment files and database archives are backed up to |
| Color Themes | Display Settings | `/admin/configuration/themes` | Change color theme for the application |
| Icons | Display Settings | `/admin/configuration/icons` | Change the module icon set for the application |
| Script Fonts | Display Settings | `/admin/display-settings/script-fonts` | Choose the handwriting for the Daily Quote and for Journal entries |
| App Texture | Display Settings | `/admin/configuration/texture` | Set an optional background picture for the home dashboard |
| Dashboard Widgets | Display Settings | `/admin/display-settings/widgets` | Choose which cards the home screen shows, and in what order |
| Floating Components | Display Settings | `/admin/display-settings/floating` | Choose which components may float over the application |
| Personal Toolbars | Display Settings | `/admin/display-settings/toolbars` | Add bars of shortcuts docked to the edge of the screen |
| Menu Items | Display Settings | `/admin/display-settings/menu-items` | Rename any screen in the application, or change the description under it |
| Card Frames | Display Settings | `/admin/display-settings/card-frames` | Use a picture as the border and background of a card |
| Border Weight | Display Settings | `/admin/display-settings/borders` | Set how thick the application's borders are drawn |
| Chrome Style | Display Settings | `/admin/display-settings/chrome` | Set the border treatment for the header and the navigation tree |
| Scratchpad Categories | Display Settings | `/admin/display-settings/scratchpad` | Set the tabs the Scratchpad shows, for everyone |
| User Management | — | `/admin/user-management` | Manage users, roles, and module access |
| All Quotes | Daily Quote | `/admin/daily-quote` | Browse, edit and delete every quote in the collection |
| Add Quote | Daily Quote | `/admin/daily-quote/add` | Add a single quote by hand |
| Import from Newsletter | Daily Quote | `/admin/daily-quote/import` | Paste a 3-2-1 issue and import the quotes it contains |
| TODO Lists | — | `/admin/todo` | Add, rename, reorder and remove the household's TODO lists |
| Location Manager | Locations | `/admin/locations/manager` | Saved places you can pick from across the application |
| Location Meta Data | Locations | `/admin/locations/metadata` | Categories and tags for places -- what a place *is* |
| System Messages | — | `/admin/system-messages` | Sign-ins, what the application logged, and the message queue |
| Background Tasks | — | `/admin/background-tasks` | What the server runs on a timer, and when each job last ran |
| SQL Explorer | — | `/admin/sql-explorer` | Run read-only or ad-hoc SQL against the application database |
| About | — | `/admin/about` | Version, system information, and the project's change log |

Two Administration routes exist that are **not** tree nodes, reached from within a screen:

| Route | Reached from | What it is |
|---|---|---|
| `/admin` | The Administration heading itself | The admin landing page. |
| `/admin/user-management/preferences/[userId]` | A row on User Management | One user's preferences, per user. |

### Three retired menu items, kept addressable

Security, System Log and Message Queue were three Administration screens until they
folded into the three tabs of **System Messages**. Their nav nodes are gone, but their
menu item ids are not — a menu item id is permanent once shipped, and a personal
toolbar row saved against one still points at it. They are re-emitted as aliases in
[menu-item-source.ts](src/app/(protected)/menu-item-source.ts) (`RETIRED_ADMIN_MENU_ITEMS`),
each pointing at the tab that replaced it:

| Menu item id | Now points at |
|---|---|
| `admin_section_security` | `/admin/system-messages?tab=security` |
| `admin_section_system_log` | `/admin/system-messages?tab=system-log` |
| `admin_section_messages` | `/admin/system-messages?tab=messages` |

They appear in the menu item picker but draw **no** second entry in the tree or the
section panel — they are not in `adminNav`. The three old routes also survive as
redirects onto the same tabs, so an old bookmark still lands somewhere sensible.

**Nothing should be added to that list for a new screen.** An entry earns its place
there only by having shipped as a nav node first.

## The three ids you must never rename

Three kinds of id in this table are **permanent once shipped**, because something
persisted derives from them:

1. **Section slugs** — `SectionPanel` derives each section's icon slot id from the slug
   (e.g. `journal_section_templates`), so renaming a slug orphans any uploaded icon override.
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

**It had drifted badly once already**, and that is the reason to keep it honest rather
than to trust it: it sat at ten modules and 53 section nodes while the code carried
twelve and 80, missing Clips and the whole Document Library. A reader checking a slug
against it would have been told it did not exist.

**Rebuilding it beats editing it.** The tables below the *Top level* heading are
mechanical — label, slug, icon, href and hint all come straight off
`moduleSectionSource.sectionsFor(slug)`, `DEFAULT_MODULES` and `adminNav`. A short
`tsx` script that imports `module-sections.ts` and prints them as markdown reproduces
every row, and is how this version was made; what it cannot produce is the prose under
each heading, which is why that is worth writing carefully and the tables are not.
