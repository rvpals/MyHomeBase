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

## 2026-09-25 — Release

Migration 0112 (`sys_saved_sql_queries`) was applied on the NAS during this
release's publish. If items 1–3 ever report "no such table", that is the thing to
re-check before reading anything else here as a bug.

Item 4 costs live provider calls on every expand, so it can only really be judged
during market hours; item 6 needs a file whose tags actually carry lyrics, which
not every track in the library has. Item 8 is phone-relevant — the expanded index
panel adds six figures and a sparkline to a row that was already tight.

- [ ] **1.** Admin → SQL Explorer → SQL Query: save a statement with a name, description and tags; it appears on the Saved SQL card
- [ ] **2.** Admin → SQL Explorer: Load fills the editor and does **not** execute — confirm with a statement you would not want run
- [ ] **3.** Admin → SQL Explorer: saving under an existing name replaces that row, and the dialog warns before it does
- [ ] **4.** Investments → Indexes card: a row expands to show day range, 52-week range with its marker, moving averages, one-year change, all-time high and a sparkline
- [ ] **5.** Investments → Indexes card: a symbol whose second pass fails keeps its row and shows em-dashes (the three commodity futures have no one-year change)
- [ ] **6.** Music: a track with embedded lyrics shows them attributed "From this file's own tags", without a network lookup
- [ ] **7.** Music: a track with no embedded and no lrclib match offers the Google search link
- [ ] **8.** Investments → Indexes card: the expanded panel and sparkline are readable on a phone
- [ ] **9.** Admin → Daily Quote → All Quotes: the new nav entry opens the listing screen
- [ ] **10.** CLI: `saved-sql list` / `show` / `save` / `delete` behave as documented

---

## 2026-09-24 — Release

No new migrations: 0109–0111 shipped with the previous release and are already
applied on the NAS. Item 4 is the one to watch — the dedup rule changed, so a
scan that used to return nothing may now return groups, and blank-named places
can group on distance alone. Items 2 and 3 are phone-relevant: the popup and the
picker's refusal message both have to be readable narrow.

- [ ] **11.** Admin → Message Queue: the screen lists read and unread together, newest first, with each message's source
- [ ] **12.** Admin → Message Queue: tick rows and Delete removes them; Purge by age (7/30/90/365 days) clears everything older and keeps the rest
- [ ] **13.** Journal → Merging & Dedup: the "Within" slider (10–500m, default 75m) rescans on release, and groups found by distance are labelled "proximity"
- [ ] **14.** Journal → Merging & Dedup: two pins ~25–50m apart with similar names now group (they did not before); merging one still works
- [ ] **15.** Journal → entry form: adding a location already on the entry is refused with a message, and the draft pin stays put — from both the map tab and the library tab
- [ ] **16.** Journal: clicking a numbered map pin opens a popup with number, name, address, coordinates and chips, readable in the dark theme
- [ ] **17.** Journal: a single entry page shows the module rail, section panel and header (no more bare page with a "Back to My Journal" link)

---

## 2026-09-23 — Release

Migrations 0106, 0107 and 0108 are applied on the NAS. The Investments rename
touched ~83 files and renamed 17 tables, so the items below are worth a walk
through even where the screen looks unchanged — a missed server action throws
only when that one feature is used, not when the page loads.

- [ ] **18.** Investments: the module opens at /modules/investments, named Investments on the rail and home grid
- [ ] **19.** Investments: every section loads — Dashboard, Positions, Transactions, Account Performance, Watch & Test, Chart & Analysis, CSV Import, Tax Lots, Export for AI Analysis, Settings
- [ ] **20.** Investments: the actions still write — add/edit a position, a transaction, a watchlist entry, an account
- [ ] **21.** Investments: Tax Lots deep links still resolve (ticker picker, and the links out of the positions grid)
- [ ] **22.** Investments: CSV import of a broker file
- [ ] **23.** Admin → SQL Explorer: the Investments group lists the inv_ tables, and Table References names them
- [ ] **24.** Admin → Background Tasks: the Investments auto-refresh still finds its module
- [ ] **25.** Home: the Daily Glance card renders and its "Launch Investments" link goes to the new URL
- [ ] **26.** Investments: uploaded section/card icons survived the rename (slot ids were deliberately left on `stock_*`)
- [x] **27.** Expense: Transaction Rule Types — group rules by type, filter the rules list, manage types in Meta Data  — tested 2026-09-23
- [x] **28.** Security → Visits: why a visit was scored suspicious (signals on the row)

---

## 2026-09-22 — Release

