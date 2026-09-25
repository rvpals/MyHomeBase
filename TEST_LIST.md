# Test list

Everything built in MyHomeBase, newest first, so the things most likely to need
a look are at the top.

**Why this file exists.** Uncommitted work in the tree carries no proof anyone
ever saw it on screen, and across sessions there is no memory of what was
checked (`CLAUDE.md` → *Report done honestly*). A commit records that something
was *written*; this file records that it was *tried*.

## How to mark an item

```markdown
- [x] Expense: Transaction Rule Types  — tested 2026-09-23
- [x] Security: suspicion signals on a visit
- [x] Journal: saved-location library  — 2026-09-23, map pin lands offshore
```

- `[ ]` not looked at yet
- `[x]` works — add the date you checked it
- `[~]` partly working or broken — add the date and one line on what's wrong

Dates are the date the work was **built** (its commit date), not the date it was
tested. Unticked items below are not known to be broken; most shipped long ago
and are in daily use. They are unticked because nothing here has been formally
walked through yet.

Items are one *testable behaviour* each, not one per commit — a commit that
landed five features is five lines. Pure-infrastructure commits (doc catch-ups,
changelog entries, lint fixes) are omitted: nothing to click.

---

## 2026-09-25 — Release (navigation tree)

**No migration.** The remembered expanded set is a new key in the existing
`sys_user_preferences` table, so nothing schema-level shipped here.

**This release replaces the navigation on every desktop screen in the app**, so
item 1 is the one that matters: if `NavTree` fails to render, every page behind
the login goes with it. Check that first and the rest afterwards.

Items 1–6 are desktop-only by design. Item 7 is the counterpart and is arguably
the more important check of the two — the phone was deliberately left alone, so
the test is that nothing about it *changed*. Item 8 needs two devices, or one
device and a logout, to prove the preference is stored per person rather than in
that browser.

- [ ] **1.** Every module and Admin: the left column is one tree — Home on top, each module a heading that expands to its sections
- [ ] **2.** The tree: clicking a module heading expands and collapses it; the module you are currently in is always open
- [ ] **3.** Filter: typing `import` finds Journal, Investments and Expense sections together, each labelled with its module
- [ ] **4.** Filter: matches starting with what you typed rank first; Esc clears; clearing restores the collapse state you had
- [ ] **5.** Collapse: `«` folds the tree to a thin strip and the content widens; the strip and the header's `»` both reopen it
- [ ] **6.** Icons: Admin → Display Settings → Icons can replace the tree's Home and filter glyphs, and each module's section icons still resolve
- [ ] **7.** Phone: the bottom bar and its sheet behave exactly as before — no tree, no strip, nothing new
- [ ] **8.** The set of expanded modules survives a reload, and is remembered per user rather than per browser

---

## 2026-09-25 — Release

Migration 0112 (`sys_saved_sql_queries`) was applied on the NAS during this
release's publish. If items 8–10 ever report "no such table", that is the thing to
re-check before reading anything else here as a bug.

Item 11 costs live provider calls on every expand, so it can only really be judged
during market hours; item 13 needs a file whose tags actually carry lyrics, which
not every track in the library has. Item 15 is phone-relevant — the expanded index
panel adds six figures and a sparkline to a row that was already tight.

- [ ] **8.** Admin → SQL Explorer → SQL Query: save a statement with a name, description and tags; it appears on the Saved SQL card
- [ ] **9.** Admin → SQL Explorer: Load fills the editor and does **not** execute — confirm with a statement you would not want run
- [ ] **10.** Admin → SQL Explorer: saving under an existing name replaces that row, and the dialog warns before it does
- [ ] **11.** Investments → Indexes card: a row expands to show day range, 52-week range with its marker, moving averages, one-year change, all-time high and a sparkline
- [ ] **12.** Investments → Indexes card: a symbol whose second pass fails keeps its row and shows em-dashes (the three commodity futures have no one-year change)
- [ ] **13.** Music: a track with embedded lyrics shows them attributed "From this file's own tags", without a network lookup
- [ ] **14.** Music: a track with no embedded and no lrclib match offers the Google search link
- [ ] **15.** Investments → Indexes card: the expanded panel and sparkline are readable on a phone
- [ ] **16.** Admin → Daily Quote → All Quotes: the new nav entry opens the listing screen
- [ ] **17.** CLI: `saved-sql list` / `show` / `save` / `delete` behave as documented

