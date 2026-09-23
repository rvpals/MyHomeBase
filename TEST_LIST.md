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

## 2026-09-23 — Release

Migrations 0106, 0107 and 0108 are applied on the NAS. The Investments rename
touched ~83 files and renamed 17 tables, so the items below are worth a walk
through even where the screen looks unchanged — a missed server action throws
only when that one feature is used, not when the page loads.

- [ ] **1.** Investments: the module opens at /modules/investments, named Investments on the rail and home grid
- [ ] **2.** Investments: every section loads — Dashboard, Positions, Transactions, Account Performance, Watch & Test, Chart & Analysis, CSV Import, Tax Lots, Export for AI Analysis, Settings
- [ ] **3.** Investments: the actions still write — add/edit a position, a transaction, a watchlist entry, an account
- [ ] **4.** Investments: Tax Lots deep links still resolve (ticker picker, and the links out of the positions grid)
- [ ] **5.** Investments: CSV import of a broker file
- [ ] **6.** Admin → SQL Explorer: the Investments group lists the inv_ tables, and Table References names them
- [ ] **7.** Admin → Background Tasks: the Investments auto-refresh still finds its module
- [ ] **8.** Home: the Daily Glance card renders and its "Launch Investments" link goes to the new URL
- [ ] **9.** Investments: uploaded section/card icons survived the rename (slot ids were deliberately left on `stock_*`)
- [x] **10.** Expense: Transaction Rule Types — group rules by type, filter the rules list, manage types in Meta Data  — tested 2026-09-23
- [x] **11.** Security → Visits: why a visit was scored suspicious (signals on the row)

---

## 2026-09-22 — Release