- [x] **29.** CSV Analysis: pooled datasets
- [x] **30.** Admin-set preferences (allow edit user's preferences)
- [x] **31.** Location icons

## 2026-09-20

- [x] **32.** Journal: filter the category and tag lists in Meta Data
- [x] **33.** Journal: a saved-location library
- [x] **34.** Journal: Entries as one screen with two tabs
- [x] **35.** Tools: a CSV file browser beside the SQLite one

## 2026-09-19

- [x] **36.** Journal: keep or file a photo from an entry
- [x] **37.** TreeNav: each group reads as its own embossed card
- [x] **38.** Tools: SQLite uploads over 4 MB, with an admin-set cap
- [ ] **39.** Stocks: icons on the indexes board
- [ ] **40.** Stocks: playback of portfolio history
- [ ] **41.** Music: a sleep timer that stops the player after a set time

## 2026-09-17

- [ ] **42.** Home screen: launch a card's module from its title
- [ ] **43.** Journal: review existing entries before importing from a calendar
- [ ] **44.** Tools: a new module, opening with a SQLite file browser

## 2026-09-15

- [ ] **45.** Floating layer: a clock over every page
- [ ] **46.** Floating layer: a calculator over every page
- [ ] **47.** Floating layer: a scratchpad over every page
- [ ] **48.** Stocks: the indexes board loads when you open the card
- [ ] **49.** Admin: clear deployment records in bulk, or prune to the newest few
- [ ] **50.** Journal: jump to the next day that has an entry
- [ ] **51.** NAS: a startup crash that says what broke

## 2026-09-14

- [ ] **52.** Journal: date the template suggestion by the local calendar
- [ ] **53.** Themes: tell the browser a dark theme is dark
- [ ] **54.** Export for AI: measured correlations, and the sectors you hold nothing in
- [ ] **55.** Home: a Clock card, with the weather where you are
- [ ] **56.** Picture Gallery: Magic List — photographs conjured from a description
- [ ] **57.** Stocks: candlesticks in the ticker viewer's Today card
- [ ] **58.** Stocks: consult AI about one ticker
- [ ] **59.** Stocks: a transaction knows which account it belongs to

## 2026-09-13

- [ ] **60.** Attendance: bigger cards in the register grid
- [ ] **61.** Admin: random theme generation
- [ ] **62.** Music Library: an Albums view
- [ ] **63.** Stocks & ETFs: a recorded trade can update the holding
- [ ] **64.** MyJournal: New Entry becomes a section
- [ ] **65.** Games: Bridge
- [ ] **66.** SQL Explorer: BLOB cells fetched on demand
- [ ] **67.** SQL Explorer: tables grouped by module
- [ ] **68.** Account: two compact navigation styles, and the reader picks
- [ ] **69.** Icon names: the compiler catches glyph-table drift

## 2026-09-11

- [ ] **70.** Journal: Calendar Import — read a Google/Outlook .ics and pick events to import
- [ ] **71.** Journal: re-importing a renamed or moved event updates it instead of duplicating
- [ ] **72.** Journal: a large .ics (2.4 MB) uploads without tripping the action-argument limit
- [ ] **73.** Journal: restoring an imported entry from the recycle bin keeps its identity
- [ ] **74.** Stocks: a portfolio brief for an LLM
- [ ] **75.** Attendance: one register per class per day again
- [ ] **76.** Attendance: session labels read in local time, not four hours ahead

## 2026-09-10

- [ ] **77.** Picture Gallery: albums
- [ ] **78.** Picture Gallery: a + on every photograph
- [ ] **79.** Home screen: a handwritten quote, no header, and a slimmer rail

## 2026-09-09

- [ ] **80.** Security: every exported server action authorises on its first line
- [ ] **81.** Stocks & ETFs: analyze several tickers at once, and link to an analysis
- [ ] **82.** Music Library: the song on YouTube
- [ ] **83.** Music Library: a real fullscreen visualizer
- [ ] **84.** Picture Gallery: a module of its own, not a corner of the home screen

## 2026-09-08

- [ ] **85.** Games: Mahjong pickers and board frame
- [ ] **86.** Stocks & ETFs: today's session in the ticker viewer
- [ ] **87.** Journal: a space-separated Tags column no longer imports as one long tag
- [ ] **88.** CSV Analytics: bulk edit rows
- [ ] **89.** CSV Analytics: a CLI for bulk edit
- [ ] **90.** Photographs: one viewer, with a capture timestamp and a heart

## 2026-09-06 — Release

- [ ] **91.** Games: Mahjong, the four-player game against three bots
- [ ] **92.** Stocks & ETFs: the Tax Lot Portfolio Analyzer
- [ ] **93.** About: count untagged changes instead of reporting zero
- [ ] **94.** Home: the Random Photo card streams instead of blocking first paint
- [ ] **95.** Photos: an absolute path can no longer escape the photo folder
- [ ] **96.** Compact grids: long values are readable
- [ ] **97.** Compact grids: a second layout for reading
- [ ] **98.** Music: the story behind the song, beside the lyrics
- [ ] **99.** Games: Mahjong Match
- [ ] **100.** Games: card icons across the whole arcade
- [ ] **101.** Attendance: upload your own icon for a student action
- [ ] **102.** CSV Analysis: named views over a dataset

## 2026-09-03

- [ ] **103.** Attendance: a class records the weekday it meets on
- [ ] **104.** Attendance: the home screen opens on today's register
- [ ] **105.** Photos: a viewer component with its own actions
- [ ] **106.** Journal: a photos slideshow and folder module
- [ ] **107.** Games: sudoku and blackjack polish
- [ ] **108.** Stocks: the refresh total counts up as prices land

## 2026-09-02 — Release

- [ ] **109.** Expense: top-5 cards link through to their transactions
- [ ] **110.** Expense: the vendor rollup stops inventing vendors from payment lines
- [ ] **111.** Stocks: the indexes refresh becomes an icon
- [ ] **112.** Favourite photos: a slideshow
- [ ] **113.** Carousel graphics are resized on upload
- [ ] **114.** SQL Explorer: a schema browser
- [ ] **115.** SQL Explorer: prose for every table
- [ ] **116.** Music: a spectrum analyser under the cover art
- [ ] **117.** Games: Sudoku
- [ ] **118.** Games: Blackjack
- [ ] **119.** Games: Minesweeper
- [ ] **120.** Journal: a recycle bin
- [ ] **121.** Journal: a Correct tab
- [ ] **122.** Journal: metadata backup

## 2026-09-01 — Release

- [ ] **123.** Journal import: an overwrite mode, with the plan shown before it writes
- [ ] **124.** Favourite photos: their own screen
- [ ] **125.** Favourite photos: a zip download
- [ ] **126.** Admin: a deployment history, with the build log attached
- [ ] **127.** Games: Tetris
- [ ] **128.** Games: Arrow Clearing becomes an actual puzzle
- [ ] **129.** SQL Explorer: a Truncate button, behind a warning that counts the rows
- [ ] **130.** Journal import: normalized entry time stops a re-import duplicating

## 2026-08-30

- [ ] **131.** Themes: colour themes are data, and the builder warns before you blind yourself
- [ ] **132.** Games: Arrow Clearing cannot generate an unsolvable board
- [ ] **133.** Games: an arcade, and a scoreboard the whole house shares

## 2026-08-29

- [ ] **134.** Stocks: five threads on refresh
- [ ] **135.** Stocks: a wildcard that was lying to you
- [ ] **136.** Home: the random photo card says how old the photo is
- [ ] **137.** Stocks: Watch & Test — watch lists, signals and simulation on one screen
- [ ] **138.** Expense: re-run a rule over transactions you have already imported
- [ ] **139.** Expense: a vendor is somebody now, not just a total

## 2026-08-28

- [ ] **140.** Home screen: arrange it yourself
- [ ] **141.** CSV Analysis: the two-tier nav
- [ ] **142.** Home: a photograph drawn at random
- [ ] **143.** Uploaded icons get cleaned up on the way in
- [ ] **144.** Icons: any single icon can be replaced without changing the icon set (73 slots)
- [ ] **145.** Admin → Configuration → Icons: upload an SVG or image per position
- [ ] **146.** Icons: uploaded SVG is sanitized on write
- [ ] **147.** Home: a picture behind the day
- [ ] **148.** Expense: rules that say why

## 2026-08-26

- [ ] **149.** Admin → Background Tasks: every timer in one place, including jobs that never ran
- [ ] **150.** A job killed mid-pass reads as interrupted, never as ok
- [ ] **151.** CLI: list-scheduled-jobs gives the same answer without the web server
- [ ] **152.** Last-run stamps survive the restarts a deploy performs
- [ ] **153.** Stocks: an Indexes card of eleven benchmarks in four groups
- [ ] **154.** Stocks: a new dashboard widget lands beside its neighbour, not at the bottom
- [ ] **155.** Stocks → Simulation: "what if I'd bought then?" across ten windows

## 2026-08-25

- [ ] **156.** Music: a scan that finishes (no OOM on a large NAS folder)
- [ ] **157.** Music: an abandoned scan run closes itself instead of reading "running" forever
- [ ] **158.** Progress3D: one progress bar across the app
- [ ] **159.** Per-module background pictures
- [ ] **160.** Attendance: a Detail report — the whole term as a grid
- [ ] **161.** About: a Server Log tab

## 2026-08-19

- [ ] **162.** Stocks: find a ticker, and star the ones you watch daily
- [ ] **163.** Music Library: Magic Playlists assembled from a query
- [ ] **164.** Music Library: a visible play queue
- [ ] **165.** Music Library: lyrics on demand
- [ ] **166.** Grids that count their own columns
- [ ] **167.** Seven more glyphs
- [ ] **168.** Ticker detail: how far a trade has moved since you made it
- [ ] **169.** Music Library: stream 20,000 songs off the NAS
- [ ] **170.** Attendance: two registers a day
- [ ] **171.** Attendance: student actions, a teacher-editable catalog
- [ ] **172.** Attendance: 12 icon sets, applied to the section nav too

## 2026-08-16

- [ ] **173.** Attendance: a new module — pick a class, tap who is here, save
- [ ] **174.** Attendance: a student can sit in several classes
- [ ] **175.** "Absent" and "attendance was never taken" stay distinguishable
- [ ] **176.** Admin → Security: a sign-in audit log recording logins, failures and logouts
- [ ] **177.** Stocks: allocation by sector
- [ ] **178.** Stocks: candlestick charts
- [ ] **179.** Admin: import daily quotes from a newsletter

## 2026-08-15

- [ ] **180.** Journal: clickable taxonomy
- [ ] **181.** About page: inline markdown in the change log
- [ ] **182.** About page: memory as meters
- [ ] **183.** Home: Daily Glance moves off the Stocks dashboard
- [ ] **184.** Installable PWA: stable identity, module shortcuts, iOS launch screens
- [ ] **185.** Per-user preferences: a favourite module you can open on startup

## 2026-08-14

- [ ] **186.** Journal: a filtered Entries browser with saved AND/OR filters
- [ ] **187.** Journal: icons for categories and tags
- [ ] **188.** Deploys apply their own migrations, and fail loudly rather than serving new code
- [ ] **189.** CSV Analytics: add columns without re-importing a file
- [ ] **190.** ModuleCarousel: a grid on desktop, coverflow on phones
- [ ] **191.** DataGrid: column headers popped up into a 3D bar
- [ ] **192.** Journal: home-screen search
- [ ] **193.** The section bar moved to the bottom, and modules collapsed into a menu

## 2026-08-11

- [ ] **194.** CSV Analytics: add custom columns during append/truncate

## 2026-08-10

- [ ] **195.** The section tree became a bar, and surfaces learned to lift

## 2026-08-08

- [ ] **196.** The compact section bar
- [ ] **197.** User management gated on admin
- [ ] **198.** Home: announce a new deployment
- [ ] **199.** Navigation moved to the edges — a top bar plus a compact bottom module bar
- [ ] **200.** Both nav bars minimise to a puck and remember it
- [ ] **201.** Every chart got a gear

## 2026-08-07

- [ ] **202.** Restart the NAS after a publish without SSH
- [ ] **203.** The app works on a phone — one layout boundary at 1024px, decided server-side
- [ ] **204.** Installable to the home screen
- [ ] **205.** Stocks: ticker viewer as cards, with Events and Yahoo Detail tabs
- [ ] **206.** Stocks: risk cached and served at any age, refreshed only by Recalculate
- [ ] **207.** Stocks: earnings data no longer vanishes (Yahoo User-Agent and crumb race)
- [ ] **208.** Home: the module grid becomes a carousel with per-module artwork
- [ ] **209.** Image uploads send a File in FormData rather than base64

## 2026-08-05

- [ ] **210.** Stocks: positions split into Stocks / ETF / Others
- [ ] **211.** Stocks: Daily Glance — one table for the three buckets, with the total
- [ ] **212.** Stocks: Account Performance Over Time on one set of axes
- [ ] **213.** Stocks: remember which account a broker's CSV label means
- [ ] **214.** Hide the sidebar to its accent strip, and give the page back the gutter
- [ ] **215.** Stocks: performance chart points shaped by what they are
- [ ] **216.** Stocks: ticker viewer — everything about one symbol in one dialog
- [ ] **217.** Stocks: choose which dashboard widgets show, and in what order
- [ ] **218.** Stocks: record the brokerage firm on a trade, and fix duplicate detection
- [ ] **219.** Stocks: cost basis, so total return is possible at all
- [ ] **220.** Stocks: daily snapshots, value and gain/loss per bucket
- [ ] **221.** Stocks: an icon per investment account
- [ ] **222.** Stocks: eight routed sections behind a TreeNav, loading per section
- [ ] **223.** Stocks: Refresh All with per-ticker progress
- [ ] **224.** Stocks: a per-ticker news lookup
- [ ] **225.** CSV import: one screen for all three types, listing every row
- [ ] **226.** A verification gate: typecheck, boundary, tests, migration dry-run, e2e

## 2026-08-03

- [ ] **227.** Full-width layout: one shared container across every full-page screen
- [ ] **228.** A fixed sidebar raised above the page, so a module gets the rest of the screen
- [ ] **229.** Expense: spend stats
- [ ] **230.** Expense: an auto-import switch
- [ ] **231.** Expense: an uploadable icon per category
- [ ] **232.** Stocks: cache and show ticker logos
- [ ] **233.** DataGrid: filter expressions
- [ ] **234.** DataGrid: column aggregates
- [ ] **235.** DataGrid: record view
- [ ] **236.** Modal extracted as its own component
- [ ] **237.** Three colour themes and three icon sets

## 2026-08-02

- [ ] **238.** Expense: automatic CSV import from a watched folder, one sub-folder per card
- [ ] **239.** Expense: a processed file is renamed .backup, a failure .failed
- [ ] **240.** Expense: post-import rules — one condition, any number of field assignments
- [ ] **241.** Expense: "Manually Run Import Clean up" with real progress
- [ ] **242.** Expense: the tree-nav overhaul
- [ ] **243.** Expense: a new module for credit-card spending
- [ ] **244.** Expense: fuzzy auto-categorisation by glob against the statement description
- [ ] **245.** Expense: CSV import with a saved column mapping per card company
- [ ] **246.** Admin: import daily quotes from a newsletter

## 2026-07-30

- [ ] **247.** Result grid: search, filters, sticky header, column control, row selection
- [ ] **248.** Journal: entry authoring with category/tag autocomplete
- [ ] **249.** Journal: a Leaflet location picker with search and multiple pins
- [ ] **250.** Journal: fetch today's weather
- [ ] **251.** Journal: the entry screen, with Print/Save-PDF, Edit, Lock and Delete
- [ ] **252.** Journal: Today In History

## 2026-07-27

- [ ] **253.** Journal: a new module, with CSV import of a real export
- [ ] **254.** Real Estate and Property Watch removed
- [ ] **255.** Every table renamed to a 3-letter module prefix
- [ ] **256.** Daily Quote

## 2026-07-25

- [ ] **257.** Self-signup, always as a plain user with no module access
- [ ] **258.** Admin elevation behind a secret that stays hidden until you type "adm"
- [ ] **259.** User-selectable module icon sets
- [ ] **260.** Daybreak, the first light theme

## 2026-07-21

- [ ] **261.** Interactive DataGrid: click-to-sort, paging, Export CSV, Show SQL
- [ ] **262.** CSV Analysis: Show Data and Chart per entry
- [ ] **263.** CSV chart builder with presets
- [ ] **264.** ChartXY: line/bar/scatter/area with zoom

## 2026-07-19

- [ ] **265.** CSV Analytics: a new module
- [ ] **266.** Theme and UI polish
- [ ] **267.** ARM/Synology NAS deployment support

## 2026-07-18

- [ ] **268.** Stocks & ETFs: accounts, positions, transactions and portfolio summary
- [ ] **269.** Stocks & ETFs: a Yahoo Finance market-data client with manual/CLI refresh
- [ ] **270.** Stocks & ETFs: volatility, correlation and Sharpe analytics
- [ ] **271.** Stocks & ETFs: a Next Day Actions signal scanner
- [ ] **272.** Stocks & ETFs: CSV import with saved column-mapping presets
- [ ] **273.** Admin: SQL Explorer
- [ ] **274.** ChartLine, ChartBar and Tabs components
- [ ] **275.** Publish applies pending migrations, with an automatic backup
- [ ] **276.** ~~Real Estate: property portfolio and a RentCast watch list~~ *(removed 2026-07-27, migration 0026)*

## 2026-07-13

- [ ] **277.** Google auto-registration
- [ ] **278.** User avatars
- [ ] **279.** start.bat port cleanup

## 2026-07-12

- [ ] **280.** User management
- [ ] **281.** Authentication and Google sign-in
- [ ] **282.** Administration section
- [ ] **283.** Module Settings
- [ ] **284.** Initial scaffold: modules, settings, admin section
