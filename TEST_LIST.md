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

## 2026-09-27 — Release (My Shortcuts, uploaded icons)

**Migrations 0114 and 0115 must both be applied** — `sys_user_shortcuts` and then
its two icon-upload columns. 0115 exists because 0114 had already run on the NAS
when the columns were needed; an earlier attempt folded them into 0114, which the
runner skipped, and every home screen died on `no such column: icon_image`. If
items 1–9 report a missing table or column, check `sys_schema_migrations` before
reading anything here as a bug.

Items 1–9 are the new card. **Item 6 is the one that matters most** — it is the
privacy boundary, and it needs two accounts: shortcuts and their uploaded pictures
are per-person, unlike every other image in this app. Item 4 needs a second
account too, or a module grant revoked, to see a shortcut go unavailable rather
than vanish.

Item 10 is desktop-only (there is no hover on a phone); item 11 is its phone
counterpart, where the tile controls are always visible instead.

- [ ] **1.** Home: the My Shortcuts card appears, and Admin → Display Settings → Dashboard Widgets can hide and reorder it like any other card
- [ ] **2.** Add a shortcut to a web address — a bare `example.com` gets `https://` added, and the tile opens it in a new tab
- [ ] **3.** Add a shortcut to a page in this app: pick a module, then a section — and separately, a module's own main page
- [ ] **4.** A shortcut into a module you can no longer open draws greyed out with a reason, rather than disappearing
- [ ] **5.** Upload a picture as a shortcut's icon; removing it falls back to the glyph underneath rather than leaving the tile blank
- [ ] **6.** Two accounts: each sees only their own shortcuts, and one cannot fetch the other's uploaded icon by its URL
- [ ] **7.** Edit, reorder and remove a shortcut from the card itself; renaming one keeps its uploaded picture
- [ ] **8.** The twelfth shortcut is the last — Add is refused with a message rather than failing silently
- [ ] **9.** An oversized picture (over 256 KB) is refused immediately with the app's own wording, not a server error
- [ ] **10.** Desktop: shortcut tiles read as 3D buttons — they lift on hover and press down on click, and the row controls appear on hover
- [ ] **11.** Phone: the tiles reflow to the width available and their edit controls are visible without hovering
- [ ] **12.** Navigation: a section group whose heading has its own page draws as a link with its glyph; headings without one stay plain labels
- [ ] **13.** Music: reorder a playlist entry up and down — a playlist holding the same track twice moves the two copies independently
- [ ] **14.** Administration → About loads and shows its disk figures (this screen previously failed to build)

---

## 2026-09-25 — Release (navigation tree)

**No migration.** The remembered expanded set is a new key in the existing
`sys_user_preferences` table, so nothing schema-level shipped here.

**This release replaces the navigation on every desktop screen in the app**, so
item 15 is the one that matters: if `NavTree` fails to render, every page behind
the login goes with it. Check that first and the rest afterwards.

Items 15–20 are desktop-only by design. Item 21 is the counterpart and is
arguably the more important check of the two — the phone was deliberately left
alone, so the test is that nothing about it *changed*. Item 22 needs two devices,
or one device and a logout, to prove the preference is stored per person rather
than in that browser.

- [ ] **15.** Every module and Admin: the left column is one tree — Home on top, each module a heading that expands to its sections
- [ ] **16.** The tree: clicking a module heading expands and collapses it; the module you are currently in is always open
- [ ] **17.** Filter: typing `import` finds Journal, Investments and Expense sections together, each labelled with its module
- [ ] **18.** Filter: matches starting with what you typed rank first; Esc clears; clearing restores the collapse state you had
- [ ] **19.** Collapse: `«` folds the tree to a thin strip and the content widens; the strip and the header's `»` both reopen it
- [ ] **20.** Icons: Admin → Display Settings → Icons can replace the tree's Home and filter glyphs, and each module's section icons still resolve
- [ ] **21.** Phone: the bottom bar and its sheet behave exactly as before — no tree, no strip, nothing new
- [ ] **22.** The set of expanded modules survives a reload, and is remembered per user rather than per browser

---

## 2026-09-25 — Release

Migration 0112 (`sys_saved_sql_queries`) was applied on the NAS during this
release's publish. If items 8–10 ever report "no such table", that is the thing to
re-check before reading anything else here as a bug.

Item 11 costs live provider calls on every expand, so it can only really be judged
during market hours; item 13 needs a file whose tags actually carry lyrics, which
not every track in the library has. Item 15 is phone-relevant — the expanded index
panel adds six figures and a sparkline to a row that was already tight.