---

## 2026-09-24 — Release

No new migrations: 0109–0111 shipped with the previous release and are already
applied on the NAS. Item 21 is the one to watch — the dedup rule changed, so a
scan that used to return nothing may now return groups, and blank-named places
can group on distance alone. Items 23 and 22 are phone-relevant: the popup and the
picker's refusal message both have to be readable narrow.

- [ ] **18.** Admin → Message Queue: the screen lists read and unread together, newest first, with each message's source
- [ ] **19.** Admin → Message Queue: tick rows and Delete removes them; Purge by age (7/30/90/365 days) clears everything older and keeps the rest
- [ ] **20.** Journal → Merging & Dedup: the "Within" slider (10–500m, default 75m) rescans on release, and groups found by distance are labelled "proximity"
- [ ] **21.** Journal → Merging & Dedup: two pins ~25–50m apart with similar names now group (they did not before); merging one still works
- [ ] **22.** Journal → entry form: adding a location already on the entry is refused with a message, and the draft pin stays put — from both the map tab and the library tab
- [ ] **23.** Journal: clicking a numbered map pin opens a popup with number, name, address, coordinates and chips, readable in the dark theme
- [ ] **24.** Journal: a single entry page shows the module rail, section panel and header (no more bare page with a "Back to My Journal" link)

---

## 2026-09-23 — Release

Migrations 0106, 0107 and 0108 are applied on the NAS. The Investments rename
touched ~83 files and renamed 17 tables, so the items below are worth a walk
through even where the screen looks unchanged — a missed server action throws
only when that one feature is used, not when the page loads.

- [ ] **25.** Investments: the module opens at /modules/investments, named Investments on the rail and home grid
- [ ] **26.** Investments: every section loads — Dashboard, Positions, Transactions, Account Performance, Watch & Test, Chart & Analysis, CSV Import, Tax Lots, Export for AI Analysis, Settings
- [ ] **27.** Investments: the actions still write — add/edit a position, a transaction, a watchlist entry, an account
- [ ] **28.** Investments: Tax Lots deep links still resolve (ticker picker, and the links out of the positions grid)
- [ ] **29.** Investments: CSV import of a broker file
- [ ] **30.** Admin → SQL Explorer: the Investments group lists the inv_ tables, and Table References names them
- [ ] **31.** Admin → Background Tasks: the Investments auto-refresh still finds its module
- [ ] **32.** Home: the Daily Glance card renders and its "Launch Investments" link goes to the new URL
- [ ] **33.** Investments: uploaded section/card icons survived the rename (slot ids were deliberately left on `stock_*`)
- [x] **34.** Expense: Transaction Rule Types — group rules by type, filter the rules list, manage types in Meta Data  — tested 2026-09-23
- [x] **35.** Security → Visits: why a visit was scored suspicious (signals on the row)

---

## 2026-09-22 — Release