- [x] **12.** CSV Analysis: pooled datasets
- [x] **13.** Admin-set preferences (allow edit user's preferences)
- [x] **14.** Location icons

## 2026-09-20

- [x] **15.** Journal: filter the category and tag lists in Meta Data
- [x] **16.** Journal: a saved-location library
- [x] **17.** Journal: Entries as one screen with two tabs
- [x] **18.** Tools: a CSV file browser beside the SQLite one

## 2026-09-19

- [x] **19.** Journal: keep or file a photo from an entry
- [x] **20.** TreeNav: each group reads as its own embossed card
- [x] **21.** Tools: SQLite uploads over 4 MB, with an admin-set cap
- [ ] **22.** Stocks: icons on the indexes board
- [ ] **23.** Stocks: playback of portfolio history
- [ ] **24.** Music: a sleep timer that stops the player after a set time

## 2026-09-17

- [ ] **25.** Home screen: launch a card's module from its title
- [ ] **26.** Journal: review existing entries before importing from a calendar
- [ ] **27.** Tools: a new module, opening with a SQLite file browser

## 2026-09-15

- [ ] **28.** Floating layer: a clock over every page
- [ ] **29.** Floating layer: a calculator over every page
- [ ] **30.** Floating layer: a scratchpad over every page
- [ ] **31.** Stocks: the indexes board loads when you open the card
- [ ] **32.** Admin: clear deployment records in bulk, or prune to the newest few
- [ ] **33.** Journal: jump to the next day that has an entry
- [ ] **34.** NAS: a startup crash that says what broke

## 2026-09-14

- [ ] **35.** Journal: date the template suggestion by the local calendar
- [ ] **36.** Themes: tell the browser a dark theme is dark
- [ ] **37.** Export for AI: measured correlations, and the sectors you hold nothing in
- [ ] **38.** Home: a Clock card, with the weather where you are
- [ ] **39.** Picture Gallery: Magic List — photographs conjured from a description
- [ ] **40.** Stocks: candlesticks in the ticker viewer's Today card
- [ ] **41.** Stocks: consult AI about one ticker
- [ ] **42.** Stocks: a transaction knows which account it belongs to

## 2026-09-13

- [ ] **43.** Attendance: bigger cards in the register grid
- [ ] **44.** Admin: random theme generation
- [ ] **45.** Music Library: an Albums view
- [ ] **46.** Stocks & ETFs: a recorded trade can update the holding
- [ ] **47.** MyJournal: New Entry becomes a section
- [ ] **48.** Games: Bridge
- [ ] **49.** SQL Explorer: BLOB cells fetched on demand
- [ ] **50.** SQL Explorer: tables grouped by module
- [ ] **51.** Account: two compact navigation styles, and the reader picks
- [ ] **52.** Icon names: the compiler catches glyph-table drift

## 2026-09-11

- [ ] **53.** Journal: Calendar Import — read a Google/Outlook .ics and pick events to import
- [ ] **54.** Journal: re-importing a renamed or moved event updates it instead of duplicating
- [ ] **55.** Journal: a large .ics (2.4 MB) uploads without tripping the action-argument limit
- [ ] **56.** Journal: restoring an imported entry from the recycle bin keeps its identity
- [ ] **57.** Stocks: a portfolio brief for an LLM
- [ ] **58.** Attendance: one register per class per day again
- [ ] **59.** Attendance: session labels read in local time, not four hours ahead

## 2026-09-10

- [ ] **60.** Picture Gallery: albums
- [ ] **61.** Picture Gallery: a + on every photograph
- [ ] **62.** Home screen: a handwritten quote, no header, and a slimmer rail

## 2026-09-09

- [ ] **63.** Security: every exported server action authorises on its first line
- [ ] **64.** Stocks & ETFs: analyze several tickers at once, and link to an analysis
- [ ] **65.** Music Library: the song on YouTube
- [ ] **66.** Music Library: a real fullscreen visualizer
- [ ] **67.** Picture Gallery: a module of its own, not a corner of the home screen

## 2026-09-08

- [ ] **68.** Games: Mahjong pickers and board frame
- [ ] **69.** Stocks & ETFs: today's session in the ticker viewer
- [ ] **70.** Journal: a space-separated Tags column no longer imports as one long tag
- [ ] **71.** CSV Analytics: bulk edit rows
- [ ] **72.** CSV Analytics: a CLI for bulk edit
- [ ] **73.** Photographs: one viewer, with a capture timestamp and a heart

## 2026-09-06 — Release

- [ ] **74.** Games: Mahjong, the four-player game against three bots
- [ ] **75.** Stocks & ETFs: the Tax Lot Portfolio Analyzer
- [ ] **76.** About: count untagged changes instead of reporting zero
- [ ] **77.** Home: the Random Photo card streams instead of blocking first paint
- [ ] **78.** Photos: an absolute path can no longer escape the photo folder
- [ ] **79.** Compact grids: long values are readable
- [ ] **80.** Compact grids: a second layout for reading
- [ ] **81.** Music: the story behind the song, beside the lyrics
- [ ] **82.** Games: Mahjong Match
- [ ] **83.** Games: card icons across the whole arcade
- [ ] **84.** Attendance: upload your own icon for a student action
- [ ] **85.** CSV Analysis: named views over a dataset

## 2026-09-03

- [ ] **86.** Attendance: a class records the weekday it meets on
- [ ] **87.** Attendance: the home screen opens on today's register
- [ ] **88.** Photos: a viewer component with its own actions
- [ ] **89.** Journal: a photos slideshow and folder module
- [ ] **90.** Games: sudoku and blackjack polish
- [ ] **91.** Stocks: the refresh total counts up as prices land

## 2026-09-02 — Release

- [ ] **92.** Expense: top-5 cards link through to their transactions
- [ ] **93.** Expense: the vendor rollup stops inventing vendors from payment lines
- [ ] **94.** Stocks: the indexes refresh becomes an icon
- [ ] **95.** Favourite photos: a slideshow
- [ ] **96.** Carousel graphics are resized on upload
- [ ] **97.** SQL Explorer: a schema browser
- [ ] **98.** SQL Explorer: prose for every table
- [ ] **99.** Music: a spectrum analyser under the cover art
- [ ] **100.** Games: Sudoku
- [ ] **101.** Games: Blackjack
- [ ] **102.** Games: Minesweeper
- [ ] **103.** Journal: a recycle bin
- [ ] **104.** Journal: a Correct tab
- [ ] **105.** Journal: metadata backup

## 2026-09-01 — Release

- [ ] **106.** Journal import: an overwrite mode, with the plan shown before it writes
- [ ] **107.** Favourite photos: their own screen
- [ ] **108.** Favourite photos: a zip download
- [ ] **109.** Admin: a deployment history, with the build log attached
- [ ] **110.** Games: Tetris
- [ ] **111.** Games: Arrow Clearing becomes an actual puzzle
- [ ] **112.** SQL Explorer: a Truncate button, behind a warning that counts the rows
- [ ] **113.** Journal import: normalized entry time stops a re-import duplicating

## 2026-08-30

- [ ] **114.** Themes: colour themes are data, and the builder warns before you blind yourself
- [ ] **115.** Games: Arrow Clearing cannot generate an unsolvable board
- [ ] **116.** Games: an arcade, and a scoreboard the whole house shares

## 2026-08-29

- [ ] **117.** Stocks: five threads on refresh
- [ ] **118.** Stocks: a wildcard that was lying to you
- [ ] **119.** Home: the random photo card says how old the photo is
- [ ] **120.** Stocks: Watch & Test — watch lists, signals and simulation on one screen
- [ ] **121.** Expense: re-run a rule over transactions you have already imported
- [ ] **122.** Expense: a vendor is somebody now, not just a total

## 2026-08-28

- [ ] **123.** Home screen: arrange it yourself
- [ ] **124.** CSV Analysis: the two-tier nav
- [ ] **125.** Home: a photograph drawn at random
- [ ] **126.** Uploaded icons get cleaned up on the way in
- [ ] **127.** Icons: any single icon can be replaced without changing the icon set (73 slots)
- [ ] **128.** Admin → Configuration → Icons: upload an SVG or image per position
- [ ] **129.** Icons: uploaded SVG is sanitized on write
- [ ] **130.** Home: a picture behind the day
- [ ] **131.** Expense: rules that say why

## 2026-08-26

- [ ] **132.** Admin → Background Tasks: every timer in one place, including jobs that never ran
- [ ] **133.** A job killed mid-pass reads as interrupted, never as ok
- [ ] **134.** CLI: list-scheduled-jobs gives the same answer without the web server
- [ ] **135.** Last-run stamps survive the restarts a deploy performs
- [ ] **136.** Stocks: an Indexes card of eleven benchmarks in four groups
- [ ] **137.** Stocks: a new dashboard widget lands beside its neighbour, not at the bottom
- [ ] **138.** Stocks → Simulation: "what if I'd bought then?" across ten windows

## 2026-08-25

- [ ] **139.** Music: a scan that finishes (no OOM on a large NAS folder)
- [ ] **140.** Music: an abandoned scan run closes itself instead of reading "running" forever
- [ ] **141.** Progress3D: one progress bar across the app
- [ ] **142.** Per-module background pictures
- [ ] **143.** Attendance: a Detail report — the whole term as a grid
- [ ] **144.** About: a Server Log tab

## 2026-08-19

- [ ] **145.** Stocks: find a ticker, and star the ones you watch daily
- [ ] **146.** Music Library: Magic Playlists assembled from a query
- [ ] **147.** Music Library: a visible play queue
- [ ] **148.** Music Library: lyrics on demand
- [ ] **149.** Grids that count their own columns
- [ ] **150.** Seven more glyphs
- [ ] **151.** Ticker detail: how far a trade has moved since you made it
- [ ] **152.** Music Library: stream 20,000 songs off the NAS
- [ ] **153.** Attendance: two registers a day
- [ ] **154.** Attendance: student actions, a teacher-editable catalog
- [ ] **155.** Attendance: 12 icon sets, applied to the section nav too

## 2026-08-16

- [ ] **156.** Attendance: a new module — pick a class, tap who is here, save
- [ ] **157.** Attendance: a student can sit in several classes
- [ ] **158.** "Absent" and "attendance was never taken" stay distinguishable
- [ ] **159.** Admin → Security: a sign-in audit log recording logins, failures and logouts
- [ ] **160.** Stocks: allocation by sector
- [ ] **161.** Stocks: candlestick charts
- [ ] **162.** Admin: import daily quotes from a newsletter

## 2026-08-15

- [ ] **163.** Journal: clickable taxonomy
- [ ] **164.** About page: inline markdown in the change log
- [ ] **165.** About page: memory as meters
- [ ] **166.** Home: Daily Glance moves off the Stocks dashboard
- [ ] **167.** Installable PWA: stable identity, module shortcuts, iOS launch screens
- [ ] **168.** Per-user preferences: a favourite module you can open on startup

## 2026-08-14

- [ ] **169.** Journal: a filtered Entries browser with saved AND/OR filters
- [ ] **170.** Journal: icons for categories and tags
- [ ] **171.** Deploys apply their own migrations, and fail loudly rather than serving new code
- [ ] **172.** CSV Analytics: add columns without re-importing a file
- [ ] **173.** ModuleCarousel: a grid on desktop, coverflow on phones
- [ ] **174.** DataGrid: column headers popped up into a 3D bar
- [ ] **175.** Journal: home-screen search
- [ ] **176.** The section bar moved to the bottom, and modules collapsed into a menu

## 2026-08-11

- [ ] **177.** CSV Analytics: add custom columns during append/truncate

## 2026-08-10

- [ ] **178.** The section tree became a bar, and surfaces learned to lift

## 2026-08-08

- [ ] **179.** The compact section bar
- [ ] **180.** User management gated on admin
- [ ] **181.** Home: announce a new deployment
- [ ] **182.** Navigation moved to the edges — a top bar plus a compact bottom module bar
- [ ] **183.** Both nav bars minimise to a puck and remember it
- [ ] **184.** Every chart got a gear

## 2026-08-07

- [ ] **185.** Restart the NAS after a publish without SSH
- [ ] **186.** The app works on a phone — one layout boundary at 1024px, decided server-side
- [ ] **187.** Installable to the home screen
- [ ] **188.** Stocks: ticker viewer as cards, with Events and Yahoo Detail tabs
- [ ] **189.** Stocks: risk cached and served at any age, refreshed only by Recalculate
- [ ] **190.** Stocks: earnings data no longer vanishes (Yahoo User-Agent and crumb race)
- [ ] **191.** Home: the module grid becomes a carousel with per-module artwork
- [ ] **192.** Image uploads send a File in FormData rather than base64

## 2026-08-05

- [ ] **193.** Stocks: positions split into Stocks / ETF / Others
- [ ] **194.** Stocks: Daily Glance — one table for the three buckets, with the total
- [ ] **195.** Stocks: Account Performance Over Time on one set of axes
- [ ] **196.** Stocks: remember which account a broker's CSV label means
- [ ] **197.** Hide the sidebar to its accent strip, and give the page back the gutter
- [ ] **198.** Stocks: performance chart points shaped by what they are
- [ ] **199.** Stocks: ticker viewer — everything about one symbol in one dialog
- [ ] **200.** Stocks: choose which dashboard widgets show, and in what order
- [ ] **201.** Stocks: record the brokerage firm on a trade, and fix duplicate detection
- [ ] **202.** Stocks: cost basis, so total return is possible at all
- [ ] **203.** Stocks: daily snapshots, value and gain/loss per bucket
- [ ] **204.** Stocks: an icon per investment account
- [ ] **205.** Stocks: eight routed sections behind a TreeNav, loading per section
- [ ] **206.** Stocks: Refresh All with per-ticker progress
- [ ] **207.** Stocks: a per-ticker news lookup
- [ ] **208.** CSV import: one screen for all three types, listing every row
- [ ] **209.** A verification gate: typecheck, boundary, tests, migration dry-run, e2e

## 2026-08-03

- [ ] **210.** Full-width layout: one shared container across every full-page screen
- [ ] **211.** A fixed sidebar raised above the page, so a module gets the rest of the screen
- [ ] **212.** Expense: spend stats
- [ ] **213.** Expense: an auto-import switch
- [ ] **214.** Expense: an uploadable icon per category
- [ ] **215.** Stocks: cache and show ticker logos
- [ ] **216.** DataGrid: filter expressions
- [ ] **217.** DataGrid: column aggregates
- [ ] **218.** DataGrid: record view
- [ ] **219.** Modal extracted as its own component
- [ ] **220.** Three colour themes and three icon sets

## 2026-08-02

- [ ] **221.** Expense: automatic CSV import from a watched folder, one sub-folder per card
- [ ] **222.** Expense: a processed file is renamed .backup, a failure .failed
- [ ] **223.** Expense: post-import rules — one condition, any number of field assignments
- [ ] **224.** Expense: "Manually Run Import Clean up" with real progress
- [ ] **225.** Expense: the tree-nav overhaul
- [ ] **226.** Expense: a new module for credit-card spending
- [ ] **227.** Expense: fuzzy auto-categorisation by glob against the statement description
- [ ] **228.** Expense: CSV import with a saved column mapping per card company
- [ ] **229.** Admin: import daily quotes from a newsletter

## 2026-07-30

- [ ] **230.** Result grid: search, filters, sticky header, column control, row selection
- [ ] **231.** Journal: entry authoring with category/tag autocomplete
- [ ] **232.** Journal: a Leaflet location picker with search and multiple pins
- [ ] **233.** Journal: fetch today's weather
- [ ] **234.** Journal: the entry screen, with Print/Save-PDF, Edit, Lock and Delete
- [ ] **235.** Journal: Today In History

## 2026-07-27

- [ ] **236.** Journal: a new module, with CSV import of a real export
- [ ] **237.** Real Estate and Property Watch removed
- [ ] **238.** Every table renamed to a 3-letter module prefix
- [ ] **239.** Daily Quote

## 2026-07-25

- [ ] **240.** Self-signup, always as a plain user with no module access
- [ ] **241.** Admin elevation behind a secret that stays hidden until you type "adm"
- [ ] **242.** User-selectable module icon sets
- [ ] **243.** Daybreak, the first light theme

## 2026-07-21

- [ ] **244.** Interactive DataGrid: click-to-sort, paging, Export CSV, Show SQL
- [ ] **245.** CSV Analysis: Show Data and Chart per entry
- [ ] **246.** CSV chart builder with presets
- [ ] **247.** ChartXY: line/bar/scatter/area with zoom

## 2026-07-19

- [ ] **248.** CSV Analytics: a new module
- [ ] **249.** Theme and UI polish
- [ ] **250.** ARM/Synology NAS deployment support

## 2026-07-18

- [ ] **251.** Stocks & ETFs: accounts, positions, transactions and portfolio summary
- [ ] **252.** Stocks & ETFs: a Yahoo Finance market-data client with manual/CLI refresh
- [ ] **253.** Stocks & ETFs: volatility, correlation and Sharpe analytics
- [ ] **254.** Stocks & ETFs: a Next Day Actions signal scanner
- [ ] **255.** Stocks & ETFs: CSV import with saved column-mapping presets
- [ ] **256.** Admin: SQL Explorer
- [ ] **257.** ChartLine, ChartBar and Tabs components
- [ ] **258.** Publish applies pending migrations, with an automatic backup
- [ ] **259.** ~~Real Estate: property portfolio and a RentCast watch list~~ *(removed 2026-07-27, migration 0026)*

## 2026-07-13

- [ ] **260.** Google auto-registration
- [ ] **261.** User avatars
- [ ] **262.** start.bat port cleanup

## 2026-07-12

- [ ] **263.** User management
- [ ] **264.** Authentication and Google sign-in
- [ ] **265.** Administration section
- [ ] **266.** Module Settings
- [ ] **267.** Initial scaffold: modules, settings, admin section
