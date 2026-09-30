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

## 2026-09-29 — Release (Household: Recipes, a personal home-screen layout)

**Migrations 0118, 0119 and 0120 must all be applied** — `hsh_recipes` and
`hsh_recipe_tags`, then the Household module's seed row, then `category` on
`hsh_recipes`. If any Household screen 404s or reports "no such column", check
`sys_schema_migrations` before reading anything here as a bug. The home-screen
layout items need no migration — both new preferences are plain
`user_preferences` rows.

Items 1–9 are Household → Recipes. Item 2 is the one regression check — the tab
strip must not silently drop a recipe, so its Uncategorised count has to match
reality. Item 7 is the one that matters most for trust: a picture failure must
never read as "the recipe wasn't saved" when it was. Items 10–15 are the home
screen's personal layout; item 13 is its own regression check, since the two
orderings (household default vs. a reader's drag) must never leak into each
other.

- [ ] **1.** Household → Recipes: the list shows tabs — All, one per category with
  a count, then Uncategorised — instead of a Category dropdown; clicking a
  category tab narrows the grid and updates the URL (`?category=`)
- [ ] **2.** Household → Recipes: the Uncategorised tab's count matches the number
  of recipes with no category set, and narrows the grid to exactly those
- [ ] **3.** Household → Recipes: a bookmarked or refreshed `?category=` URL opens
  on the right tab; Uncategorised does not survive a refresh (falls back to All)
- [ ] **4.** Household → Recipes: the grid shows Name, Description, Tags, Made and
  Rating; Category, Source and the picture are gone from the grid but still
  visible in the record view
- [ ] **5.** Household → Recipes: clicking **View**, or clicking anywhere on a row,
  opens a record view showing every field — including ingredients, directions
  and notes, each inside its own bordered/inset panel
- [ ] **6.** Household → Recipes → Edit: Ingredients and Directions are each a
  full-width row (not side-by-side), Description is a 3-line box, there is no
  Cancel button (the modal's own close and Escape still work), and Save reads
  "Save Recipe"
- [ ] **7.** Household → Recipes → Add: choosing a picture before saving shows a
  preview immediately; saving the new recipe attaches that picture without a
  second trip back into the editor
- [ ] **8.** Household → Recipes: if attaching a picture fails right after a
  successful save, the message says the recipe *was* saved and names the
  picture as the only thing that didn't attach — never reads as if nothing
  happened
- [ ] **9.** Household → Recipes: a picture added through the editor or through
  "Replace picture" in the record view is visibly smaller than the original
  file (check its size via the browser's network tab or file download) —
  existing pictures added before this release are untouched
- [ ] **10.** Home screen (full/desktop layout, ≥1280px wide): a control above the
  cards switches between one and two columns
- [ ] **11.** Home screen: dragging a card by its handle moves it to a new
  position; the new order persists after a refresh
- [ ] **12.** Home screen: with no pointer, the up/down buttons on a card move it
  one place at a time, wrapping neither at the top nor the bottom of the list
- [ ] **13.** Home screen: an admin reordering *Administration → Display Settings
  → Dashboard Widgets* is picked up by a reader who has never dragged a card,
  but does **not** change the arrangement of a reader who has
- [ ] **14.** Home screen: the module carousel always spans both columns and is
  not draggable, regardless of the column count
- [ ] **15.** Home screen on a phone or a narrow window (<1280px): no column
  control appears, and the cards are a single stack exactly as before this
  release

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

- [ ] **16.** Journal → Data Management → Review Data: the card lists every date carrying more than one entry, each row showing its position ("2 of 4"), time, title and a 100-word excerpt — including untitled entries, which the Correct tab beside it leaves out
- [ ] **17.** Journal → Review Data: clicking a row opens the full entry, with an Edit button that opens the same form the single-entry screen uses; closing it returns to the list with page, sort and ticks intact
- [ ] **18.** Journal → Review Data: Edit is disabled on a locked entry, the same as it is from `/entries/[id]`
- [ ] **19.** Journal → Review Data: ticking several entries and choosing Merge drafts one new entry (earliest date/time, titles joined with `/`, each source's content under a `— HH:MM · Title` line, categories and tags combined) and opens it in the ordinary entry form — saving creates the new entry and leaves every source entry exactly where it was
- [ ] **20.** Journal → Review Data: locations and weather are not carried into a merged draft, and the form still lets you add them
- [ ] **21.** Journal → Review Data: ticking several entries and choosing Delete asks first, then moves them to the recycle bin (restorable from the Correct tab)
- [ ] **22.** CLI: `npm run cli -- journal-same-date`, `--merge 41,42,43` (prints only), `--merge ... --save` (creates), and `--delete 41,42` all behave as documented
- [ ] **23.** Administration → Configuration → Module Configuration: the Music Library's background texture control shows "Its own uploaded picture" already selected, and the module's screens still show the same picture as before this release
- [ ] **24.** Administration → Configuration → Module Configuration: a module with no picture of its own can pick "Pick one from the library" and choose a thumbnail from the App Texture library; that module's screens then show it with that picture's own opacity/blur
- [ ] **25.** Administration → Configuration → Module Configuration: a module set to "None — plain paper" stays flat even when an app-wide texture is on
- [ ] **26.** Administration → Configuration → App Texture: deleting a library picture that a module was pointed at drops that module back to the app background rather than breaking its screen
- [ ] **27.** Administration → Configuration → App Texture: on an install that has not touched the new "Show on every screen" tick box, the background still appears only on the home dashboard, exactly as before this release
- [ ] **28.** Administration → Configuration → App Texture: ticking "Show on every screen" puts the selected picture behind every module, Administration and the account screen, all sharing one background
- [ ] **29.** Administration → Configuration → App Texture: with the app-wide texture on, a module that still has its own uploaded picture (Music) keeps showing its own picture instead of the app-wide one

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

- [ ] **30.** Home: the My Shortcuts card appears, and Admin → Display Settings → Dashboard Widgets can hide and reorder it like any other card
- [ ] **31.** Add a shortcut to a web address — a bare `example.com` gets `https://` added, and the tile opens it in a new tab
- [ ] **32.** Add a shortcut to a page in this app: pick a module, then a section — and separately, a module's own main page
- [ ] **33.** A shortcut into a module you can no longer open draws greyed out with a reason, rather than disappearing
- [ ] **34.** Upload a picture as a shortcut's icon; removing it falls back to the glyph underneath rather than leaving the tile blank
- [ ] **35.** Two accounts: each sees only their own shortcuts, and one cannot fetch the other's uploaded icon by its URL
- [ ] **36.** Edit, reorder and remove a shortcut from the card itself; renaming one keeps its uploaded picture
- [ ] **37.** The twelfth shortcut is the last — Add is refused with a message rather than failing silently
- [ ] **38.** An oversized picture (over 256 KB) is refused immediately with the app's own wording, not a server error
- [ ] **39.** Desktop: shortcut tiles read as 3D buttons — they lift on hover and press down on click, and the row controls appear on hover
- [ ] **40.** Phone: the tiles reflow to the width available and their edit controls are visible without hovering
- [ ] **41.** Navigation: a section group whose heading has its own page draws as a link with its glyph; headings without one stay plain labels
- [ ] **42.** Music: reorder a playlist entry up and down — a playlist holding the same track twice moves the two copies independently
- [ ] **43.** Administration → About loads and shows its disk figures (this screen previously failed to build)

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

- [ ] **44.** Every module and Admin: the left column is one tree — Home on top, each module a heading that expands to its sections
- [ ] **45.** The tree: clicking a module heading expands and collapses it; the module you are currently in is always open
- [ ] **46.** Filter: typing `import` finds Journal, Investments and Expense sections together, each labelled with its module
- [ ] **47.** Filter: matches starting with what you typed rank first; Esc clears; clearing restores the collapse state you had
- [ ] **48.** Collapse: `«` folds the tree to a thin strip and the content widens; the strip and the header's `»` both reopen it
- [ ] **49.** Icons: Admin → Display Settings → Icons can replace the tree's Home and filter glyphs, and each module's section icons still resolve
- [ ] **50.** Phone: the bottom bar and its sheet behave exactly as before — no tree, no strip, nothing new
- [ ] **51.** The set of expanded modules survives a reload, and is remembered per user rather than per browser

---

## 2026-09-25 — Release

Migration 0112 (`sys_saved_sql_queries`) was applied on the NAS during this
release's publish. If items 37–39 ever report "no such table", that is the thing to
re-check before reading anything else here as a bug.

Item 40 costs live provider calls on every expand, so it can only really be judged
during market hours; item 42 needs a file whose tags actually carry lyrics, which
not every track in the library has. Item 44 is phone-relevant — the expanded index
panel adds six figures and a sparkline to a row that was already tight.

- [ ] **52.** Admin → SQL Explorer → SQL Query: save a statement with a name, description and tags; it appears on the Saved SQL card
- [ ] **53.** Admin → SQL Explorer: Load fills the editor and does **not** execute — confirm with a statement you would not want run
- [ ] **54.** Admin → SQL Explorer: saving under an existing name replaces that row, and the dialog warns before it does
- [ ] **55.** Investments → Indexes card: a row expands to show day range, 52-week range with its marker, moving averages, one-year change, all-time high and a sparkline
- [ ] **56.** Investments → Indexes card: a symbol whose second pass fails keeps its row and shows em-dashes (the three commodity futures have no one-year change)
- [ ] **57.** Music: a track with embedded lyrics shows them attributed "From this file's own tags", without a network lookup
- [ ] **58.** Music: a track with no embedded and no lrclib match offers the Google search link
- [ ] **59.** Investments → Indexes card: the expanded panel and sparkline are readable on a phone
- [ ] **60.** Admin → Daily Quote → All Quotes: the new nav entry opens the listing screen
- [ ] **61.** CLI: `saved-sql list` / `show` / `save` / `delete` behave as documented

---

## 2026-09-24 — Release

No new migrations: 0109–0111 shipped with the previous release and are already
applied on the NAS. Item 49 is the one to watch — the dedup rule changed, so a
scan that used to return nothing may now return groups, and blank-named places
can group on distance alone. Items 51 and 50 are phone-relevant: the popup and the
picker's refusal message both have to be readable narrow.

- [ ] **62.** Admin → Message Queue: the screen lists read and unread together, newest first, with each message's source
- [ ] **63.** Admin → Message Queue: tick rows and Delete removes them; Purge by age (7/30/90/365 days) clears everything older and keeps the rest
- [ ] **64.** Journal → Merging & Dedup: the "Within" slider (10–500m, default 75m) rescans on release, and groups found by distance are labelled "proximity"
- [ ] **65.** Journal → Merging & Dedup: two pins ~25–50m apart with similar names now group (they did not before); merging one still works
- [ ] **66.** Journal → entry form: adding a location already on the entry is refused with a message, and the draft pin stays put — from both the map tab and the library tab
- [ ] **67.** Journal: clicking a numbered map pin opens a popup with number, name, address, coordinates and chips, readable in the dark theme
- [ ] **68.** Journal: a single entry page shows the module rail, section panel and header (no more bare page with a "Back to My Journal" link)

---

## 2026-09-23 — Release

Migrations 0106, 0107 and 0108 are applied on the NAS. The Investments rename
touched ~83 files and renamed 17 tables, so the items below are worth a walk
through even where the screen looks unchanged — a missed server action throws
only when that one feature is used, not when the page loads.

- [ ] **69.** Investments: the module opens at /modules/investments, named Investments on the rail and home grid
- [ ] **70.** Investments: every section loads — Dashboard, Positions, Transactions, Account Performance, Watch & Test, Chart & Analysis, CSV Import, Tax Lots, Export for AI Analysis, Settings
- [ ] **71.** Investments: the actions still write — add/edit a position, a transaction, a watchlist entry, an account
- [ ] **72.** Investments: Tax Lots deep links still resolve (ticker picker, and the links out of the positions grid)
- [ ] **73.** Investments: CSV import of a broker file
- [ ] **74.** Admin → SQL Explorer: the Investments group lists the inv_ tables, and Table References names them
- [ ] **75.** Admin → Background Tasks: the Investments auto-refresh still finds its module
- [ ] **76.** Home: the Daily Glance card renders and its "Launch Investments" link goes to the new URL
- [ ] **77.** Investments: uploaded section/card icons survived the rename (slot ids were deliberately left on `stock_*`)
- [x] **78.** Expense: Transaction Rule Types — group rules by type, filter the rules list, manage types in Meta Data  — tested 2026-09-23
- [x] **79.** Security → Visits: why a visit was scored suspicious (signals on the row)

---

## 2026-09-22 — Release

- [x] **80.** CSV Analysis: pooled datasets
- [x] **81.** Admin-set preferences (allow edit user's preferences)
- [x] **82.** Location icons

## 2026-09-20

- [x] **83.** Journal: filter the category and tag lists in Meta Data
- [x] **84.** Journal: a saved-location library
- [x] **85.** Journal: Entries as one screen with two tabs
- [x] **86.** Tools: a CSV file browser beside the SQLite one

## 2026-09-19

- [x] **87.** Journal: keep or file a photo from an entry
- [x] **88.** TreeNav: each group reads as its own embossed card
- [x] **89.** Tools: SQLite uploads over 4 MB, with an admin-set cap
- [ ] **90.** Stocks: icons on the indexes board
- [ ] **91.** Stocks: playback of portfolio history
- [ ] **92.** Music: a sleep timer that stops the player after a set time

## 2026-09-17

- [ ] **93.** Home screen: launch a card's module from its title
- [ ] **94.** Journal: review existing entries before importing from a calendar
- [ ] **95.** Tools: a new module, opening with a SQLite file browser

## 2026-09-15

- [ ] **96.** Floating layer: a clock over every page
- [ ] **97.** Floating layer: a calculator over every page
- [ ] **98.** Floating layer: a scratchpad over every page
- [ ] **99.** Stocks: the indexes board loads when you open the card
- [ ] **100.** Admin: clear deployment records in bulk, or prune to the newest few
- [ ] **101.** Journal: jump to the next day that has an entry
- [ ] **102.** NAS: a startup crash that says what broke

## 2026-09-14

- [ ] **103.** Journal: date the template suggestion by the local calendar
- [ ] **104.** Themes: tell the browser a dark theme is dark
- [ ] **105.** Export for AI: measured correlations, and the sectors you hold nothing in
- [ ] **106.** Home: a Clock card, with the weather where you are
- [ ] **107.** Picture Gallery: Magic List — photographs conjured from a description
- [ ] **108.** Stocks: candlesticks in the ticker viewer's Today card
- [ ] **109.** Stocks: consult AI about one ticker
- [ ] **110.** Stocks: a transaction knows which account it belongs to

## 2026-09-13

- [ ] **111.** Attendance: bigger cards in the register grid
- [ ] **112.** Admin: random theme generation
- [ ] **113.** Music Library: an Albums view
- [ ] **114.** Stocks & ETFs: a recorded trade can update the holding
- [ ] **115.** MyJournal: New Entry becomes a section
- [ ] **116.** Games: Bridge
- [ ] **117.** SQL Explorer: BLOB cells fetched on demand
- [ ] **118.** SQL Explorer: tables grouped by module
- [ ] **119.** Account: two compact navigation styles, and the reader picks
- [ ] **120.** Icon names: the compiler catches glyph-table drift

## 2026-09-11

- [ ] **121.** Journal: Calendar Import — read a Google/Outlook .ics and pick events to import
- [ ] **122.** Journal: re-importing a renamed or moved event updates it instead of duplicating
- [ ] **123.** Journal: a large .ics (2.4 MB) uploads without tripping the action-argument limit
- [ ] **124.** Journal: restoring an imported entry from the recycle bin keeps its identity
- [ ] **125.** Stocks: a portfolio brief for an LLM
- [ ] **126.** Attendance: one register per class per day again
- [ ] **127.** Attendance: session labels read in local time, not four hours ahead

## 2026-09-10

- [ ] **128.** Picture Gallery: albums
- [ ] **129.** Picture Gallery: a + on every photograph
- [ ] **130.** Home screen: a handwritten quote, no header, and a slimmer rail

## 2026-09-09

- [ ] **131.** Security: every exported server action authorises on its first line
- [ ] **132.** Stocks & ETFs: analyze several tickers at once, and link to an analysis
- [ ] **133.** Music Library: the song on YouTube
- [ ] **134.** Music Library: a real fullscreen visualizer
- [ ] **135.** Picture Gallery: a module of its own, not a corner of the home screen

## 2026-09-08

- [ ] **136.** Games: Mahjong pickers and board frame
- [ ] **137.** Stocks & ETFs: today's session in the ticker viewer
- [ ] **138.** Journal: a space-separated Tags column no longer imports as one long tag
- [ ] **139.** CSV Analytics: bulk edit rows
- [ ] **140.** CSV Analytics: a CLI for bulk edit
- [ ] **141.** Photographs: one viewer, with a capture timestamp and a heart

## 2026-09-06 — Release

- [ ] **142.** Games: Mahjong, the four-player game against three bots
- [ ] **143.** Stocks & ETFs: the Tax Lot Portfolio Analyzer
- [ ] **144.** About: count untagged changes instead of reporting zero
- [ ] **145.** Home: the Random Photo card streams instead of blocking first paint
- [ ] **146.** Photos: an absolute path can no longer escape the photo folder
- [ ] **147.** Compact grids: long values are readable
- [ ] **148.** Compact grids: a second layout for reading
- [ ] **149.** Music: the story behind the song, beside the lyrics
- [ ] **150.** Games: Mahjong Match
- [ ] **151.** Games: card icons across the whole arcade
- [ ] **152.** Attendance: upload your own icon for a student action
- [ ] **153.** CSV Analysis: named views over a dataset

## 2026-09-03

- [ ] **154.** Attendance: a class records the weekday it meets on
- [ ] **155.** Attendance: the home screen opens on today's register
- [ ] **156.** Photos: a viewer component with its own actions
- [ ] **157.** Journal: a photos slideshow and folder module
- [ ] **158.** Games: sudoku and blackjack polish
- [ ] **159.** Stocks: the refresh total counts up as prices land

## 2026-09-02 — Release

- [ ] **160.** Expense: top-5 cards link through to their transactions
- [ ] **161.** Expense: the vendor rollup stops inventing vendors from payment lines
- [ ] **162.** Stocks: the indexes refresh becomes an icon
- [ ] **163.** Favourite photos: a slideshow
- [ ] **164.** Carousel graphics are resized on upload
- [ ] **165.** SQL Explorer: a schema browser
- [ ] **166.** SQL Explorer: prose for every table
- [ ] **167.** Music: a spectrum analyser under the cover art
- [ ] **168.** Games: Sudoku
- [ ] **169.** Games: Blackjack
- [ ] **170.** Games: Minesweeper
- [ ] **171.** Journal: a recycle bin
- [ ] **172.** Journal: a Correct tab
- [ ] **173.** Journal: metadata backup

## 2026-09-01 — Release

- [ ] **174.** Journal import: an overwrite mode, with the plan shown before it writes
- [ ] **175.** Favourite photos: their own screen
- [ ] **176.** Favourite photos: a zip download
- [ ] **177.** Admin: a deployment history, with the build log attached
- [ ] **178.** Games: Tetris
- [ ] **179.** Games: Arrow Clearing becomes an actual puzzle
- [ ] **180.** SQL Explorer: a Truncate button, behind a warning that counts the rows
- [ ] **181.** Journal import: normalized entry time stops a re-import duplicating

## 2026-08-30

- [ ] **182.** Themes: colour themes are data, and the builder warns before you blind yourself
- [ ] **183.** Games: Arrow Clearing cannot generate an unsolvable board
- [ ] **184.** Games: an arcade, and a scoreboard the whole house shares

## 2026-08-29

- [ ] **185.** Stocks: five threads on refresh
- [ ] **186.** Stocks: a wildcard that was lying to you
- [ ] **187.** Home: the random photo card says how old the photo is
- [ ] **188.** Stocks: Watch & Test — watch lists, signals and simulation on one screen
- [ ] **189.** Expense: re-run a rule over transactions you have already imported
- [ ] **190.** Expense: a vendor is somebody now, not just a total

## 2026-08-28

- [ ] **191.** Home screen: arrange it yourself
- [ ] **192.** CSV Analysis: the two-tier nav
- [ ] **193.** Home: a photograph drawn at random
- [ ] **194.** Uploaded icons get cleaned up on the way in
- [ ] **195.** Icons: any single icon can be replaced without changing the icon set (73 slots)
- [ ] **196.** Admin → Configuration → Icons: upload an SVG or image per position
- [ ] **197.** Icons: uploaded SVG is sanitized on write
- [ ] **198.** Home: a picture behind the day
- [ ] **199.** Expense: rules that say why

## 2026-08-26

- [ ] **200.** Admin → Background Tasks: every timer in one place, including jobs that never ran
- [ ] **201.** A job killed mid-pass reads as interrupted, never as ok
- [ ] **202.** CLI: list-scheduled-jobs gives the same answer without the web server
- [ ] **203.** Last-run stamps survive the restarts a deploy performs
- [ ] **204.** Stocks: an Indexes card of eleven benchmarks in four groups
- [ ] **205.** Stocks: a new dashboard widget lands beside its neighbour, not at the bottom
- [ ] **206.** Stocks → Simulation: "what if I'd bought then?" across ten windows

## 2026-08-25

- [ ] **207.** Music: a scan that finishes (no OOM on a large NAS folder)
- [ ] **208.** Music: an abandoned scan run closes itself instead of reading "running" forever
- [ ] **209.** Progress3D: one progress bar across the app
- [ ] **210.** Per-module background pictures
- [ ] **211.** Attendance: a Detail report — the whole term as a grid
- [ ] **212.** About: a Server Log tab

## 2026-08-19

- [ ] **213.** Stocks: find a ticker, and star the ones you watch daily
- [ ] **214.** Music Library: Magic Playlists assembled from a query
- [ ] **215.** Music Library: a visible play queue
- [ ] **216.** Music Library: lyrics on demand
- [ ] **217.** Grids that count their own columns
- [ ] **218.** Seven more glyphs
- [ ] **219.** Ticker detail: how far a trade has moved since you made it
- [ ] **220.** Music Library: stream 20,000 songs off the NAS
- [ ] **221.** Attendance: two registers a day
- [ ] **222.** Attendance: student actions, a teacher-editable catalog
- [ ] **223.** Attendance: 12 icon sets, applied to the section nav too

## 2026-08-16

- [ ] **224.** Attendance: a new module — pick a class, tap who is here, save
- [ ] **225.** Attendance: a student can sit in several classes
- [ ] **226.** "Absent" and "attendance was never taken" stay distinguishable
- [ ] **227.** Admin → Security: a sign-in audit log recording logins, failures and logouts
- [ ] **228.** Stocks: allocation by sector
- [ ] **229.** Stocks: candlestick charts
- [ ] **230.** Admin: import daily quotes from a newsletter

## 2026-08-15

- [ ] **231.** Journal: clickable taxonomy
- [ ] **232.** About page: inline markdown in the change log
- [ ] **233.** About page: memory as meters
- [ ] **234.** Home: Daily Glance moves off the Stocks dashboard
- [ ] **235.** Installable PWA: stable identity, module shortcuts, iOS launch screens
- [ ] **236.** Per-user preferences: a favourite module you can open on startup

## 2026-08-14

- [ ] **237.** Journal: a filtered Entries browser with saved AND/OR filters
- [ ] **238.** Journal: icons for categories and tags
- [ ] **239.** Deploys apply their own migrations, and fail loudly rather than serving new code
- [ ] **240.** CSV Analytics: add columns without re-importing a file
- [ ] **241.** ModuleCarousel: a grid on desktop, coverflow on phones
- [ ] **242.** DataGrid: column headers popped up into a 3D bar
- [ ] **243.** Journal: home-screen search
- [ ] **244.** The section bar moved to the bottom, and modules collapsed into a menu

## 2026-08-11

- [ ] **245.** CSV Analytics: add custom columns during append/truncate

## 2026-08-10

- [ ] **246.** The section tree became a bar, and surfaces learned to lift

## 2026-08-08

- [ ] **247.** The compact section bar
- [ ] **248.** User management gated on admin
- [ ] **249.** Home: announce a new deployment
- [ ] **250.** Navigation moved to the edges — a top bar plus a compact bottom module bar
- [ ] **251.** Both nav bars minimise to a puck and remember it
- [ ] **252.** Every chart got a gear

## 2026-08-07

- [ ] **253.** Restart the NAS after a publish without SSH
- [ ] **254.** The app works on a phone — one layout boundary at 1024px, decided server-side
- [ ] **255.** Installable to the home screen
- [ ] **256.** Stocks: ticker viewer as cards, with Events and Yahoo Detail tabs
- [ ] **257.** Stocks: risk cached and served at any age, refreshed only by Recalculate
- [ ] **258.** Stocks: earnings data no longer vanishes (Yahoo User-Agent and crumb race)
- [ ] **259.** Home: the module grid becomes a carousel with per-module artwork
- [ ] **260.** Image uploads send a File in FormData rather than base64

## 2026-08-05

- [ ] **261.** Stocks: positions split into Stocks / ETF / Others
- [ ] **262.** Stocks: Daily Glance — one table for the three buckets, with the total
- [ ] **263.** Stocks: Account Performance Over Time on one set of axes
- [ ] **264.** Stocks: remember which account a broker's CSV label means
- [ ] **265.** Hide the sidebar to its accent strip, and give the page back the gutter
- [ ] **266.** Stocks: performance chart points shaped by what they are
- [ ] **267.** Stocks: ticker viewer — everything about one symbol in one dialog
- [ ] **268.** Stocks: choose which dashboard widgets show, and in what order
- [ ] **269.** Stocks: record the brokerage firm on a trade, and fix duplicate detection
- [ ] **270.** Stocks: cost basis, so total return is possible at all
- [ ] **271.** Stocks: daily snapshots, value and gain/loss per bucket
- [ ] **272.** Stocks: an icon per investment account
- [ ] **273.** Stocks: eight routed sections behind a TreeNav, loading per section
- [ ] **274.** Stocks: Refresh All with per-ticker progress
- [ ] **275.** Stocks: a per-ticker news lookup
- [ ] **276.** CSV import: one screen for all three types, listing every row
- [ ] **277.** A verification gate: typecheck, boundary, tests, migration dry-run, e2e

## 2026-08-03

- [ ] **278.** Full-width layout: one shared container across every full-page screen
- [ ] **279.** A fixed sidebar raised above the page, so a module gets the rest of the screen
- [ ] **280.** Expense: spend stats
- [ ] **281.** Expense: an auto-import switch
- [ ] **282.** Expense: an uploadable icon per category
- [ ] **283.** Stocks: cache and show ticker logos
- [ ] **284.** DataGrid: filter expressions
- [ ] **285.** DataGrid: column aggregates
- [ ] **286.** DataGrid: record view
- [ ] **287.** Modal extracted as its own component
- [ ] **288.** Three colour themes and three icon sets

## 2026-08-02

- [ ] **289.** Expense: automatic CSV import from a watched folder, one sub-folder per card
- [ ] **290.** Expense: a processed file is renamed .backup, a failure .failed
- [ ] **291.** Expense: post-import rules — one condition, any number of field assignments
- [ ] **292.** Expense: "Manually Run Import Clean up" with real progress
- [ ] **293.** Expense: the tree-nav overhaul
- [ ] **294.** Expense: a new module for credit-card spending
- [ ] **295.** Expense: fuzzy auto-categorisation by glob against the statement description
- [ ] **296.** Expense: CSV import with a saved column mapping per card company
- [ ] **297.** Admin: import daily quotes from a newsletter

## 2026-07-30

- [ ] **298.** Result grid: search, filters, sticky header, column control, row selection
- [ ] **299.** Journal: entry authoring with category/tag autocomplete
- [ ] **300.** Journal: a Leaflet location picker with search and multiple pins
- [ ] **301.** Journal: fetch today's weather
- [ ] **302.** Journal: the entry screen, with Print/Save-PDF, Edit, Lock and Delete
- [ ] **303.** Journal: Today In History

## 2026-07-27

- [ ] **304.** Journal: a new module, with CSV import of a real export
- [ ] **305.** Real Estate and Property Watch removed
- [ ] **306.** Every table renamed to a 3-letter module prefix
- [ ] **307.** Daily Quote

## 2026-07-25

- [ ] **308.** Self-signup, always as a plain user with no module access
- [ ] **309.** Admin elevation behind a secret that stays hidden until you type "adm"
- [ ] **310.** User-selectable module icon sets
- [ ] **311.** Daybreak, the first light theme

## 2026-07-21

- [ ] **312.** Interactive DataGrid: click-to-sort, paging, Export CSV, Show SQL
- [ ] **313.** CSV Analysis: Show Data and Chart per entry
- [ ] **314.** CSV chart builder with presets
- [ ] **315.** ChartXY: line/bar/scatter/area with zoom

## 2026-07-19

- [ ] **316.** CSV Analytics: a new module
- [ ] **317.** Theme and UI polish
- [ ] **318.** ARM/Synology NAS deployment support

## 2026-07-18

- [ ] **319.** Stocks & ETFs: accounts, positions, transactions and portfolio summary
- [ ] **320.** Stocks & ETFs: a Yahoo Finance market-data client with manual/CLI refresh
- [ ] **321.** Stocks & ETFs: volatility, correlation and Sharpe analytics
- [ ] **322.** Stocks & ETFs: a Next Day Actions signal scanner
- [ ] **323.** Stocks & ETFs: CSV import with saved column-mapping presets
- [ ] **324.** Admin: SQL Explorer
- [ ] **325.** ChartLine, ChartBar and Tabs components
- [ ] **326.** Publish applies pending migrations, with an automatic backup
- [ ] **327.** ~~Real Estate: property portfolio and a RentCast watch list~~ *(removed 2026-07-27, migration 0026)*

## 2026-07-13

- [ ] **328.** Google auto-registration
- [ ] **329.** User avatars
- [ ] **330.** start.bat port cleanup

## 2026-07-12

- [ ] **331.** User management
- [ ] **332.** Authentication and Google sign-in
- [ ] **333.** Administration section
- [ ] **334.** Module Settings
- [ ] **335.** Initial scaffold: modules, settings, admin section
