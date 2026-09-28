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

## 2026-09-28 — Release (Journal Review Data, module texture picker, app-wide texture)

**Migrations 0116 and 0117 must both be applied** — `app_wide` on
`sys_dashboard_texture`, then `texture_id`/`texture_mode` on `sys_module_texture`. Both
ship inert (item 8 confirms the Music Library still shows its own picture unchanged
after 0117's backfill runs). If any texture screen reports "no such column", check
`sys_schema_migrations` before reading anything here as a bug.

Items 1–7 are the new Journal screen. Item 4 is the one that matters most — a merge
must never be destructive, so the source entries have to still be there after saving
the draft. Items 8–11 are the module texture picker; item 8 is the regression check,
since a wrong backfill would silently swap Music's picture for the app-wide one. Items
12–14 are the app-wide texture scope, and item 12 is its own regression check for the
same reason — this ships off, so an existing install must render unchanged until an
admin ticks it on.

- [ ] **1.** Journal → Data Management → Review Data: the card lists every date carrying more than one entry, each row showing its position ("2 of 4"), time, title and a 100-word excerpt — including untitled entries, which the Correct tab beside it leaves out
- [ ] **2.** Journal → Review Data: clicking a row opens the full entry, with an Edit button that opens the same form the single-entry screen uses; closing it returns to the list with page, sort and ticks intact
- [ ] **3.** Journal → Review Data: Edit is disabled on a locked entry, the same as it is from `/entries/[id]`
- [ ] **4.** Journal → Review Data: ticking several entries and choosing Merge drafts one new entry (earliest date/time, titles joined with `/`, each source's content under a `— HH:MM · Title` line, categories and tags combined) and opens it in the ordinary entry form — saving creates the new entry and leaves every source entry exactly where it was
- [ ] **5.** Journal → Review Data: locations and weather are not carried into a merged draft, and the form still lets you add them
- [ ] **6.** Journal → Review Data: ticking several entries and choosing Delete asks first, then moves them to the recycle bin (restorable from the Correct tab)
- [ ] **7.** CLI: `npm run cli -- journal-same-date`, `--merge 41,42,43` (prints only), `--merge ... --save` (creates), and `--delete 41,42` all behave as documented
- [ ] **8.** Administration → Configuration → Module Configuration: the Music Library's background texture control shows "Its own uploaded picture" already selected, and the module's screens still show the same picture as before this release
- [ ] **9.** Administration → Configuration → Module Configuration: a module with no picture of its own can pick "Pick one from the library" and choose a thumbnail from the App Texture library; that module's screens then show it with that picture's own opacity/blur
- [ ] **10.** Administration → Configuration → Module Configuration: a module set to "None — plain paper" stays flat even when an app-wide texture is on
- [ ] **11.** Administration → Configuration → App Texture: deleting a library picture that a module was pointed at drops that module back to the app background rather than breaking its screen
- [ ] **12.** Administration → Configuration → App Texture: on an install that has not touched the new "Show on every screen" tick box, the background still appears only on the home dashboard, exactly as before this release
- [ ] **13.** Administration → Configuration → App Texture: ticking "Show on every screen" puts the selected picture behind every module, Administration and the account screen, all sharing one background
- [ ] **14.** Administration → Configuration → App Texture: with the app-wide texture on, a module that still has its own uploaded picture (Music) keeps showing its own picture instead of the app-wide one

---

## 2026-09-27 — Release (My Shortcuts, uploaded icons)

**Migrations 0114 and 0115 must both be applied** — `sys_user_shortcuts` and then
its two icon-upload columns. 0115 exists because 0114 had already run on the NAS
when the columns were needed; an earlier attempt folded them into 0114, which the
runner skipped, and every home screen died on `no such column: icon_image`. If
items 15–23 report a missing table or column, check `sys_schema_migrations` before
reading anything here as a bug.

Items 15–23 are the new card. **Item 20 is the one that matters most** — it is the
privacy boundary, and it needs two accounts: shortcuts and their uploaded pictures
are per-person, unlike every other image in this app. Item 18 needs a second
account too, or a module grant revoked, to see a shortcut go unavailable rather
than vanish.

Item 24 is desktop-only (there is no hover on a phone); item 25 is its phone
counterpart, where the tile controls are always visible instead.

- [ ] **15.** Home: the My Shortcuts card appears, and Admin → Display Settings → Dashboard Widgets can hide and reorder it like any other card
- [ ] **16.** Add a shortcut to a web address — a bare `example.com` gets `https://` added, and the tile opens it in a new tab
- [ ] **17.** Add a shortcut to a page in this app: pick a module, then a section — and separately, a module's own main page
- [ ] **18.** A shortcut into a module you can no longer open draws greyed out with a reason, rather than disappearing
- [ ] **19.** Upload a picture as a shortcut's icon; removing it falls back to the glyph underneath rather than leaving the tile blank
- [ ] **20.** Two accounts: each sees only their own shortcuts, and one cannot fetch the other's uploaded icon by its URL
- [ ] **21.** Edit, reorder and remove a shortcut from the card itself; renaming one keeps its uploaded picture
- [ ] **22.** The twelfth shortcut is the last — Add is refused with a message rather than failing silently
- [ ] **23.** An oversized picture (over 256 KB) is refused immediately with the app's own wording, not a server error
- [ ] **24.** Desktop: shortcut tiles read as 3D buttons — they lift on hover and press down on click, and the row controls appear on hover
- [ ] **25.** Phone: the tiles reflow to the width available and their edit controls are visible without hovering
- [ ] **26.** Navigation: a section group whose heading has its own page draws as a link with its glyph; headings without one stay plain labels
- [ ] **27.** Music: reorder a playlist entry up and down — a playlist holding the same track twice moves the two copies independently
- [ ] **28.** Administration → About loads and shows its disk figures (this screen previously failed to build)

---

## 2026-09-25 — Release (navigation tree)

**No migration.** The remembered expanded set is a new key in the existing
`sys_user_preferences` table, so nothing schema-level shipped here.

**This release replaces the navigation on every desktop screen in the app**, so
item 29 is the one that matters: if `NavTree` fails to render, every page behind
the login goes with it. Check that first and the rest afterwards.

Items 29–34 are desktop-only by design. Item 35 is the counterpart and is
arguably the more important check of the two — the phone was deliberately left
alone, so the test is that nothing about it *changed*. Item 36 needs two devices,
or one device and a logout, to prove the preference is stored per person rather
than in that browser.

- [ ] **29.** Every module and Admin: the left column is one tree — Home on top, each module a heading that expands to its sections
- [ ] **30.** The tree: clicking a module heading expands and collapses it; the module you are currently in is always open
- [ ] **31.** Filter: typing `import` finds Journal, Investments and Expense sections together, each labelled with its module
- [ ] **32.** Filter: matches starting with what you typed rank first; Esc clears; clearing restores the collapse state you had
- [ ] **33.** Collapse: `«` folds the tree to a thin strip and the content widens; the strip and the header's `»` both reopen it
- [ ] **34.** Icons: Admin → Display Settings → Icons can replace the tree's Home and filter glyphs, and each module's section icons still resolve
- [ ] **35.** Phone: the bottom bar and its sheet behave exactly as before — no tree, no strip, nothing new
- [ ] **36.** The set of expanded modules survives a reload, and is remembered per user rather than per browser

---

## 2026-09-25 — Release

Migration 0112 (`sys_saved_sql_queries`) was applied on the NAS during this
release's publish. If items 37–39 ever report "no such table", that is the thing to
re-check before reading anything else here as a bug.

Item 40 costs live provider calls on every expand, so it can only really be judged
during market hours; item 42 needs a file whose tags actually carry lyrics, which
not every track in the library has. Item 44 is phone-relevant — the expanded index
panel adds six figures and a sparkline to a row that was already tight.

- [ ] **37.** Admin → SQL Explorer → SQL Query: save a statement with a name, description and tags; it appears on the Saved SQL card
- [ ] **38.** Admin → SQL Explorer: Load fills the editor and does **not** execute — confirm with a statement you would not want run
- [ ] **39.** Admin → SQL Explorer: saving under an existing name replaces that row, and the dialog warns before it does
- [ ] **40.** Investments → Indexes card: a row expands to show day range, 52-week range with its marker, moving averages, one-year change, all-time high and a sparkline
- [ ] **41.** Investments → Indexes card: a symbol whose second pass fails keeps its row and shows em-dashes (the three commodity futures have no one-year change)
- [ ] **42.** Music: a track with embedded lyrics shows them attributed "From this file's own tags", without a network lookup
- [ ] **43.** Music: a track with no embedded and no lrclib match offers the Google search link
- [ ] **44.** Investments → Indexes card: the expanded panel and sparkline are readable on a phone
- [ ] **45.** Admin → Daily Quote → All Quotes: the new nav entry opens the listing screen
- [ ] **46.** CLI: `saved-sql list` / `show` / `save` / `delete` behave as documented

---

## 2026-09-24 — Release

No new migrations: 0109–0111 shipped with the previous release and are already
applied on the NAS. Item 49 is the one to watch — the dedup rule changed, so a
scan that used to return nothing may now return groups, and blank-named places
can group on distance alone. Items 51 and 50 are phone-relevant: the popup and the
picker's refusal message both have to be readable narrow.

- [ ] **47.** Admin → Message Queue: the screen lists read and unread together, newest first, with each message's source
- [ ] **48.** Admin → Message Queue: tick rows and Delete removes them; Purge by age (7/30/90/365 days) clears everything older and keeps the rest
- [ ] **49.** Journal → Merging & Dedup: the "Within" slider (10–500m, default 75m) rescans on release, and groups found by distance are labelled "proximity"
- [ ] **50.** Journal → Merging & Dedup: two pins ~25–50m apart with similar names now group (they did not before); merging one still works
- [ ] **51.** Journal → entry form: adding a location already on the entry is refused with a message, and the draft pin stays put — from both the map tab and the library tab
- [ ] **52.** Journal: clicking a numbered map pin opens a popup with number, name, address, coordinates and chips, readable in the dark theme
- [ ] **53.** Journal: a single entry page shows the module rail, section panel and header (no more bare page with a "Back to My Journal" link)

---

## 2026-09-23 — Release

Migrations 0106, 0107 and 0108 are applied on the NAS. The Investments rename
touched ~83 files and renamed 17 tables, so the items below are worth a walk
through even where the screen looks unchanged — a missed server action throws
only when that one feature is used, not when the page loads.

- [ ] **54.** Investments: the module opens at /modules/investments, named Investments on the rail and home grid
- [ ] **55.** Investments: every section loads — Dashboard, Positions, Transactions, Account Performance, Watch & Test, Chart & Analysis, CSV Import, Tax Lots, Export for AI Analysis, Settings
- [ ] **56.** Investments: the actions still write — add/edit a position, a transaction, a watchlist entry, an account
- [ ] **57.** Investments: Tax Lots deep links still resolve (ticker picker, and the links out of the positions grid)
- [ ] **58.** Investments: CSV import of a broker file
- [ ] **59.** Admin → SQL Explorer: the Investments group lists the inv_ tables, and Table References names them
- [ ] **60.** Admin → Background Tasks: the Investments auto-refresh still finds its module
- [ ] **61.** Home: the Daily Glance card renders and its "Launch Investments" link goes to the new URL
- [ ] **62.** Investments: uploaded section/card icons survived the rename (slot ids were deliberately left on `stock_*`)
- [x] **63.** Expense: Transaction Rule Types — group rules by type, filter the rules list, manage types in Meta Data  — tested 2026-09-23
- [x] **64.** Security → Visits: why a visit was scored suspicious (signals on the row)

---

## 2026-09-22 — Release

- [x] **65.** CSV Analysis: pooled datasets
- [x] **66.** Admin-set preferences (allow edit user's preferences)
- [x] **67.** Location icons

## 2026-09-20

- [x] **68.** Journal: filter the category and tag lists in Meta Data
- [x] **69.** Journal: a saved-location library
- [x] **70.** Journal: Entries as one screen with two tabs
- [x] **71.** Tools: a CSV file browser beside the SQLite one

## 2026-09-19

- [x] **72.** Journal: keep or file a photo from an entry
- [x] **73.** TreeNav: each group reads as its own embossed card
- [x] **74.** Tools: SQLite uploads over 4 MB, with an admin-set cap
- [ ] **75.** Stocks: icons on the indexes board
- [ ] **76.** Stocks: playback of portfolio history
- [ ] **77.** Music: a sleep timer that stops the player after a set time

## 2026-09-17

- [ ] **78.** Home screen: launch a card's module from its title
- [ ] **79.** Journal: review existing entries before importing from a calendar
- [ ] **80.** Tools: a new module, opening with a SQLite file browser

## 2026-09-15

- [ ] **81.** Floating layer: a clock over every page
- [ ] **82.** Floating layer: a calculator over every page
- [ ] **83.** Floating layer: a scratchpad over every page
- [ ] **84.** Stocks: the indexes board loads when you open the card
- [ ] **85.** Admin: clear deployment records in bulk, or prune to the newest few
- [ ] **86.** Journal: jump to the next day that has an entry
- [ ] **87.** NAS: a startup crash that says what broke

## 2026-09-14

- [ ] **88.** Journal: date the template suggestion by the local calendar
- [ ] **89.** Themes: tell the browser a dark theme is dark
- [ ] **90.** Export for AI: measured correlations, and the sectors you hold nothing in
- [ ] **91.** Home: a Clock card, with the weather where you are
- [ ] **92.** Picture Gallery: Magic List — photographs conjured from a description
- [ ] **93.** Stocks: candlesticks in the ticker viewer's Today card
- [ ] **94.** Stocks: consult AI about one ticker
- [ ] **95.** Stocks: a transaction knows which account it belongs to

## 2026-09-13

- [ ] **96.** Attendance: bigger cards in the register grid
- [ ] **97.** Admin: random theme generation
- [ ] **98.** Music Library: an Albums view
- [ ] **99.** Stocks & ETFs: a recorded trade can update the holding
- [ ] **100.** MyJournal: New Entry becomes a section
- [ ] **101.** Games: Bridge
- [ ] **102.** SQL Explorer: BLOB cells fetched on demand
- [ ] **103.** SQL Explorer: tables grouped by module
- [ ] **104.** Account: two compact navigation styles, and the reader picks
- [ ] **105.** Icon names: the compiler catches glyph-table drift

## 2026-09-11

- [ ] **106.** Journal: Calendar Import — read a Google/Outlook .ics and pick events to import
- [ ] **107.** Journal: re-importing a renamed or moved event updates it instead of duplicating
- [ ] **108.** Journal: a large .ics (2.4 MB) uploads without tripping the action-argument limit
- [ ] **109.** Journal: restoring an imported entry from the recycle bin keeps its identity
- [ ] **110.** Stocks: a portfolio brief for an LLM
- [ ] **111.** Attendance: one register per class per day again
- [ ] **112.** Attendance: session labels read in local time, not four hours ahead

## 2026-09-10

- [ ] **113.** Picture Gallery: albums
- [ ] **114.** Picture Gallery: a + on every photograph
- [ ] **115.** Home screen: a handwritten quote, no header, and a slimmer rail

## 2026-09-09

- [ ] **116.** Security: every exported server action authorises on its first line
- [ ] **117.** Stocks & ETFs: analyze several tickers at once, and link to an analysis
- [ ] **118.** Music Library: the song on YouTube
- [ ] **119.** Music Library: a real fullscreen visualizer
- [ ] **120.** Picture Gallery: a module of its own, not a corner of the home screen

## 2026-09-08

- [ ] **121.** Games: Mahjong pickers and board frame
- [ ] **122.** Stocks & ETFs: today's session in the ticker viewer
- [ ] **123.** Journal: a space-separated Tags column no longer imports as one long tag
- [ ] **124.** CSV Analytics: bulk edit rows
- [ ] **125.** CSV Analytics: a CLI for bulk edit
- [ ] **126.** Photographs: one viewer, with a capture timestamp and a heart

## 2026-09-06 — Release

- [ ] **127.** Games: Mahjong, the four-player game against three bots
- [ ] **128.** Stocks & ETFs: the Tax Lot Portfolio Analyzer
- [ ] **129.** About: count untagged changes instead of reporting zero
- [ ] **130.** Home: the Random Photo card streams instead of blocking first paint
- [ ] **131.** Photos: an absolute path can no longer escape the photo folder
- [ ] **132.** Compact grids: long values are readable
- [ ] **133.** Compact grids: a second layout for reading
- [ ] **134.** Music: the story behind the song, beside the lyrics
- [ ] **135.** Games: Mahjong Match
- [ ] **136.** Games: card icons across the whole arcade
- [ ] **137.** Attendance: upload your own icon for a student action
- [ ] **138.** CSV Analysis: named views over a dataset

## 2026-09-03

- [ ] **139.** Attendance: a class records the weekday it meets on
- [ ] **140.** Attendance: the home screen opens on today's register
- [ ] **141.** Photos: a viewer component with its own actions
- [ ] **142.** Journal: a photos slideshow and folder module
- [ ] **143.** Games: sudoku and blackjack polish
- [ ] **144.** Stocks: the refresh total counts up as prices land

## 2026-09-02 — Release

- [ ] **145.** Expense: top-5 cards link through to their transactions
- [ ] **146.** Expense: the vendor rollup stops inventing vendors from payment lines
- [ ] **147.** Stocks: the indexes refresh becomes an icon
- [ ] **148.** Favourite photos: a slideshow
- [ ] **149.** Carousel graphics are resized on upload
- [ ] **150.** SQL Explorer: a schema browser
- [ ] **151.** SQL Explorer: prose for every table
- [ ] **152.** Music: a spectrum analyser under the cover art
- [ ] **153.** Games: Sudoku
- [ ] **154.** Games: Blackjack
- [ ] **155.** Games: Minesweeper
- [ ] **156.** Journal: a recycle bin
- [ ] **157.** Journal: a Correct tab
- [ ] **158.** Journal: metadata backup

## 2026-09-01 — Release

- [ ] **159.** Journal import: an overwrite mode, with the plan shown before it writes
- [ ] **160.** Favourite photos: their own screen
- [ ] **161.** Favourite photos: a zip download
- [ ] **162.** Admin: a deployment history, with the build log attached
- [ ] **163.** Games: Tetris
- [ ] **164.** Games: Arrow Clearing becomes an actual puzzle
- [ ] **165.** SQL Explorer: a Truncate button, behind a warning that counts the rows
- [ ] **166.** Journal import: normalized entry time stops a re-import duplicating

## 2026-08-30

- [ ] **167.** Themes: colour themes are data, and the builder warns before you blind yourself
- [ ] **168.** Games: Arrow Clearing cannot generate an unsolvable board
- [ ] **169.** Games: an arcade, and a scoreboard the whole house shares

## 2026-08-29

- [ ] **170.** Stocks: five threads on refresh
- [ ] **171.** Stocks: a wildcard that was lying to you
- [ ] **172.** Home: the random photo card says how old the photo is
- [ ] **173.** Stocks: Watch & Test — watch lists, signals and simulation on one screen
- [ ] **174.** Expense: re-run a rule over transactions you have already imported
- [ ] **175.** Expense: a vendor is somebody now, not just a total

## 2026-08-28

- [ ] **176.** Home screen: arrange it yourself
- [ ] **177.** CSV Analysis: the two-tier nav
- [ ] **178.** Home: a photograph drawn at random
- [ ] **179.** Uploaded icons get cleaned up on the way in
- [ ] **180.** Icons: any single icon can be replaced without changing the icon set (73 slots)
- [ ] **181.** Admin → Configuration → Icons: upload an SVG or image per position
- [ ] **182.** Icons: uploaded SVG is sanitized on write
- [ ] **183.** Home: a picture behind the day
- [ ] **184.** Expense: rules that say why

## 2026-08-26

- [ ] **185.** Admin → Background Tasks: every timer in one place, including jobs that never ran
- [ ] **186.** A job killed mid-pass reads as interrupted, never as ok
- [ ] **187.** CLI: list-scheduled-jobs gives the same answer without the web server
- [ ] **188.** Last-run stamps survive the restarts a deploy performs
- [ ] **189.** Stocks: an Indexes card of eleven benchmarks in four groups
- [ ] **190.** Stocks: a new dashboard widget lands beside its neighbour, not at the bottom
- [ ] **191.** Stocks → Simulation: "what if I'd bought then?" across ten windows

## 2026-08-25

- [ ] **192.** Music: a scan that finishes (no OOM on a large NAS folder)
- [ ] **193.** Music: an abandoned scan run closes itself instead of reading "running" forever
- [ ] **194.** Progress3D: one progress bar across the app
- [ ] **195.** Per-module background pictures
- [ ] **196.** Attendance: a Detail report — the whole term as a grid
- [ ] **197.** About: a Server Log tab

## 2026-08-19

- [ ] **198.** Stocks: find a ticker, and star the ones you watch daily
- [ ] **199.** Music Library: Magic Playlists assembled from a query
- [ ] **200.** Music Library: a visible play queue
- [ ] **201.** Music Library: lyrics on demand
- [ ] **202.** Grids that count their own columns
- [ ] **203.** Seven more glyphs
- [ ] **204.** Ticker detail: how far a trade has moved since you made it
- [ ] **205.** Music Library: stream 20,000 songs off the NAS
- [ ] **206.** Attendance: two registers a day
- [ ] **207.** Attendance: student actions, a teacher-editable catalog
- [ ] **208.** Attendance: 12 icon sets, applied to the section nav too

## 2026-08-16

- [ ] **209.** Attendance: a new module — pick a class, tap who is here, save
- [ ] **210.** Attendance: a student can sit in several classes
- [ ] **211.** "Absent" and "attendance was never taken" stay distinguishable
- [ ] **212.** Admin → Security: a sign-in audit log recording logins, failures and logouts
- [ ] **213.** Stocks: allocation by sector
- [ ] **214.** Stocks: candlestick charts
- [ ] **215.** Admin: import daily quotes from a newsletter

## 2026-08-15

- [ ] **216.** Journal: clickable taxonomy
- [ ] **217.** About page: inline markdown in the change log
- [ ] **218.** About page: memory as meters
- [ ] **219.** Home: Daily Glance moves off the Stocks dashboard
- [ ] **220.** Installable PWA: stable identity, module shortcuts, iOS launch screens
- [ ] **221.** Per-user preferences: a favourite module you can open on startup

## 2026-08-14

- [ ] **222.** Journal: a filtered Entries browser with saved AND/OR filters
- [ ] **223.** Journal: icons for categories and tags
- [ ] **224.** Deploys apply their own migrations, and fail loudly rather than serving new code
- [ ] **225.** CSV Analytics: add columns without re-importing a file
- [ ] **226.** ModuleCarousel: a grid on desktop, coverflow on phones
- [ ] **227.** DataGrid: column headers popped up into a 3D bar
- [ ] **228.** Journal: home-screen search
- [ ] **229.** The section bar moved to the bottom, and modules collapsed into a menu

## 2026-08-11

- [ ] **230.** CSV Analytics: add custom columns during append/truncate

## 2026-08-10

- [ ] **231.** The section tree became a bar, and surfaces learned to lift

## 2026-08-08

- [ ] **232.** The compact section bar
- [ ] **233.** User management gated on admin
- [ ] **234.** Home: announce a new deployment
- [ ] **235.** Navigation moved to the edges — a top bar plus a compact bottom module bar
- [ ] **236.** Both nav bars minimise to a puck and remember it
- [ ] **237.** Every chart got a gear

## 2026-08-07

- [ ] **238.** Restart the NAS after a publish without SSH
- [ ] **239.** The app works on a phone — one layout boundary at 1024px, decided server-side
- [ ] **240.** Installable to the home screen
- [ ] **241.** Stocks: ticker viewer as cards, with Events and Yahoo Detail tabs
- [ ] **242.** Stocks: risk cached and served at any age, refreshed only by Recalculate
- [ ] **243.** Stocks: earnings data no longer vanishes (Yahoo User-Agent and crumb race)
- [ ] **244.** Home: the module grid becomes a carousel with per-module artwork
- [ ] **245.** Image uploads send a File in FormData rather than base64

## 2026-08-05

- [ ] **246.** Stocks: positions split into Stocks / ETF / Others
- [ ] **247.** Stocks: Daily Glance — one table for the three buckets, with the total
- [ ] **248.** Stocks: Account Performance Over Time on one set of axes
- [ ] **249.** Stocks: remember which account a broker's CSV label means
- [ ] **250.** Hide the sidebar to its accent strip, and give the page back the gutter
- [ ] **251.** Stocks: performance chart points shaped by what they are
- [ ] **252.** Stocks: ticker viewer — everything about one symbol in one dialog
- [ ] **253.** Stocks: choose which dashboard widgets show, and in what order
- [ ] **254.** Stocks: record the brokerage firm on a trade, and fix duplicate detection
- [ ] **255.** Stocks: cost basis, so total return is possible at all
- [ ] **256.** Stocks: daily snapshots, value and gain/loss per bucket
- [ ] **257.** Stocks: an icon per investment account
- [ ] **258.** Stocks: eight routed sections behind a TreeNav, loading per section
- [ ] **259.** Stocks: Refresh All with per-ticker progress
- [ ] **260.** Stocks: a per-ticker news lookup
- [ ] **261.** CSV import: one screen for all three types, listing every row
- [ ] **262.** A verification gate: typecheck, boundary, tests, migration dry-run, e2e

## 2026-08-03

- [ ] **263.** Full-width layout: one shared container across every full-page screen
- [ ] **264.** A fixed sidebar raised above the page, so a module gets the rest of the screen
- [ ] **265.** Expense: spend stats
- [ ] **266.** Expense: an auto-import switch
- [ ] **267.** Expense: an uploadable icon per category
- [ ] **268.** Stocks: cache and show ticker logos
- [ ] **269.** DataGrid: filter expressions
- [ ] **270.** DataGrid: column aggregates
- [ ] **271.** DataGrid: record view
- [ ] **272.** Modal extracted as its own component
- [ ] **273.** Three colour themes and three icon sets

## 2026-08-02

- [ ] **274.** Expense: automatic CSV import from a watched folder, one sub-folder per card
- [ ] **275.** Expense: a processed file is renamed .backup, a failure .failed
- [ ] **276.** Expense: post-import rules — one condition, any number of field assignments
- [ ] **277.** Expense: "Manually Run Import Clean up" with real progress
- [ ] **278.** Expense: the tree-nav overhaul
- [ ] **279.** Expense: a new module for credit-card spending
- [ ] **280.** Expense: fuzzy auto-categorisation by glob against the statement description
- [ ] **281.** Expense: CSV import with a saved column mapping per card company
- [ ] **282.** Admin: import daily quotes from a newsletter

## 2026-07-30

- [ ] **283.** Result grid: search, filters, sticky header, column control, row selection
- [ ] **284.** Journal: entry authoring with category/tag autocomplete
- [ ] **285.** Journal: a Leaflet location picker with search and multiple pins
- [ ] **286.** Journal: fetch today's weather
- [ ] **287.** Journal: the entry screen, with Print/Save-PDF, Edit, Lock and Delete
- [ ] **288.** Journal: Today In History

## 2026-07-27

- [ ] **289.** Journal: a new module, with CSV import of a real export
- [ ] **290.** Real Estate and Property Watch removed
- [ ] **291.** Every table renamed to a 3-letter module prefix
- [ ] **292.** Daily Quote

## 2026-07-25

- [ ] **293.** Self-signup, always as a plain user with no module access
- [ ] **294.** Admin elevation behind a secret that stays hidden until you type "adm"
- [ ] **295.** User-selectable module icon sets
- [ ] **296.** Daybreak, the first light theme

## 2026-07-21

- [ ] **297.** Interactive DataGrid: click-to-sort, paging, Export CSV, Show SQL
- [ ] **298.** CSV Analysis: Show Data and Chart per entry
- [ ] **299.** CSV chart builder with presets
- [ ] **300.** ChartXY: line/bar/scatter/area with zoom

## 2026-07-19

- [ ] **301.** CSV Analytics: a new module
- [ ] **302.** Theme and UI polish
- [ ] **303.** ARM/Synology NAS deployment support

## 2026-07-18

- [ ] **304.** Stocks & ETFs: accounts, positions, transactions and portfolio summary
- [ ] **305.** Stocks & ETFs: a Yahoo Finance market-data client with manual/CLI refresh
- [ ] **306.** Stocks & ETFs: volatility, correlation and Sharpe analytics
- [ ] **307.** Stocks & ETFs: a Next Day Actions signal scanner
- [ ] **308.** Stocks & ETFs: CSV import with saved column-mapping presets
- [ ] **309.** Admin: SQL Explorer
- [ ] **310.** ChartLine, ChartBar and Tabs components
- [ ] **311.** Publish applies pending migrations, with an automatic backup
- [ ] **312.** ~~Real Estate: property portfolio and a RentCast watch list~~ *(removed 2026-07-27, migration 0026)*

## 2026-07-13

- [ ] **313.** Google auto-registration
- [ ] **314.** User avatars
- [ ] **315.** start.bat port cleanup

## 2026-07-12

- [ ] **316.** User management
- [ ] **317.** Authentication and Google sign-in
- [ ] **318.** Administration section
- [ ] **319.** Module Settings
- [ ] **320.** Initial scaffold: modules, settings, admin section
