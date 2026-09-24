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

## 2026-09-24 — Release

No new migrations: 0109–0111 shipped with the previous release and are already
applied on the NAS. Item 4 is the one to watch — the dedup rule changed, so a
scan that used to return nothing may now return groups, and blank-named places
can group on distance alone. Items 2 and 3 are phone-relevant: the popup and the
picker's refusal message both have to be readable narrow.

- [ ] **1.** Admin → Message Queue: the screen lists read and unread together, newest first, with each message's source
- [ ] **2.** Admin → Message Queue: tick rows and Delete removes them; Purge by age (7/30/90/365 days) clears everything older and keeps the rest
- [ ] **3.** Journal → Merging & Dedup: the "Within" slider (10–500m, default 75m) rescans on release, and groups found by distance are labelled "proximity"
- [ ] **4.** Journal → Merging & Dedup: two pins ~25–50m apart with similar names now group (they did not before); merging one still works
- [ ] **5.** Journal → entry form: adding a location already on the entry is refused with a message, and the draft pin stays put — from both the map tab and the library tab
- [ ] **6.** Journal: clicking a numbered map pin opens a popup with number, name, address, coordinates and chips, readable in the dark theme
- [ ] **7.** Journal: a single entry page shows the module rail, section panel and header (no more bare page with a "Back to My Journal" link)

---

## 2026-09-23 — Release

Migrations 0106, 0107 and 0108 are applied on the NAS. The Investments rename
touched ~83 files and renamed 17 tables, so the items below are worth a walk
through even where the screen looks unchanged — a missed server action throws
only when that one feature is used, not when the page loads.

- [ ] **8.** Investments: the module opens at /modules/investments, named Investments on the rail and home grid
- [ ] **9.** Investments: every section loads — Dashboard, Positions, Transactions, Account Performance, Watch & Test, Chart & Analysis, CSV Import, Tax Lots, Export for AI Analysis, Settings
- [ ] **10.** Investments: the actions still write — add/edit a position, a transaction, a watchlist entry, an account
- [ ] **11.** Investments: Tax Lots deep links still resolve (ticker picker, and the links out of the positions grid)
- [ ] **12.** Investments: CSV import of a broker file
- [ ] **13.** Admin → SQL Explorer: the Investments group lists the inv_ tables, and Table References names them
- [ ] **14.** Admin → Background Tasks: the Investments auto-refresh still finds its module
- [ ] **15.** Home: the Daily Glance card renders and its "Launch Investments" link goes to the new URL
- [ ] **16.** Investments: uploaded section/card icons survived the rename (slot ids were deliberately left on `stock_*`)
- [x] **17.** Expense: Transaction Rule Types — group rules by type, filter the rules list, manage types in Meta Data  — tested 2026-09-23
- [x] **18.** Security → Visits: why a visit was scored suspicious (signals on the row)

---

## 2026-09-22 — Release