- [ ] **23.** Admin → SQL Explorer → SQL Query: save a statement with a name, description and tags; it appears on the Saved SQL card
- [ ] **24.** Admin → SQL Explorer: Load fills the editor and does **not** execute — confirm with a statement you would not want run
- [ ] **25.** Admin → SQL Explorer: saving under an existing name replaces that row, and the dialog warns before it does
- [ ] **26.** Investments → Indexes card: a row expands to show day range, 52-week range with its marker, moving averages, one-year change, all-time high and a sparkline
- [ ] **27.** Investments → Indexes card: a symbol whose second pass fails keeps its row and shows em-dashes (the three commodity futures have no one-year change)
- [ ] **28.** Music: a track with embedded lyrics shows them attributed "From this file's own tags", without a network lookup
- [ ] **29.** Music: a track with no embedded and no lrclib match offers the Google search link
- [ ] **30.** Investments → Indexes card: the expanded panel and sparkline are readable on a phone
- [ ] **31.** Admin → Daily Quote → All Quotes: the new nav entry opens the listing screen
- [ ] **32.** CLI: `saved-sql list` / `show` / `save` / `delete` behave as documented

---

## 2026-09-24 — Release

No new migrations: 0109–0111 shipped with the previous release and are already
applied on the NAS. Item 21 is the one to watch — the dedup rule changed, so a
scan that used to return nothing may now return groups, and blank-named places
can group on distance alone. Items 23 and 22 are phone-relevant: the popup and the
picker's refusal message both have to be readable narrow.

- [ ] **33.** Admin → Message Queue: the screen lists read and unread together, newest first, with each message's source
- [ ] **34.** Admin → Message Queue: tick rows and Delete removes them; Purge by age (7/30/90/365 days) clears everything older and keeps the rest
- [ ] **35.** Journal → Merging & Dedup: the "Within" slider (10–500m, default 75m) rescans on release, and groups found by distance are labelled "proximity"
- [ ] **36.** Journal → Merging & Dedup: two pins ~25–50m apart with similar names now group (they did not before); merging one still works
- [ ] **37.** Journal → entry form: adding a location already on the entry is refused with a message, and the draft pin stays put — from both the map tab and the library tab
- [ ] **38.** Journal: clicking a numbered map pin opens a popup with number, name, address, coordinates and chips, readable in the dark theme
- [ ] **39.** Journal: a single entry page shows the module rail, section panel and header (no more bare page with a "Back to My Journal" link)

---

## 2026-09-23 — Release

Migrations 0106, 0107 and 0108 are applied on the NAS. The Investments rename
touched ~83 files and renamed 17 tables, so the items below are worth a walk
through even where the screen looks unchanged — a missed server action throws
only when that one feature is used, not when the page loads.

- [ ] **40.** Investments: the module opens at /modules/investments, named Investments on the rail and home grid
- [ ] **41.** Investments: every section loads — Dashboard, Positions, Transactions, Account Performance, Watch & Test, Chart & Analysis, CSV Import, Tax Lots, Export for AI Analysis, Settings
- [ ] **42.** Investments: the actions still write — add/edit a position, a transaction, a watchlist entry, an account
- [ ] **43.** Investments: Tax Lots deep links still resolve (ticker picker, and the links out of the positions grid)
- [ ] **44.** Investments: CSV import of a broker file
- [ ] **45.** Admin → SQL Explorer: the Investments group lists the inv_ tables, and Table References names them
- [ ] **46.** Admin → Background Tasks: the Investments auto-refresh still finds its module
- [ ] **47.** Home: the Daily Glance card renders and its "Launch Investments" link goes to the new URL
- [ ] **48.** Investments: uploaded section/card icons survived the rename (slot ids were deliberately left on `stock_*`)
- [x] **49.** Expense: Transaction Rule Types — group rules by type, filter the rules list, manage types in Meta Data  — tested 2026-09-23
- [x] **50.** Security → Visits: why a visit was scored suspicious (signals on the row)

---

## 2026-09-22 — Release