- [x] **36.** CSV Analysis: pooled datasets
- [x] **37.** Admin-set preferences (allow edit user's preferences)
- [x] **38.** Location icons

## 2026-09-20

- [x] **39.** Journal: filter the category and tag lists in Meta Data
- [x] **40.** Journal: a saved-location library
- [x] **41.** Journal: Entries as one screen with two tabs
- [x] **42.** Tools: a CSV file browser beside the SQLite one

## 2026-09-19

- [x] **43.** Journal: keep or file a photo from an entry
- [x] **44.** TreeNav: each group reads as its own embossed card
- [x] **45.** Tools: SQLite uploads over 4 MB, with an admin-set cap
- [ ] **46.** Stocks: icons on the indexes board
- [ ] **47.** Stocks: playback of portfolio history
- [ ] **48.** Music: a sleep timer that stops the player after a set time

## 2026-09-17

- [ ] **49.** Home screen: launch a card's module from its title
- [ ] **50.** Journal: review existing entries before importing from a calendar
- [ ] **51.** Tools: a new module, opening with a SQLite file browser

## 2026-09-15

- [ ] **52.** Floating layer: a clock over every page
- [ ] **53.** Floating layer: a calculator over every page
- [ ] **54.** Floating layer: a scratchpad over every page
- [ ] **55.** Stocks: the indexes board loads when you open the card
- [ ] **56.** Admin: clear deployment records in bulk, or prune to the newest few
- [ ] **57.** Journal: jump to the next day that has an entry
- [ ] **58.** NAS: a startup crash that says what broke

## 2026-09-14

- [ ] **59.** Journal: date the template suggestion by the local calendar
- [ ] **60.** Themes: tell the browser a dark theme is dark
- [ ] **61.** Export for AI: measured correlations, and the sectors you hold nothing in
- [ ] **62.** Home: a Clock card, with the weather where you are
- [ ] **63.** Picture Gallery: Magic List — photographs conjured from a description
- [ ] **64.** Stocks: candlesticks in the ticker viewer's Today card
- [ ] **65.** Stocks: consult AI about one ticker
- [ ] **66.** Stocks: a transaction knows which account it belongs to

## 2026-09-13

- [ ] **67.** Attendance: bigger cards in the register grid
- [ ] **68.** Admin: random theme generation
- [ ] **69.** Music Library: an Albums view
- [ ] **70.** Stocks & ETFs: a recorded trade can update the holding
- [ ] **71.** MyJournal: New Entry becomes a section
- [ ] **72.** Games: Bridge
- [ ] **73.** SQL Explorer: BLOB cells fetched on demand
- [ ] **74.** SQL Explorer: tables grouped by module
- [ ] **75.** Account: two compact navigation styles, and the reader picks
- [ ] **76.** Icon names: the compiler catches glyph-table drift

## 2026-09-11

- [ ] **77.** Journal: Calendar Import — read a Google/Outlook .ics and pick events to import
- [ ] **78.** Journal: re-importing a renamed or moved event updates it instead of duplicating
- [ ] **79.** Journal: a large .ics (2.4 MB) uploads without tripping the action-argument limit
- [ ] **80.** Journal: restoring an imported entry from the recycle bin keeps its identity
- [ ] **81.** Stocks: a portfolio brief for an LLM
- [ ] **82.** Attendance: one register per class per day again
- [ ] **83.** Attendance: session labels read in local time, not four hours ahead

## 2026-09-10

- [ ] **84.** Picture Gallery: albums
- [ ] **85.** Picture Gallery: a + on every photograph
- [ ] **86.** Home screen: a handwritten quote, no header, and a slimmer rail

## 2026-09-09

- [ ] **87.** Security: every exported server action authorises on its first line
- [ ] **88.** Stocks & ETFs: analyze several tickers at once, and link to an analysis
- [ ] **89.** Music Library: the song on YouTube
- [ ] **90.** Music Library: a real fullscreen visualizer
- [ ] **91.** Picture Gallery: a module of its own, not a corner of the home screen

## 2026-09-08

- [ ] **92.** Games: Mahjong pickers and board frame
- [ ] **93.** Stocks & ETFs: today's session in the ticker viewer
- [ ] **94.** Journal: a space-separated Tags column no longer imports as one long tag
- [ ] **95.** CSV Analytics: bulk edit rows
- [ ] **96.** CSV Analytics: a CLI for bulk edit
- [ ] **97.** Photographs: one viewer, with a capture timestamp and a heart

## 2026-09-06 — Release

- [ ] **98.** Games: Mahjong, the four-player game against three bots
- [ ] **99.** Stocks & ETFs: the Tax Lot Portfolio Analyzer
- [ ] **100.** About: count untagged changes instead of reporting zero
- [ ] **101.** Home: the Random Photo card streams instead of blocking first paint
- [ ] **102.** Photos: an absolute path can no longer escape the photo folder
- [ ] **103.** Compact grids: long values are readable
- [ ] **104.** Compact grids: a second layout for reading
- [ ] **105.** Music: the story behind the song, beside the lyrics
- [ ] **106.** Games: Mahjong Match
- [ ] **107.** Games: card icons across the whole arcade
- [ ] **108.** Attendance: upload your own icon for a student action
- [ ] **109.** CSV Analysis: named views over a dataset

## 2026-09-03

- [ ] **110.** Attendance: a class records the weekday it meets on
- [ ] **111.** Attendance: the home screen opens on today's register
- [ ] **112.** Photos: a viewer component with its own actions
- [ ] **113.** Journal: a photos slideshow and folder module
- [ ] **114.** Games: sudoku and blackjack polish
- [ ] **115.** Stocks: the refresh total counts up as prices land

## 2026-09-02 — Release

- [ ] **116.** Expense: top-5 cards link through to their transactions
- [ ] **117.** Expense: the vendor rollup stops inventing vendors from payment lines
- [ ] **118.** Stocks: the indexes refresh becomes an icon
- [ ] **119.** Favourite photos: a slideshow
- [ ] **120.** Carousel graphics are resized on upload
- [ ] **121.** SQL Explorer: a schema browser
- [ ] **122.** SQL Explorer: prose for every table
- [ ] **123.** Music: a spectrum analyser under the cover art
- [ ] **124.** Games: Sudoku
- [ ] **125.** Games: Blackjack
- [ ] **126.** Games: Minesweeper
- [ ] **127.** Journal: a recycle bin
- [ ] **128.** Journal: a Correct tab
- [ ] **129.** Journal: metadata backup

## 2026-09-01 — Release

- [ ] **130.** Journal import: an overwrite mode, with the plan shown before it writes
- [ ] **131.** Favourite photos: their own screen
- [ ] **132.** Favourite photos: a zip download
- [ ] **133.** Admin: a deployment history, with the build log attached
- [ ] **134.** Games: Tetris
- [ ] **135.** Games: Arrow Clearing becomes an actual puzzle
- [ ] **136.** SQL Explorer: a Truncate button, behind a warning that counts the rows
- [ ] **137.** Journal import: normalized entry time stops a re-import duplicating

## 2026-08-30

- [ ] **138.** Themes: colour themes are data, and the builder warns before you blind yourself
- [ ] **139.** Games: Arrow Clearing cannot generate an unsolvable board
- [ ] **140.** Games: an arcade, and a scoreboard the whole house shares

## 2026-08-29

- [ ] **141.** Stocks: five threads on refresh
- [ ] **142.** Stocks: a wildcard that was lying to you
- [ ] **143.** Home: the random photo card says how old the photo is
- [ ] **144.** Stocks: Watch & Test — watch lists, signals and simulation on one screen
- [ ] **145.** Expense: re-run a rule over transactions you have already imported
- [ ] **146.** Expense: a vendor is somebody now, not just a total

## 2026-08-28

- [ ] **147.** Home screen: arrange it yourself
- [ ] **148.** CSV Analysis: the two-tier nav
- [ ] **149.** Home: a photograph drawn at random
- [ ] **150.** Uploaded icons get cleaned up on the way in
- [ ] **151.** Icons: any single icon can be replaced without changing the icon set (73 slots)
- [ ] **152.** Admin → Configuration → Icons: upload an SVG or image per position
- [ ] **153.** Icons: uploaded SVG is sanitized on write
- [ ] **154.** Home: a picture behind the day
- [ ] **155.** Expense: rules that say why

## 2026-08-26

- [ ] **156.** Admin → Background Tasks: every timer in one place, including jobs that never ran
- [ ] **157.** A job killed mid-pass reads as interrupted, never as ok
- [ ] **158.** CLI: list-scheduled-jobs gives the same answer without the web server
- [ ] **159.** Last-run stamps survive the restarts a deploy performs
- [ ] **160.** Stocks: an Indexes card of eleven benchmarks in four groups
- [ ] **161.** Stocks: a new dashboard widget lands beside its neighbour, not at the bottom
- [ ] **162.** Stocks → Simulation: "what if I'd bought then?" across ten windows

## 2026-08-25

- [ ] **163.** Music: a scan that finishes (no OOM on a large NAS folder)
- [ ] **164.** Music: an abandoned scan run closes itself instead of reading "running" forever
- [ ] **165.** Progress3D: one progress bar across the app
- [ ] **166.** Per-module background pictures
- [ ] **167.** Attendance: a Detail report — the whole term as a grid
- [ ] **168.** About: a Server Log tab

## 2026-08-19

- [ ] **169.** Stocks: find a ticker, and star the ones you watch daily
- [ ] **170.** Music Library: Magic Playlists assembled from a query
- [ ] **171.** Music Library: a visible play queue
- [ ] **172.** Music Library: lyrics on demand
- [ ] **173.** Grids that count their own columns
- [ ] **174.** Seven more glyphs
- [ ] **175.** Ticker detail: how far a trade has moved since you made it
- [ ] **176.** Music Library: stream 20,000 songs off the NAS
- [ ] **177.** Attendance: two registers a day
- [ ] **178.** Attendance: student actions, a teacher-editable catalog
- [ ] **179.** Attendance: 12 icon sets, applied to the section nav too

## 2026-08-16

- [ ] **180.** Attendance: a new module — pick a class, tap who is here, save
- [ ] **181.** Attendance: a student can sit in several classes
- [ ] **182.** "Absent" and "attendance was never taken" stay distinguishable
- [ ] **183.** Admin → Security: a sign-in audit log recording logins, failures and logouts
- [ ] **184.** Stocks: allocation by sector
- [ ] **185.** Stocks: candlestick charts
- [ ] **186.** Admin: import daily quotes from a newsletter

## 2026-08-15

- [ ] **187.** Journal: clickable taxonomy
- [ ] **188.** About page: inline markdown in the change log
- [ ] **189.** About page: memory as meters
- [ ] **190.** Home: Daily Glance moves off the Stocks dashboard
- [ ] **191.** Installable PWA: stable identity, module shortcuts, iOS launch screens
- [ ] **192.** Per-user preferences: a favourite module you can open on startup

## 2026-08-14

- [ ] **193.** Journal: a filtered Entries browser with saved AND/OR filters
- [ ] **194.** Journal: icons for categories and tags
- [ ] **195.** Deploys apply their own migrations, and fail loudly rather than serving new code
- [ ] **196.** CSV Analytics: add columns without re-importing a file
- [ ] **197.** ModuleCarousel: a grid on desktop, coverflow on phones
- [ ] **198.** DataGrid: column headers popped up into a 3D bar
- [ ] **199.** Journal: home-screen search
- [ ] **200.** The section bar moved to the bottom, and modules collapsed into a menu

## 2026-08-11

- [ ] **201.** CSV Analytics: add custom columns during append/truncate

## 2026-08-10

- [ ] **202.** The section tree became a bar, and surfaces learned to lift

## 2026-08-08

- [ ] **203.** The compact section bar
- [ ] **204.** User management gated on admin
- [ ] **205.** Home: announce a new deployment
- [ ] **206.** Navigation moved to the edges — a top bar plus a compact bottom module bar
- [ ] **207.** Both nav bars minimise to a puck and remember it
- [ ] **208.** Every chart got a gear

## 2026-08-07

- [ ] **209.** Restart the NAS after a publish without SSH
- [ ] **210.** The app works on a phone — one layout boundary at 1024px, decided server-side
- [ ] **211.** Installable to the home screen
- [ ] **212.** Stocks: ticker viewer as cards, with Events and Yahoo Detail tabs
- [ ] **213.** Stocks: risk cached and served at any age, refreshed only by Recalculate
- [ ] **214.** Stocks: earnings data no longer vanishes (Yahoo User-Agent and crumb race)
- [ ] **215.** Home: the module grid becomes a carousel with per-module artwork
- [ ] **216.** Image uploads send a File in FormData rather than base64

## 2026-08-05

- [ ] **217.** Stocks: positions split into Stocks / ETF / Others
- [ ] **218.** Stocks: Daily Glance — one table for the three buckets, with the total
- [ ] **219.** Stocks: Account Performance Over Time on one set of axes
- [ ] **220.** Stocks: remember which account a broker's CSV label means
- [ ] **221.** Hide the sidebar to its accent strip, and give the page back the gutter
- [ ] **222.** Stocks: performance chart points shaped by what they are
- [ ] **223.** Stocks: ticker viewer — everything about one symbol in one dialog
- [ ] **224.** Stocks: choose which dashboard widgets show, and in what order
- [ ] **225.** Stocks: record the brokerage firm on a trade, and fix duplicate detection
- [ ] **226.** Stocks: cost basis, so total return is possible at all
- [ ] **227.** Stocks: daily snapshots, value and gain/loss per bucket
- [ ] **228.** Stocks: an icon per investment account
- [ ] **229.** Stocks: eight routed sections behind a TreeNav, loading per section
- [ ] **230.** Stocks: Refresh All with per-ticker progress
- [ ] **231.** Stocks: a per-ticker news lookup
- [ ] **232.** CSV import: one screen for all three types, listing every row
- [ ] **233.** A verification gate: typecheck, boundary, tests, migration dry-run, e2e

## 2026-08-03

- [ ] **234.** Full-width layout: one shared container across every full-page screen
- [ ] **235.** A fixed sidebar raised above the page, so a module gets the rest of the screen
- [ ] **236.** Expense: spend stats
- [ ] **237.** Expense: an auto-import switch
- [ ] **238.** Expense: an uploadable icon per category
- [ ] **239.** Stocks: cache and show ticker logos
- [ ] **240.** DataGrid: filter expressions
- [ ] **241.** DataGrid: column aggregates
- [ ] **242.** DataGrid: record view
- [ ] **243.** Modal extracted as its own component
- [ ] **244.** Three colour themes and three icon sets

## 2026-08-02

- [ ] **245.** Expense: automatic CSV import from a watched folder, one sub-folder per card
- [ ] **246.** Expense: a processed file is renamed .backup, a failure .failed
- [ ] **247.** Expense: post-import rules — one condition, any number of field assignments
- [ ] **248.** Expense: "Manually Run Import Clean up" with real progress
- [ ] **249.** Expense: the tree-nav overhaul
- [ ] **250.** Expense: a new module for credit-card spending
- [ ] **251.** Expense: fuzzy auto-categorisation by glob against the statement description
- [ ] **252.** Expense: CSV import with a saved column mapping per card company
- [ ] **253.** Admin: import daily quotes from a newsletter

## 2026-07-30

- [ ] **254.** Result grid: search, filters, sticky header, column control, row selection
- [ ] **255.** Journal: entry authoring with category/tag autocomplete
- [ ] **256.** Journal: a Leaflet location picker with search and multiple pins
- [ ] **257.** Journal: fetch today's weather
- [ ] **258.** Journal: the entry screen, with Print/Save-PDF, Edit, Lock and Delete
- [ ] **259.** Journal: Today In History

## 2026-07-27

- [ ] **260.** Journal: a new module, with CSV import of a real export
- [ ] **261.** Real Estate and Property Watch removed
- [ ] **262.** Every table renamed to a 3-letter module prefix
- [ ] **263.** Daily Quote

## 2026-07-25

- [ ] **264.** Self-signup, always as a plain user with no module access
- [ ] **265.** Admin elevation behind a secret that stays hidden until you type "adm"
- [ ] **266.** User-selectable module icon sets
- [ ] **267.** Daybreak, the first light theme

## 2026-07-21

- [ ] **268.** Interactive DataGrid: click-to-sort, paging, Export CSV, Show SQL
- [ ] **269.** CSV Analysis: Show Data and Chart per entry
- [ ] **270.** CSV chart builder with presets
- [ ] **271.** ChartXY: line/bar/scatter/area with zoom

## 2026-07-19

- [ ] **272.** CSV Analytics: a new module
- [ ] **273.** Theme and UI polish
- [ ] **274.** ARM/Synology NAS deployment support

## 2026-07-18

- [ ] **275.** Stocks & ETFs: accounts, positions, transactions and portfolio summary
- [ ] **276.** Stocks & ETFs: a Yahoo Finance market-data client with manual/CLI refresh
- [ ] **277.** Stocks & ETFs: volatility, correlation and Sharpe analytics
- [ ] **278.** Stocks & ETFs: a Next Day Actions signal scanner
- [ ] **279.** Stocks & ETFs: CSV import with saved column-mapping presets
- [ ] **280.** Admin: SQL Explorer
- [ ] **281.** ChartLine, ChartBar and Tabs components
- [ ] **282.** Publish applies pending migrations, with an automatic backup
- [ ] **283.** ~~Real Estate: property portfolio and a RentCast watch list~~ *(removed 2026-07-27, migration 0026)*

## 2026-07-13

- [ ] **284.** Google auto-registration
- [ ] **285.** User avatars
- [ ] **286.** start.bat port cleanup

## 2026-07-12

- [ ] **287.** User management
- [ ] **288.** Authentication and Google sign-in
- [ ] **289.** Administration section
- [ ] **290.** Module Settings
- [ ] **291.** Initial scaffold: modules, settings, admin section