- [x] **19.** CSV Analysis: pooled datasets
- [x] **20.** Admin-set preferences (allow edit user's preferences)
- [x] **21.** Location icons

## 2026-09-20

- [x] **22.** Journal: filter the category and tag lists in Meta Data
- [x] **23.** Journal: a saved-location library
- [x] **24.** Journal: Entries as one screen with two tabs
- [x] **25.** Tools: a CSV file browser beside the SQLite one

## 2026-09-19

- [x] **26.** Journal: keep or file a photo from an entry
- [x] **27.** TreeNav: each group reads as its own embossed card
- [x] **28.** Tools: SQLite uploads over 4 MB, with an admin-set cap
- [ ] **29.** Stocks: icons on the indexes board
- [ ] **30.** Stocks: playback of portfolio history
- [ ] **31.** Music: a sleep timer that stops the player after a set time

## 2026-09-17

- [ ] **32.** Home screen: launch a card's module from its title
- [ ] **33.** Journal: review existing entries before importing from a calendar
- [ ] **34.** Tools: a new module, opening with a SQLite file browser

## 2026-09-15

- [ ] **35.** Floating layer: a clock over every page
- [ ] **36.** Floating layer: a calculator over every page
- [ ] **37.** Floating layer: a scratchpad over every page
- [ ] **38.** Stocks: the indexes board loads when you open the card
- [ ] **39.** Admin: clear deployment records in bulk, or prune to the newest few
- [ ] **40.** Journal: jump to the next day that has an entry
- [ ] **41.** NAS: a startup crash that says what broke

## 2026-09-14

- [ ] **42.** Journal: date the template suggestion by the local calendar
- [ ] **43.** Themes: tell the browser a dark theme is dark
- [ ] **44.** Export for AI: measured correlations, and the sectors you hold nothing in
- [ ] **45.** Home: a Clock card, with the weather where you are
- [ ] **46.** Picture Gallery: Magic List — photographs conjured from a description
- [ ] **47.** Stocks: candlesticks in the ticker viewer's Today card
- [ ] **48.** Stocks: consult AI about one ticker
- [ ] **49.** Stocks: a transaction knows which account it belongs to

## 2026-09-13

- [ ] **50.** Attendance: bigger cards in the register grid
- [ ] **51.** Admin: random theme generation
- [ ] **52.** Music Library: an Albums view
- [ ] **53.** Stocks & ETFs: a recorded trade can update the holding
- [ ] **54.** MyJournal: New Entry becomes a section
- [ ] **55.** Games: Bridge
- [ ] **56.** SQL Explorer: BLOB cells fetched on demand
- [ ] **57.** SQL Explorer: tables grouped by module
- [ ] **58.** Account: two compact navigation styles, and the reader picks
- [ ] **59.** Icon names: the compiler catches glyph-table drift

## 2026-09-11

- [ ] **60.** Journal: Calendar Import — read a Google/Outlook .ics and pick events to import
- [ ] **61.** Journal: re-importing a renamed or moved event updates it instead of duplicating
- [ ] **62.** Journal: a large .ics (2.4 MB) uploads without tripping the action-argument limit
- [ ] **63.** Journal: restoring an imported entry from the recycle bin keeps its identity
- [ ] **64.** Stocks: a portfolio brief for an LLM
- [ ] **65.** Attendance: one register per class per day again
- [ ] **66.** Attendance: session labels read in local time, not four hours ahead

## 2026-09-10

- [ ] **67.** Picture Gallery: albums
- [ ] **68.** Picture Gallery: a + on every photograph
- [ ] **69.** Home screen: a handwritten quote, no header, and a slimmer rail

## 2026-09-09

- [ ] **70.** Security: every exported server action authorises on its first line
- [ ] **71.** Stocks & ETFs: analyze several tickers at once, and link to an analysis
- [ ] **72.** Music Library: the song on YouTube
- [ ] **73.** Music Library: a real fullscreen visualizer
- [ ] **74.** Picture Gallery: a module of its own, not a corner of the home screen

## 2026-09-08

- [ ] **75.** Games: Mahjong pickers and board frame
- [ ] **76.** Stocks & ETFs: today's session in the ticker viewer
- [ ] **77.** Journal: a space-separated Tags column no longer imports as one long tag
- [ ] **78.** CSV Analytics: bulk edit rows
- [ ] **79.** CSV Analytics: a CLI for bulk edit
- [ ] **80.** Photographs: one viewer, with a capture timestamp and a heart

## 2026-09-06 — Release

- [ ] **81.** Games: Mahjong, the four-player game against three bots
- [ ] **82.** Stocks & ETFs: the Tax Lot Portfolio Analyzer
- [ ] **83.** About: count untagged changes instead of reporting zero
- [ ] **84.** Home: the Random Photo card streams instead of blocking first paint
- [ ] **85.** Photos: an absolute path can no longer escape the photo folder
- [ ] **86.** Compact grids: long values are readable
- [ ] **87.** Compact grids: a second layout for reading
- [ ] **88.** Music: the story behind the song, beside the lyrics
- [ ] **89.** Games: Mahjong Match
- [ ] **90.** Games: card icons across the whole arcade
- [ ] **91.** Attendance: upload your own icon for a student action
- [ ] **92.** CSV Analysis: named views over a dataset

## 2026-09-03

- [ ] **93.** Attendance: a class records the weekday it meets on
- [ ] **94.** Attendance: the home screen opens on today's register
- [ ] **95.** Photos: a viewer component with its own actions
- [ ] **96.** Journal: a photos slideshow and folder module
- [ ] **97.** Games: sudoku and blackjack polish
- [ ] **98.** Stocks: the refresh total counts up as prices land

## 2026-09-02 — Release

- [ ] **99.** Expense: top-5 cards link through to their transactions
- [ ] **100.** Expense: the vendor rollup stops inventing vendors from payment lines
- [ ] **101.** Stocks: the indexes refresh becomes an icon
- [ ] **102.** Favourite photos: a slideshow
- [ ] **103.** Carousel graphics are resized on upload
- [ ] **104.** SQL Explorer: a schema browser
- [ ] **105.** SQL Explorer: prose for every table
- [ ] **106.** Music: a spectrum analyser under the cover art
- [ ] **107.** Games: Sudoku
- [ ] **108.** Games: Blackjack
- [ ] **109.** Games: Minesweeper
- [ ] **110.** Journal: a recycle bin
- [ ] **111.** Journal: a Correct tab
- [ ] **112.** Journal: metadata backup

## 2026-09-01 — Release

- [ ] **113.** Journal import: an overwrite mode, with the plan shown before it writes
- [ ] **114.** Favourite photos: their own screen
- [ ] **115.** Favourite photos: a zip download
- [ ] **116.** Admin: a deployment history, with the build log attached
- [ ] **117.** Games: Tetris
- [ ] **118.** Games: Arrow Clearing becomes an actual puzzle
- [ ] **119.** SQL Explorer: a Truncate button, behind a warning that counts the rows
- [ ] **120.** Journal import: normalized entry time stops a re-import duplicating

## 2026-08-30

- [ ] **121.** Themes: colour themes are data, and the builder warns before you blind yourself
- [ ] **122.** Games: Arrow Clearing cannot generate an unsolvable board
- [ ] **123.** Games: an arcade, and a scoreboard the whole house shares

## 2026-08-29

- [ ] **124.** Stocks: five threads on refresh
- [ ] **125.** Stocks: a wildcard that was lying to you
- [ ] **126.** Home: the random photo card says how old the photo is
- [ ] **127.** Stocks: Watch & Test — watch lists, signals and simulation on one screen
- [ ] **128.** Expense: re-run a rule over transactions you have already imported
- [ ] **129.** Expense: a vendor is somebody now, not just a total

## 2026-08-28

- [ ] **130.** Home screen: arrange it yourself
- [ ] **131.** CSV Analysis: the two-tier nav
- [ ] **132.** Home: a photograph drawn at random
- [ ] **133.** Uploaded icons get cleaned up on the way in
- [ ] **134.** Icons: any single icon can be replaced without changing the icon set (73 slots)
- [ ] **135.** Admin → Configuration → Icons: upload an SVG or image per position
- [ ] **136.** Icons: uploaded SVG is sanitized on write
- [ ] **137.** Home: a picture behind the day
- [ ] **138.** Expense: rules that say why

## 2026-08-26

- [ ] **139.** Admin → Background Tasks: every timer in one place, including jobs that never ran
- [ ] **140.** A job killed mid-pass reads as interrupted, never as ok
- [ ] **141.** CLI: list-scheduled-jobs gives the same answer without the web server
- [ ] **142.** Last-run stamps survive the restarts a deploy performs
- [ ] **143.** Stocks: an Indexes card of eleven benchmarks in four groups
- [ ] **144.** Stocks: a new dashboard widget lands beside its neighbour, not at the bottom
- [ ] **145.** Stocks → Simulation: "what if I'd bought then?" across ten windows

## 2026-08-25

- [ ] **146.** Music: a scan that finishes (no OOM on a large NAS folder)
- [ ] **147.** Music: an abandoned scan run closes itself instead of reading "running" forever
- [ ] **148.** Progress3D: one progress bar across the app
- [ ] **149.** Per-module background pictures
- [ ] **150.** Attendance: a Detail report — the whole term as a grid
- [ ] **151.** About: a Server Log tab

## 2026-08-19

- [ ] **152.** Stocks: find a ticker, and star the ones you watch daily
- [ ] **153.** Music Library: Magic Playlists assembled from a query
- [ ] **154.** Music Library: a visible play queue
- [ ] **155.** Music Library: lyrics on demand
- [ ] **156.** Grids that count their own columns
- [ ] **157.** Seven more glyphs
- [ ] **158.** Ticker detail: how far a trade has moved since you made it
- [ ] **159.** Music Library: stream 20,000 songs off the NAS
- [ ] **160.** Attendance: two registers a day
- [ ] **161.** Attendance: student actions, a teacher-editable catalog
- [ ] **162.** Attendance: 12 icon sets, applied to the section nav too

## 2026-08-16

- [ ] **163.** Attendance: a new module — pick a class, tap who is here, save
- [ ] **164.** Attendance: a student can sit in several classes
- [ ] **165.** "Absent" and "attendance was never taken" stay distinguishable
- [ ] **166.** Admin → Security: a sign-in audit log recording logins, failures and logouts
- [ ] **167.** Stocks: allocation by sector
- [ ] **168.** Stocks: candlestick charts
- [ ] **169.** Admin: import daily quotes from a newsletter

## 2026-08-15

- [ ] **170.** Journal: clickable taxonomy
- [ ] **171.** About page: inline markdown in the change log
- [ ] **172.** About page: memory as meters
- [ ] **173.** Home: Daily Glance moves off the Stocks dashboard
- [ ] **174.** Installable PWA: stable identity, module shortcuts, iOS launch screens
- [ ] **175.** Per-user preferences: a favourite module you can open on startup

## 2026-08-14

- [ ] **176.** Journal: a filtered Entries browser with saved AND/OR filters
- [ ] **177.** Journal: icons for categories and tags
- [ ] **178.** Deploys apply their own migrations, and fail loudly rather than serving new code
- [ ] **179.** CSV Analytics: add columns without re-importing a file
- [ ] **180.** ModuleCarousel: a grid on desktop, coverflow on phones
- [ ] **181.** DataGrid: column headers popped up into a 3D bar
- [ ] **182.** Journal: home-screen search
- [ ] **183.** The section bar moved to the bottom, and modules collapsed into a menu

## 2026-08-11

- [ ] **184.** CSV Analytics: add custom columns during append/truncate

## 2026-08-10

- [ ] **185.** The section tree became a bar, and surfaces learned to lift

## 2026-08-08

- [ ] **186.** The compact section bar
- [ ] **187.** User management gated on admin
- [ ] **188.** Home: announce a new deployment
- [ ] **189.** Navigation moved to the edges — a top bar plus a compact bottom module bar
- [ ] **190.** Both nav bars minimise to a puck and remember it
- [ ] **191.** Every chart got a gear

## 2026-08-07

- [ ] **192.** Restart the NAS after a publish without SSH
- [ ] **193.** The app works on a phone — one layout boundary at 1024px, decided server-side
- [ ] **194.** Installable to the home screen
- [ ] **195.** Stocks: ticker viewer as cards, with Events and Yahoo Detail tabs
- [ ] **196.** Stocks: risk cached and served at any age, refreshed only by Recalculate
- [ ] **197.** Stocks: earnings data no longer vanishes (Yahoo User-Agent and crumb race)
- [ ] **198.** Home: the module grid becomes a carousel with per-module artwork
- [ ] **199.** Image uploads send a File in FormData rather than base64

## 2026-08-05

- [ ] **200.** Stocks: positions split into Stocks / ETF / Others
- [ ] **201.** Stocks: Daily Glance — one table for the three buckets, with the total
- [ ] **202.** Stocks: Account Performance Over Time on one set of axes
- [ ] **203.** Stocks: remember which account a broker's CSV label means
- [ ] **204.** Hide the sidebar to its accent strip, and give the page back the gutter
- [ ] **205.** Stocks: performance chart points shaped by what they are
- [ ] **206.** Stocks: ticker viewer — everything about one symbol in one dialog
- [ ] **207.** Stocks: choose which dashboard widgets show, and in what order
- [ ] **208.** Stocks: record the brokerage firm on a trade, and fix duplicate detection
- [ ] **209.** Stocks: cost basis, so total return is possible at all
- [ ] **210.** Stocks: daily snapshots, value and gain/loss per bucket
- [ ] **211.** Stocks: an icon per investment account
- [ ] **212.** Stocks: eight routed sections behind a TreeNav, loading per section
- [ ] **213.** Stocks: Refresh All with per-ticker progress
- [ ] **214.** Stocks: a per-ticker news lookup
- [ ] **215.** CSV import: one screen for all three types, listing every row
- [ ] **216.** A verification gate: typecheck, boundary, tests, migration dry-run, e2e

## 2026-08-03

- [ ] **217.** Full-width layout: one shared container across every full-page screen
- [ ] **218.** A fixed sidebar raised above the page, so a module gets the rest of the screen
- [ ] **219.** Expense: spend stats
- [ ] **220.** Expense: an auto-import switch
- [ ] **221.** Expense: an uploadable icon per category
- [ ] **222.** Stocks: cache and show ticker logos
- [ ] **223.** DataGrid: filter expressions
- [ ] **224.** DataGrid: column aggregates
- [ ] **225.** DataGrid: record view
- [ ] **226.** Modal extracted as its own component
- [ ] **227.** Three colour themes and three icon sets

## 2026-08-02

- [ ] **228.** Expense: automatic CSV import from a watched folder, one sub-folder per card
- [ ] **229.** Expense: a processed file is renamed .backup, a failure .failed
- [ ] **230.** Expense: post-import rules — one condition, any number of field assignments
- [ ] **231.** Expense: "Manually Run Import Clean up" with real progress
- [ ] **232.** Expense: the tree-nav overhaul
- [ ] **233.** Expense: a new module for credit-card spending
- [ ] **234.** Expense: fuzzy auto-categorisation by glob against the statement description
- [ ] **235.** Expense: CSV import with a saved column mapping per card company
- [ ] **236.** Admin: import daily quotes from a newsletter

## 2026-07-30

- [ ] **237.** Result grid: search, filters, sticky header, column control, row selection
- [ ] **238.** Journal: entry authoring with category/tag autocomplete
- [ ] **239.** Journal: a Leaflet location picker with search and multiple pins
- [ ] **240.** Journal: fetch today's weather
- [ ] **241.** Journal: the entry screen, with Print/Save-PDF, Edit, Lock and Delete
- [ ] **242.** Journal: Today In History

## 2026-07-27

- [ ] **243.** Journal: a new module, with CSV import of a real export
- [ ] **244.** Real Estate and Property Watch removed
- [ ] **245.** Every table renamed to a 3-letter module prefix
- [ ] **246.** Daily Quote

## 2026-07-25

- [ ] **247.** Self-signup, always as a plain user with no module access
- [ ] **248.** Admin elevation behind a secret that stays hidden until you type "adm"
- [ ] **249.** User-selectable module icon sets
- [ ] **250.** Daybreak, the first light theme

## 2026-07-21

- [ ] **251.** Interactive DataGrid: click-to-sort, paging, Export CSV, Show SQL
- [ ] **252.** CSV Analysis: Show Data and Chart per entry
- [ ] **253.** CSV chart builder with presets
- [ ] **254.** ChartXY: line/bar/scatter/area with zoom

## 2026-07-19

- [ ] **255.** CSV Analytics: a new module
- [ ] **256.** Theme and UI polish
- [ ] **257.** ARM/Synology NAS deployment support

## 2026-07-18

- [ ] **258.** Stocks & ETFs: accounts, positions, transactions and portfolio summary
- [ ] **259.** Stocks & ETFs: a Yahoo Finance market-data client with manual/CLI refresh
- [ ] **260.** Stocks & ETFs: volatility, correlation and Sharpe analytics
- [ ] **261.** Stocks & ETFs: a Next Day Actions signal scanner
- [ ] **262.** Stocks & ETFs: CSV import with saved column-mapping presets
- [ ] **263.** Admin: SQL Explorer
- [ ] **264.** ChartLine, ChartBar and Tabs components
- [ ] **265.** Publish applies pending migrations, with an automatic backup
- [ ] **266.** ~~Real Estate: property portfolio and a RentCast watch list~~ *(removed 2026-07-27, migration 0026)*

## 2026-07-13

- [ ] **267.** Google auto-registration
- [ ] **268.** User avatars
- [ ] **269.** start.bat port cleanup

## 2026-07-12

- [ ] **270.** User management
- [ ] **271.** Authentication and Google sign-in
- [ ] **272.** Administration section
- [ ] **273.** Module Settings
- [ ] **274.** Initial scaffold: modules, settings, admin section