- [x] **51.** CSV Analysis: pooled datasets
- [x] **52.** Admin-set preferences (allow edit user's preferences)
- [x] **53.** Location icons

## 2026-09-20

- [x] **54.** Journal: filter the category and tag lists in Meta Data
- [x] **55.** Journal: a saved-location library
- [x] **56.** Journal: Entries as one screen with two tabs
- [x] **57.** Tools: a CSV file browser beside the SQLite one

## 2026-09-19

- [x] **58.** Journal: keep or file a photo from an entry
- [x] **59.** TreeNav: each group reads as its own embossed card
- [x] **60.** Tools: SQLite uploads over 4 MB, with an admin-set cap
- [ ] **61.** Stocks: icons on the indexes board
- [ ] **62.** Stocks: playback of portfolio history
- [ ] **63.** Music: a sleep timer that stops the player after a set time

## 2026-09-17

- [ ] **64.** Home screen: launch a card's module from its title
- [ ] **65.** Journal: review existing entries before importing from a calendar
- [ ] **66.** Tools: a new module, opening with a SQLite file browser

## 2026-09-15

- [ ] **67.** Floating layer: a clock over every page
- [ ] **68.** Floating layer: a calculator over every page
- [ ] **69.** Floating layer: a scratchpad over every page
- [ ] **70.** Stocks: the indexes board loads when you open the card
- [ ] **71.** Admin: clear deployment records in bulk, or prune to the newest few
- [ ] **72.** Journal: jump to the next day that has an entry
- [ ] **73.** NAS: a startup crash that says what broke

## 2026-09-14

- [ ] **74.** Journal: date the template suggestion by the local calendar
- [ ] **75.** Themes: tell the browser a dark theme is dark
- [ ] **76.** Export for AI: measured correlations, and the sectors you hold nothing in
- [ ] **77.** Home: a Clock card, with the weather where you are
- [ ] **78.** Picture Gallery: Magic List — photographs conjured from a description
- [ ] **79.** Stocks: candlesticks in the ticker viewer's Today card
- [ ] **80.** Stocks: consult AI about one ticker
- [ ] **81.** Stocks: a transaction knows which account it belongs to

## 2026-09-13

- [ ] **82.** Attendance: bigger cards in the register grid
- [ ] **83.** Admin: random theme generation
- [ ] **84.** Music Library: an Albums view
- [ ] **85.** Stocks & ETFs: a recorded trade can update the holding
- [ ] **86.** MyJournal: New Entry becomes a section
- [ ] **87.** Games: Bridge
- [ ] **88.** SQL Explorer: BLOB cells fetched on demand
- [ ] **89.** SQL Explorer: tables grouped by module
- [ ] **90.** Account: two compact navigation styles, and the reader picks
- [ ] **91.** Icon names: the compiler catches glyph-table drift

## 2026-09-11

- [ ] **92.** Journal: Calendar Import — read a Google/Outlook .ics and pick events to import
- [ ] **93.** Journal: re-importing a renamed or moved event updates it instead of duplicating
- [ ] **94.** Journal: a large .ics (2.4 MB) uploads without tripping the action-argument limit
- [ ] **95.** Journal: restoring an imported entry from the recycle bin keeps its identity
- [ ] **96.** Stocks: a portfolio brief for an LLM
- [ ] **97.** Attendance: one register per class per day again
- [ ] **98.** Attendance: session labels read in local time, not four hours ahead

## 2026-09-10

- [ ] **99.** Picture Gallery: albums
- [ ] **100.** Picture Gallery: a + on every photograph
- [ ] **101.** Home screen: a handwritten quote, no header, and a slimmer rail

## 2026-09-09

- [ ] **102.** Security: every exported server action authorises on its first line
- [ ] **103.** Stocks & ETFs: analyze several tickers at once, and link to an analysis
- [ ] **104.** Music Library: the song on YouTube
- [ ] **105.** Music Library: a real fullscreen visualizer
- [ ] **106.** Picture Gallery: a module of its own, not a corner of the home screen

## 2026-09-08

- [ ] **107.** Games: Mahjong pickers and board frame
- [ ] **108.** Stocks & ETFs: today's session in the ticker viewer
- [ ] **109.** Journal: a space-separated Tags column no longer imports as one long tag
- [ ] **110.** CSV Analytics: bulk edit rows
- [ ] **111.** CSV Analytics: a CLI for bulk edit
- [ ] **112.** Photographs: one viewer, with a capture timestamp and a heart

## 2026-09-06 — Release

- [ ] **113.** Games: Mahjong, the four-player game against three bots
- [ ] **114.** Stocks & ETFs: the Tax Lot Portfolio Analyzer
- [ ] **115.** About: count untagged changes instead of reporting zero
- [ ] **116.** Home: the Random Photo card streams instead of blocking first paint
- [ ] **117.** Photos: an absolute path can no longer escape the photo folder
- [ ] **118.** Compact grids: long values are readable
- [ ] **119.** Compact grids: a second layout for reading
- [ ] **120.** Music: the story behind the song, beside the lyrics
- [ ] **121.** Games: Mahjong Match
- [ ] **122.** Games: card icons across the whole arcade
- [ ] **123.** Attendance: upload your own icon for a student action
- [ ] **124.** CSV Analysis: named views over a dataset

## 2026-09-03

- [ ] **125.** Attendance: a class records the weekday it meets on
- [ ] **126.** Attendance: the home screen opens on today's register
- [ ] **127.** Photos: a viewer component with its own actions
- [ ] **128.** Journal: a photos slideshow and folder module
- [ ] **129.** Games: sudoku and blackjack polish
- [ ] **130.** Stocks: the refresh total counts up as prices land

## 2026-09-02 — Release

- [ ] **131.** Expense: top-5 cards link through to their transactions
- [ ] **132.** Expense: the vendor rollup stops inventing vendors from payment lines
- [ ] **133.** Stocks: the indexes refresh becomes an icon
- [ ] **134.** Favourite photos: a slideshow
- [ ] **135.** Carousel graphics are resized on upload
- [ ] **136.** SQL Explorer: a schema browser
- [ ] **137.** SQL Explorer: prose for every table
- [ ] **138.** Music: a spectrum analyser under the cover art
- [ ] **139.** Games: Sudoku
- [ ] **140.** Games: Blackjack
- [ ] **141.** Games: Minesweeper
- [ ] **142.** Journal: a recycle bin
- [ ] **143.** Journal: a Correct tab
- [ ] **144.** Journal: metadata backup

## 2026-09-01 — Release

- [ ] **145.** Journal import: an overwrite mode, with the plan shown before it writes
- [ ] **146.** Favourite photos: their own screen
- [ ] **147.** Favourite photos: a zip download
- [ ] **148.** Admin: a deployment history, with the build log attached
- [ ] **149.** Games: Tetris
- [ ] **150.** Games: Arrow Clearing becomes an actual puzzle
- [ ] **151.** SQL Explorer: a Truncate button, behind a warning that counts the rows
- [ ] **152.** Journal import: normalized entry time stops a re-import duplicating

## 2026-08-30

- [ ] **153.** Themes: colour themes are data, and the builder warns before you blind yourself
- [ ] **154.** Games: Arrow Clearing cannot generate an unsolvable board
- [ ] **155.** Games: an arcade, and a scoreboard the whole house shares

## 2026-08-29

- [ ] **156.** Stocks: five threads on refresh
- [ ] **157.** Stocks: a wildcard that was lying to you
- [ ] **158.** Home: the random photo card says how old the photo is
- [ ] **159.** Stocks: Watch & Test — watch lists, signals and simulation on one screen
- [ ] **160.** Expense: re-run a rule over transactions you have already imported
- [ ] **161.** Expense: a vendor is somebody now, not just a total

## 2026-08-28

- [ ] **162.** Home screen: arrange it yourself
- [ ] **163.** CSV Analysis: the two-tier nav
- [ ] **164.** Home: a photograph drawn at random
- [ ] **165.** Uploaded icons get cleaned up on the way in
- [ ] **166.** Icons: any single icon can be replaced without changing the icon set (73 slots)
- [ ] **167.** Admin → Configuration → Icons: upload an SVG or image per position
- [ ] **168.** Icons: uploaded SVG is sanitized on write
- [ ] **169.** Home: a picture behind the day
- [ ] **170.** Expense: rules that say why

## 2026-08-26

- [ ] **171.** Admin → Background Tasks: every timer in one place, including jobs that never ran
- [ ] **172.** A job killed mid-pass reads as interrupted, never as ok
- [ ] **173.** CLI: list-scheduled-jobs gives the same answer without the web server
- [ ] **174.** Last-run stamps survive the restarts a deploy performs
- [ ] **175.** Stocks: an Indexes card of eleven benchmarks in four groups
- [ ] **176.** Stocks: a new dashboard widget lands beside its neighbour, not at the bottom
- [ ] **177.** Stocks → Simulation: "what if I'd bought then?" across ten windows

## 2026-08-25

- [ ] **178.** Music: a scan that finishes (no OOM on a large NAS folder)
- [ ] **179.** Music: an abandoned scan run closes itself instead of reading "running" forever
- [ ] **180.** Progress3D: one progress bar across the app
- [ ] **181.** Per-module background pictures
- [ ] **182.** Attendance: a Detail report — the whole term as a grid
- [ ] **183.** About: a Server Log tab

## 2026-08-19

- [ ] **184.** Stocks: find a ticker, and star the ones you watch daily
- [ ] **185.** Music Library: Magic Playlists assembled from a query
- [ ] **186.** Music Library: a visible play queue
- [ ] **187.** Music Library: lyrics on demand
- [ ] **188.** Grids that count their own columns
- [ ] **189.** Seven more glyphs
- [ ] **190.** Ticker detail: how far a trade has moved since you made it
- [ ] **191.** Music Library: stream 20,000 songs off the NAS
- [ ] **192.** Attendance: two registers a day
- [ ] **193.** Attendance: student actions, a teacher-editable catalog
- [ ] **194.** Attendance: 12 icon sets, applied to the section nav too

## 2026-08-16

- [ ] **195.** Attendance: a new module — pick a class, tap who is here, save
- [ ] **196.** Attendance: a student can sit in several classes
- [ ] **197.** "Absent" and "attendance was never taken" stay distinguishable
- [ ] **198.** Admin → Security: a sign-in audit log recording logins, failures and logouts
- [ ] **199.** Stocks: allocation by sector
- [ ] **200.** Stocks: candlestick charts
- [ ] **201.** Admin: import daily quotes from a newsletter

## 2026-08-15

- [ ] **202.** Journal: clickable taxonomy
- [ ] **203.** About page: inline markdown in the change log
- [ ] **204.** About page: memory as meters
- [ ] **205.** Home: Daily Glance moves off the Stocks dashboard
- [ ] **206.** Installable PWA: stable identity, module shortcuts, iOS launch screens
- [ ] **207.** Per-user preferences: a favourite module you can open on startup

## 2026-08-14

- [ ] **208.** Journal: a filtered Entries browser with saved AND/OR filters
- [ ] **209.** Journal: icons for categories and tags
- [ ] **210.** Deploys apply their own migrations, and fail loudly rather than serving new code
- [ ] **211.** CSV Analytics: add columns without re-importing a file
- [ ] **212.** ModuleCarousel: a grid on desktop, coverflow on phones
- [ ] **213.** DataGrid: column headers popped up into a 3D bar
- [ ] **214.** Journal: home-screen search
- [ ] **215.** The section bar moved to the bottom, and modules collapsed into a menu

## 2026-08-11

- [ ] **216.** CSV Analytics: add custom columns during append/truncate

## 2026-08-10

- [ ] **217.** The section tree became a bar, and surfaces learned to lift

## 2026-08-08

- [ ] **218.** The compact section bar
- [ ] **219.** User management gated on admin
- [ ] **220.** Home: announce a new deployment
- [ ] **221.** Navigation moved to the edges — a top bar plus a compact bottom module bar
- [ ] **222.** Both nav bars minimise to a puck and remember it
- [ ] **223.** Every chart got a gear

## 2026-08-07

- [ ] **224.** Restart the NAS after a publish without SSH
- [ ] **225.** The app works on a phone — one layout boundary at 1024px, decided server-side
- [ ] **226.** Installable to the home screen
- [ ] **227.** Stocks: ticker viewer as cards, with Events and Yahoo Detail tabs
- [ ] **228.** Stocks: risk cached and served at any age, refreshed only by Recalculate
- [ ] **229.** Stocks: earnings data no longer vanishes (Yahoo User-Agent and crumb race)
- [ ] **230.** Home: the module grid becomes a carousel with per-module artwork
- [ ] **231.** Image uploads send a File in FormData rather than base64

## 2026-08-05

- [ ] **232.** Stocks: positions split into Stocks / ETF / Others
- [ ] **233.** Stocks: Daily Glance — one table for the three buckets, with the total
- [ ] **234.** Stocks: Account Performance Over Time on one set of axes
- [ ] **235.** Stocks: remember which account a broker's CSV label means
- [ ] **236.** Hide the sidebar to its accent strip, and give the page back the gutter
- [ ] **237.** Stocks: performance chart points shaped by what they are
- [ ] **238.** Stocks: ticker viewer — everything about one symbol in one dialog
- [ ] **239.** Stocks: choose which dashboard widgets show, and in what order
- [ ] **240.** Stocks: record the brokerage firm on a trade, and fix duplicate detection
- [ ] **241.** Stocks: cost basis, so total return is possible at all
- [ ] **242.** Stocks: daily snapshots, value and gain/loss per bucket
- [ ] **243.** Stocks: an icon per investment account
- [ ] **244.** Stocks: eight routed sections behind a TreeNav, loading per section
- [ ] **245.** Stocks: Refresh All with per-ticker progress
- [ ] **246.** Stocks: a per-ticker news lookup
- [ ] **247.** CSV import: one screen for all three types, listing every row
- [ ] **248.** A verification gate: typecheck, boundary, tests, migration dry-run, e2e

## 2026-08-03

- [ ] **249.** Full-width layout: one shared container across every full-page screen
- [ ] **250.** A fixed sidebar raised above the page, so a module gets the rest of the screen
- [ ] **251.** Expense: spend stats
- [ ] **252.** Expense: an auto-import switch
- [ ] **253.** Expense: an uploadable icon per category
- [ ] **254.** Stocks: cache and show ticker logos
- [ ] **255.** DataGrid: filter expressions
- [ ] **256.** DataGrid: column aggregates
- [ ] **257.** DataGrid: record view
- [ ] **258.** Modal extracted as its own component
- [ ] **259.** Three colour themes and three icon sets

## 2026-08-02

- [ ] **260.** Expense: automatic CSV import from a watched folder, one sub-folder per card
- [ ] **261.** Expense: a processed file is renamed .backup, a failure .failed
- [ ] **262.** Expense: post-import rules — one condition, any number of field assignments
- [ ] **263.** Expense: "Manually Run Import Clean up" with real progress
- [ ] **264.** Expense: the tree-nav overhaul
- [ ] **265.** Expense: a new module for credit-card spending
- [ ] **266.** Expense: fuzzy auto-categorisation by glob against the statement description
- [ ] **267.** Expense: CSV import with a saved column mapping per card company
- [ ] **268.** Admin: import daily quotes from a newsletter

## 2026-07-30

- [ ] **269.** Result grid: search, filters, sticky header, column control, row selection
- [ ] **270.** Journal: entry authoring with category/tag autocomplete
- [ ] **271.** Journal: a Leaflet location picker with search and multiple pins
- [ ] **272.** Journal: fetch today's weather
- [ ] **273.** Journal: the entry screen, with Print/Save-PDF, Edit, Lock and Delete
- [ ] **274.** Journal: Today In History

## 2026-07-27

- [ ] **275.** Journal: a new module, with CSV import of a real export
- [ ] **276.** Real Estate and Property Watch removed
- [ ] **277.** Every table renamed to a 3-letter module prefix
- [ ] **278.** Daily Quote

## 2026-07-25

- [ ] **279.** Self-signup, always as a plain user with no module access
- [ ] **280.** Admin elevation behind a secret that stays hidden until you type "adm"
- [ ] **281.** User-selectable module icon sets
- [ ] **282.** Daybreak, the first light theme

## 2026-07-21

- [ ] **283.** Interactive DataGrid: click-to-sort, paging, Export CSV, Show SQL
- [ ] **284.** CSV Analysis: Show Data and Chart per entry
- [ ] **285.** CSV chart builder with presets
- [ ] **286.** ChartXY: line/bar/scatter/area with zoom

## 2026-07-19

- [ ] **287.** CSV Analytics: a new module
- [ ] **288.** Theme and UI polish
- [ ] **289.** ARM/Synology NAS deployment support

## 2026-07-18

- [ ] **290.** Stocks & ETFs: accounts, positions, transactions and portfolio summary
- [ ] **291.** Stocks & ETFs: a Yahoo Finance market-data client with manual/CLI refresh
- [ ] **292.** Stocks & ETFs: volatility, correlation and Sharpe analytics
- [ ] **293.** Stocks & ETFs: a Next Day Actions signal scanner
- [ ] **294.** Stocks & ETFs: CSV import with saved column-mapping presets
- [ ] **295.** Admin: SQL Explorer
- [ ] **296.** ChartLine, ChartBar and Tabs components
- [ ] **297.** Publish applies pending migrations, with an automatic backup
- [ ] **298.** ~~Real Estate: property portfolio and a RentCast watch list~~ *(removed 2026-07-27, migration 0026)*

## 2026-07-13

- [ ] **299.** Google auto-registration
- [ ] **300.** User avatars
- [ ] **301.** start.bat port cleanup

## 2026-07-12

- [ ] **302.** User management
- [ ] **303.** Authentication and Google sign-in
- [ ] **304.** Administration section
- [ ] **305.** Module Settings
- [ ] **306.** Initial scaffold: modules, settings, admin section
