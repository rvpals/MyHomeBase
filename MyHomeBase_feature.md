# MyHomeBase — Features

A catalogue of what this application does, organised by module, compiled from the
project's git history (198 commits, 2026-07-12 to 2026-10-21) and `CHANGE_HISTORY.md`.

Sections below follow each module's live navigation. For the dated record of *when*
something shipped, read **Admin → About → Change History**; this document answers
*what exists* rather than *what changed*.

## Platform

The shell, the chrome and the services every module sits on.

### Navigation and layout

- **One 260px tree on the desktop** (`NavTree`) carrying Home, every module and every
  section, above a filter box that searches across all modules at once. Groups expand
  and collapse, with expand-all / collapse-all, and the whole tree can fold to a strip.
- **A two-tier bottom bar on a phone** (`SectionPanel`) — modules on one tier, the
  current module's sections on the other. The two layouts are deliberately different
  shapes rather than one responsive compromise.
- **One layout boundary at 1024px**, decided on the server so the first paint is right.
- **Breadcrumbs**, section groups whose heading is a page in its own right, and a
  section panel that reads as cards.
- Per-user **compact navigation styles** — the reader picks which one they get.

### Home screen

- **Arrangeable cards**: each person chooses which cards appear and in what order.
  Cards are closable, and a card's title launches its module.
- **Built-in cards** — Random Photo (drawn from the archive, captioned with the photo's
  age), Clock with local weather, a handwritten Daily Quote, My Shortcuts, Daily Glance,
  journal search, Pinned and Recently Edited entries, TODO lists, and per-module cards.
- **Module carousel**: a grid on desktop, coverflow on phones, with per-module artwork.
- **Deployment announcements** and one-shot startup notices.

### Appearance

- **Colour themes as data** — several built in, a builder for your own (which warns
  before you make text unreadable), and random theme generation.
- **Icon sets**, uploadable module icons, and uploaded icons for category/tag taxonomies.
  Icons that mark a *place* go through registered slots, so an upload survives a redesign.
- **A library of background textures**, scoped app-wide or per module.
- **Script fonts**, **Card Frames**, **Border Weight**, **Chrome Style**, and elevation
  classes shared by nav bars and cards.

### The floating layer

Windows that float over every page rather than in it: a **clock**, a **calculator** and
a **scratchpad** (with categories). Each puck can be dragged out of its corner and put
back from the Account screen, and the list is registered through a closed list so a
new one can't invent its own `fixed` bar.

### Personal toolbars

Per-person toolbars with drag-to-arrange buttons, textures, and menu-item overrides. A bar
can be docked to an edge or **floating** over the page, where each reader drags it to
their own spot and can reset it from the Account screen.

### Platform services

- **Messages / message queue** — the app can tell you something after the fact.
  Messages carry ownership and locking.
- **Background tasks**: a scheduler with run history, a data-backup job on a flexible
  cadence, and a Hello-world job for proving the heartbeat.
- **Installable PWA** — stable identity, module shortcuts, iOS launch screens, and a
  cache-clear button for a phone stuck on an old build.
- **Charts** everywhere carry their own display controls, full-screen, and phone-sized
  zoom.
- **DataGrid** — search, filter expressions, column aggregates, sticky headers, column
  control, row selection, record view, export, and a compact one-card-per-row layout
  for reading rather than scanning.

### Accounts and security

- Sign-in with **Google**, self-signup with hidden admin elevation, user avatars.
- **Every exported server action authorises on its first line.**
- **Sign-in audit log**, visit signals with a stated reason for each flag, and an
  **IP blacklist**.
- Per-user preferences, including a favourite module to open on startup.

## Investments

Formerly *Stocks & ETFs*. Ten sections covering holdings, trading history and analysis.

### Dashboard

Choosable, re-orderable widgets — **Portfolio Summary** (whose total climbs as prices
land), **Daily Glance**, **Refresh All**, a **market indexes board** with per-index icons
that opens into a detail panel, **Biggest Changes** and **Volatility**.

### Positions and Transactions

- Positions **split by instrument type** — Stocks / ETF / Others — with cost basis,
  identifiers and an owning account.
- A transaction records its **brokerage firm** and broker reference, knows **which
  account** it belongs to, and **a recorded trade can update the holding**.
- **Daily portfolio snapshots**, and playback of portfolio history as an animation.
- **Foreign currencies**.

### Analysis

- **Ticker viewer** — everything about one symbol in one full-screen dialog: today's
  session, candlesticks, per-ticker news, **Events** (what actually moved the price),
  and **My past performance** (your trades against the market around them).
- **Yahoo Finance Detail** — six sections in one request.
- **Account Performance Over Time** — every account on one set of axes.
- **Tax Lots** and the **Tax Lot Portfolio Analyzer**.
- **Sector allocation**, and cached risk that only *Recalculate* refreshes.

### Watch & Test

- **Watch lists** — tell me when a ticker you *don't* own does something.
- **Monitors** — tell me when a holding gets close to a number, with a **Popup** option.
- Signals and simulation on one screen; **"what if I'd bought then?"**.

### Export for AI Analysis

The portfolio as a prompt, including measured correlations and the sectors you hold
nothing in. Also **consult AI about one ticker**, and analyse several tickers at once.

### CSV Import

Broker CSV import that **remembers which account a label means**, with duplicate
detection and ticker logos cached per symbol.

## Journal

The largest module — fifteen sections.

### Writing

- **Entry authoring** with GPS and weather captured at write time, a template
  suggestion dated by the local calendar, and photographs attached to an entry.
- **Pin** an entry; **lock** it; **encrypt** it.
- **Entry screen preferences** — the Content field can sit on a texture from the app
  library at a strength you tune, and its text can take a colour of your choosing (the
  theme's own ink by default). Configuration is split into Location, general and
  entry-screen cards.
- **Calendar** view with per-day entry lists, Delete (to the recycle bin) from the day
  list, and **jump to the next day that has an entry**.

### Entries

Tabs for **All Entries**, **Unlocked Entries**, **Substantial Entries** (body past ten
words) and **Log**, with a **Filtering card** of saved filters that carry a category and
a description. **Bulk tools** — Lock / Unlock / Encrypt, delete, merge — and a grid
status bar.

### Locations

- **Application-wide saved locations** with street addresses on entry pins, map pins
  that open popups, and an external-map link.
- A **location library built out of the journal you already wrote**, with real-distance
  duplicate detection.
- Categories and tags that carry icons.

### Views, Report and Review Data

Counts by years and months, **Journal Reports**, a Log-only lens, and a review screen
for existing entries.

### Import

- **CSV Import** — idempotent, with an overwrite mode that shows the plan before it writes.
- **Calendar Import** — a Google or Outlook `.ics` becomes journal entries, with review
  before import and duplicate handling.

### Data management

**Recycle bin** with a Correct tab, **metadata backup and restore**, templates,
preferences, and a **Home screen layout** section choosing the module's own cards.

## Classroom

Attendance and exams, as two section groups.

### Attendance

Take the register on a phone. **One register per class per day** (originally two), with
rosters, classes, **student actions** (each with an uploadable icon), labels on the local
clock, bigger cards in the register grid, a **printable attendance grid**, edit-records
and report screens. The home screen opens on today's class.

### Exam

**Exam Maker** and **Grader**, with **QR diagnostics**.

## CSV Analysis

Import a CSV and analyse it.

- **Import Files** — drop many at once, automatic import from a folder, append or
  truncate, and **custom columns added without re-importing**.
- **Compare** across pooled datasets, and a dashboard chart that **splits by source**.
- **Custom Views** — named views over a dataset.
- **Chart builder** with presets and aggregate functions drawn boldly.
- **Bulk row edit**, with a CLI for it.

## Expense

Credit-card spending by category.

- **Dashboard** with "Interesting stats" and top-5 cards that link through.
- **Transactions** grouped by billing cycle, with editable rows.
- **Transaction Rules** grouped by type, re-runnable over transactions already imported,
  each saying *why* it matched (the wildcard is `%`).
- **Automatic CSV import** from a folder, with post-import processing.
- **Vendors** as entities rather than totals, with fetched icons, and **category icons**.

## Music Library

Stream ~20,000 songs off the NAS.

- **Library** and an **Albums** view; a visible **play queue**; **Magic Playlists**.
- **Player** with a spectrum analyser under the cover art, a **Lyrics / Story** tab pair
  (lyrics read from the file's own tags before going online), the song on **YouTube**,
  a real fullscreen visualizer, a **sleep timer**, background artwork, and playlist
  reordering from the track list.
- **Scan Music** with a progress bar and a scan that finishes.

## Games

An arcade with a scoreboard the whole house shares: **2048**, **Arrow Clearing** (a
puzzle that cannot generate an unsolvable board, with difficulty tiers), **Tetris**,
**Sudoku**, **Blackjack**, **Minesweeper**, **Mahjong Match**, **Mahjong** (four-player,
against three bots), **Pac-Man** and **Bridge**.

## Picture Gallery

- **Home screen** browsing of the photo archive, which is read-only by design.
- **One photo viewer everywhere**, with capture timestamp, location, a favourite heart
  and a `+` menu on every photograph.
- **Albums**, **Favorite photos** with their own screen, a slideshow and a zip download.
- **Magic List** — photographs conjured from a description.
- **Culling** — rank a folder's photographs by sharpness, exposure and contrast, collapse
  near-duplicates to one keeper, and dim what was set aside. Available on Magic List,
  Albums, Favorite photos, the photo viewer and a journal entry's photo dialog, and from
  the CLI. Read-only: nothing is ever deleted or moved.
- Keep or file a photo from a journal entry.

## Tools

- **TODO Lists**, with a home-screen card.
- **SQLite File Browser** and **CSV File Browser**, with a configurable upload cap
  (default 1 GB).

## Household

- **Recipes** — tabs, record view, picture resize, and an import.
- **Receipts** — multi-file HSA receipts.
- **HSA Tracker**.

## Admin

- **Configuration** — module and application configuration (including the photo-culling
  ceiling), **Backup Data**.
- **Display Settings** — Color Themes, Icons (tabbed), Script Fonts, App Texture,
  Dashboard Widgets, Floating Components, Personal Toolbars, Menu Items, Card Frames,
  Border Weight, Chrome Style, Scratchpad Categories.
- **User Management** — admin-only, including setting another user's avatar and editing
  anyone's preferences.
- **Daily Quote** — all quotes, add a quote, import from a newsletter.
- **Locations** — Location Manager with Venn and Graph views, bulk location edit, and
  location metadata.
- **Security** — Login and Visit tabs, IP blacklist.
- **Background Tasks** and **Message Queue** (readable, deletable, purgeable).
- **SQL Explorer** — schema browser with prose for every table, tables grouped by
  module, BLOB cells fetched on demand, saved statements, table-name suggestions, a
  Table Usage tab, and a Truncate button behind a row-counting warning.
- **About** — application and system info, memory meters, database files, environment
  variables, deployment history with build logs, Change History, and this feature list.

## Operations

- **Deploys to a Synology NAS** (ARM), self-migrating, with a deployment history that
  carries the build log, bulk delete and prune.
- **Backups** of the production database taken by a Node script before a release.
- **A verification gate**: typecheck, lint, library boundary, unit tests, a migration
  dry-run against a copy, and a browser smoke test.
- **A CLI** mirroring the web app — every use-case is callable from both.
