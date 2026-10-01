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

## 2026-09-30 — Release (TODO Lists, Chrome Style & Border Weight, Journal review)

**Migration 0123 must be applied** — `tol_todo_categories` and `tol_todo_items`. If
Tools → TODO Lists or the home-screen TODO card 404s or reports "no such table", check
`sys_schema_migrations` before reading anything here as a bug. Migrations 0121 and 0122
are data-only seed rows (`chrome_style`, `border_widths`) — their settings fall back to
the pre-existing look if missing, so they degrade quietly rather than erroring, but
should still be confirmed applied.

Items 1–8 are TODO Lists — item 3 is the one regression check for the shared-list
design (two browsers/accounts must see the same tick land), and item 7 is the delete
guard that must never cascade. Items 9–10 are Chrome Style and Border Weight — both are
desktop-only in effect (item 10's inner-divider axis has nothing to show on a phone,
where the tree doesn't render). Items 11–12 are the Journal Main-tab fix — item 11 is
the one that matters most for trust: a tag or category that is all logged activity must
no longer show a count with nothing behind it. Items 13–18 are the calendar import
review rework; item 13 is its own regression check (an untouched date must never be
written by a batch commit). Items 19–21 are Top Words and the new rank bars. Items 22–23
are small polish.

- [ ] **1.** Tools → TODO Lists: the side panel lists every list with an item count;
  switching lists swaps the grid without a page reload
- [ ] **2.** Tools → TODO Lists: adding an item requires a list and a title; it appears
  immediately at the bottom of that list's outstanding items
- [ ] **3.** Tools → TODO Lists: ticking an item moves it into a "Completed (N)" group
  rather than deleting it, and the same list opened from a second account/browser shows
  the same tick (lists and items are shared, not per-person)
- [ ] **4.** Tools → TODO Lists: the hover ✕ removes a single completed item; "Clear
  all" empties the whole Completed group in one click
- [ ] **5.** Tools → TODO Lists: on a phone, the ✕ and list-delete controls are visible
  without hovering (there is no hover on touch)
- [ ] **6.** Home screen: the TODO card shows the same lists as tabs with a checkbox per
  outstanding item; its title links straight to the Tools screen
- [ ] **7.** Administration → TODO Lists: renaming and reordering a list is immediate;
  deleting a list that still holds items (completed ones included) is refused and names
  the counts in the refusal
- [ ] **8.** CLI: `npm run cli -- todo` lists every list and its outstanding items;
  `--add "…" --list "<name>"`, `--done <id>`, `--delete <id>` and `--new-list "<name>"`
  each work and match what the web screens show afterward
- [ ] **9.** Administration → Display Settings → Chrome Style: picking Inset, Outset or
  Emboss changes the header and the navigation tree's bevel immediately on Save; the
  four preview cards show four visibly different treatments before saving anything
- [ ] **10.** Administration → Display Settings → Border Weight: moving the Chrome
  outline, Inner dividers and Everything else sliders each visibly thickens only their
  own scope (header/tree outer edge; tree's internal rules; every other border app-wide)
  and nothing shifts layout at 1–4px
- [ ] **11.** Journal → a tag or category whose entries are all tagged "Log": clicking
  it from the Statistics card's Main-tab view now shows those entries instead of an
  empty list (previously the count was right and the list was empty)
- [ ] **12.** Journal → Entries browser: the dedicated Log tab still excludes non-Log
  entries as before — only the Main tab's behavior changed
- [ ] **13.** Journal → Preferences → "Review before calendar import" on, then import a
  calendar with more than 10 conflicting dates: the review dialog pages 10 at a time,
  and "Commit reviewed" writes only the dates actually decided on-screen, never an
  un-paged-to date
- [ ] **14.** Journal → calendar import review dialog: a conflicting date's existing
  entry can be quick-edited without closing the dialog, and the row gets an "edited"
  badge afterward
- [ ] **15.** Journal → calendar import review dialog: a locked existing entry's
  quick-edit is disabled rather than offered and then rejected
- [ ] **16.** Journal → calendar import: starting an import shows a progress dialog
  with the event count while it runs, and a result summary (imported/updated/
  skipped/excluded counts, with duration) once it finishes
- [ ] **17.** Journal → calendar import: "Import all" still imports everything except
  dates explicitly declined, matching the pre-existing behavior
- [ ] **18.** Journal → calendar import review dialog: the Instructions card's open/
  closed state does not persist between dialog openings (it is controlled, unlike other
  collapsible cards)
- [ ] **19.** Journal home screen: Top Tags, Top Categories and Top 10 Words each show a
  small proportional bar beside every row, sized against that list's own top entry;
  hidden on a phone
- [ ] **20.** Journal home screen → Top 10 Words: clicking the ✕ beside a word removes
  it from the ranking everywhere, and a word that would otherwise rank in the top 10
  moves up to fill its place
- [ ] **21.** Journal → Preferences → Excluded words: a dismissed word is listed as a
  chip; clicking it restores the word and it can rank again on the home screen
- [ ] **22.** Any screen with a collapsible card (e.g. Journal's Recent Entries):
  collapse one, navigate away and back — it stays collapsed; a card using controlled
  `open`/`onOpenChange` is unaffected
- [ ] **23.** Home screen → My Shortcuts with 1–3 shortcuts on a phone: the tiles fill
  the row as full-width bars instead of leaving a ragged empty grid cell

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

- [ ] **24.** Household → Recipes: the list shows tabs — All, one per category with
  a count, then Uncategorised — instead of a Category dropdown; clicking a
  category tab narrows the grid and updates the URL (`?category=`)
- [ ] **25.** Household → Recipes: the Uncategorised tab's count matches the number
  of recipes with no category set, and narrows the grid to exactly those
- [ ] **26.** Household → Recipes: a bookmarked or refreshed `?category=` URL opens
  on the right tab; Uncategorised does not survive a refresh (falls back to All)
- [ ] **27.** Household → Recipes: the grid shows Name, Description, Tags, Made and
  Rating; Category, Source and the picture are gone from the grid but still
  visible in the record view
- [ ] **28.** Household → Recipes: clicking **View**, or clicking anywhere on a row,
  opens a record view showing every field — including ingredients, directions
  and notes, each inside its own bordered/inset panel
- [ ] **29.** Household → Recipes → Edit: Ingredients and Directions are each a
  full-width row (not side-by-side), Description is a 3-line box, there is no
  Cancel button (the modal's own close and Escape still work), and Save reads
  "Save Recipe"
- [ ] **30.** Household → Recipes → Add: choosing a picture before saving shows a
  preview immediately; saving the new recipe attaches that picture without a
  second trip back into the editor
- [ ] **31.** Household → Recipes: if attaching a picture fails right after a
  successful save, the message says the recipe *was* saved and names the
  picture as the only thing that didn't attach — never reads as if nothing
  happened
- [ ] **32.** Household → Recipes: a picture added through the editor or through
  "Replace picture" in the record view is visibly smaller than the original
  file (check its size via the browser's network tab or file download) —
  existing pictures added before this release are untouched
- [ ] **33.** Home screen (full/desktop layout, ≥1280px wide): a control above the
  cards switches between one and two columns
- [ ] **34.** Home screen: dragging a card by its handle moves it to a new
  position; the new order persists after a refresh
- [ ] **35.** Home screen: with no pointer, the up/down buttons on a card move it
  one place at a time, wrapping neither at the top nor the bottom of the list
- [ ] **36.** Home screen: an admin reordering *Administration → Display Settings
  → Dashboard Widgets* is picked up by a reader who has never dragged a card,
  but does **not** change the arrangement of a reader who has
- [ ] **37.** Home screen: the module carousel always spans both columns and is
  not draggable, regardless of the column count
- [ ] **38.** Home screen on a phone or a narrow window (<1280px): no column
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

- [ ] **39.** Journal → Data Management → Review Data: the card lists every date carrying more than one entry, each row showing its position ("2 of 4"), time, title and a 100-word excerpt — including untitled entries, which the Correct tab beside it leaves out
- [ ] **40.** Journal → Review Data: clicking a row opens the full entry, with an Edit button that opens the same form the single-entry screen uses; closing it returns to the list with page, sort and ticks intact
- [ ] **41.** Journal → Review Data: Edit is disabled on a locked entry, the same as it is from `/entries/[id]`
- [ ] **42.** Journal → Review Data: ticking several entries and choosing Merge drafts one new entry (earliest date/time, titles joined with `/`, each source's content under a `— HH:MM · Title` line, categories and tags combined) and opens it in the ordinary entry form — saving creates the new entry and leaves every source entry exactly where it was
- [ ] **43.** Journal → Review Data: locations and weather are not carried into a merged draft, and the form still lets you add them
- [ ] **44.** Journal → Review Data: ticking several entries and choosing Delete asks first, then moves them to the recycle bin (restorable from the Correct tab)
- [ ] **45.** CLI: `npm run cli -- journal-same-date`, `--merge 41,42,43` (prints only), `--merge ... --save` (creates), and `--delete 41,42` all behave as documented
- [ ] **46.** Administration → Configuration → Module Configuration: the Music Library's background texture control shows "Its own uploaded picture" already selected, and the module's screens still show the same picture as before this release
- [ ] **47.** Administration → Configuration → Module Configuration: a module with no picture of its own can pick "Pick one from the library" and choose a thumbnail from the App Texture library; that module's screens then show it with that picture's own opacity/blur
- [ ] **48.** Administration → Configuration → Module Configuration: a module set to "None — plain paper" stays flat even when an app-wide texture is on
- [ ] **49.** Administration → Configuration → App Texture: deleting a library picture that a module was pointed at drops that module back to the app background rather than breaking its screen
- [ ] **50.** Administration → Configuration → App Texture: on an install that has not touched the new "Show on every screen" tick box, the background still appears only on the home dashboard, exactly as before this release
- [ ] **51.** Administration → Configuration → App Texture: ticking "Show on every screen" puts the selected picture behind every module, Administration and the account screen, all sharing one background
- [ ] **52.** Administration → Configuration → App Texture: with the app-wide texture on, a module that still has its own uploaded picture (Music) keeps showing its own picture instead of the app-wide one

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

- [ ] **53.** Home: the My Shortcuts card appears, and Admin → Display Settings → Dashboard Widgets can hide and reorder it like any other card
- [ ] **54.** Add a shortcut to a web address — a bare `example.com` gets `https://` added, and the tile opens it in a new tab
- [ ] **55.** Add a shortcut to a page in this app: pick a module, then a section — and separately, a module's own main page
- [ ] **56.** A shortcut into a module you can no longer open draws greyed out with a reason, rather than disappearing
- [ ] **57.** Upload a picture as a shortcut's icon; removing it falls back to the glyph underneath rather than leaving the tile blank
- [ ] **58.** Two accounts: each sees only their own shortcuts, and one cannot fetch the other's uploaded icon by its URL
- [ ] **59.** Edit, reorder and remove a shortcut from the card itself; renaming one keeps its uploaded picture
- [ ] **60.** The twelfth shortcut is the last — Add is refused with a message rather than failing silently
- [ ] **61.** An oversized picture (over 256 KB) is refused immediately with the app's own wording, not a server error
- [ ] **62.** Desktop: shortcut tiles read as 3D buttons — they lift on hover and press down on click, and the row controls appear on hover
- [ ] **63.** Phone: the tiles reflow to the width available and their edit controls are visible without hovering
- [ ] **64.** Navigation: a section group whose heading has its own page draws as a link with its glyph; headings without one stay plain labels
- [ ] **65.** Music: reorder a playlist entry up and down — a playlist holding the same track twice moves the two copies independently
- [ ] **66.** Administration → About loads and shows its disk figures (this screen previously failed to build)

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

- [ ] **67.** Every module and Admin: the left column is one tree — Home on top, each module a heading that expands to its sections
- [ ] **68.** The tree: clicking a module heading expands and collapses it; the module you are currently in is always open
- [ ] **69.** Filter: typing `import` finds Journal, Investments and Expense sections together, each labelled with its module
- [ ] **70.** Filter: matches starting with what you typed rank first; Esc clears; clearing restores the collapse state you had
- [ ] **71.** Collapse: `«` folds the tree to a thin strip and the content widens; the strip and the header's `»` both reopen it
- [ ] **72.** Icons: Admin → Display Settings → Icons can replace the tree's Home and filter glyphs, and each module's section icons still resolve
- [ ] **73.** Phone: the bottom bar and its sheet behave exactly as before — no tree, no strip, nothing new
- [ ] **74.** The set of expanded modules survives a reload, and is remembered per user rather than per browser

---

## 2026-09-25 — Release

Migration 0112 (`sys_saved_sql_queries`) was applied on the NAS during this
release's publish. If items 37–39 ever report "no such table", that is the thing to
re-check before reading anything else here as a bug.

Item 40 costs live provider calls on every expand, so it can only really be judged
during market hours; item 42 needs a file whose tags actually carry lyrics, which
not every track in the library has. Item 44 is phone-relevant — the expanded index
panel adds six figures and a sparkline to a row that was already tight.

- [ ] **75.** Admin → SQL Explorer → SQL Query: save a statement with a name, description and tags; it appears on the Saved SQL card
- [ ] **76.** Admin → SQL Explorer: Load fills the editor and does **not** execute — confirm with a statement you would not want run
- [ ] **77.** Admin → SQL Explorer: saving under an existing name replaces that row, and the dialog warns before it does
- [ ] **78.** Investments → Indexes card: a row expands to show day range, 52-week range with its marker, moving averages, one-year change, all-time high and a sparkline
- [ ] **79.** Investments → Indexes card: a symbol whose second pass fails keeps its row and shows em-dashes (the three commodity futures have no one-year change)
- [ ] **80.** Music: a track with embedded lyrics shows them attributed "From this file's own tags", without a network lookup
- [ ] **81.** Music: a track with no embedded and no lrclib match offers the Google search link
- [ ] **82.** Investments → Indexes card: the expanded panel and sparkline are readable on a phone
- [ ] **83.** Admin → Daily Quote → All Quotes: the new nav entry opens the listing screen
- [ ] **84.** CLI: `saved-sql list` / `show` / `save` / `delete` behave as documented

---

## 2026-09-24 — Release

No new migrations: 0109–0111 shipped with the previous release and are already
applied on the NAS. Item 49 is the one to watch — the dedup rule changed, so a
scan that used to return nothing may now return groups, and blank-named places
can group on distance alone. Items 51 and 50 are phone-relevant: the popup and the
picker's refusal message both have to be readable narrow.

- [ ] **85.** Admin → Message Queue: the screen lists read and unread together, newest first, with each message's source
- [ ] **86.** Admin → Message Queue: tick rows and Delete removes them; Purge by age (7/30/90/365 days) clears everything older and keeps the rest
- [ ] **87.** Journal → Merging & Dedup: the "Within" slider (10–500m, default 75m) rescans on release, and groups found by distance are labelled "proximity"
- [ ] **88.** Journal → Merging & Dedup: two pins ~25–50m apart with similar names now group (they did not before); merging one still works
- [ ] **89.** Journal → entry form: adding a location already on the entry is refused with a message, and the draft pin stays put — from both the map tab and the library tab
- [ ] **90.** Journal: clicking a numbered map pin opens a popup with number, name, address, coordinates and chips, readable in the dark theme
- [ ] **91.** Journal: a single entry page shows the module rail, section panel and header (no more bare page with a "Back to My Journal" link)

---

## 2026-09-23 — Release

Migrations 0106, 0107 and 0108 are applied on the NAS. The Investments rename
touched ~83 files and renamed 17 tables, so the items below are worth a walk
through even where the screen looks unchanged — a missed server action throws
only when that one feature is used, not when the page loads.

- [ ] **92.** Investments: the module opens at /modules/investments, named Investments on the rail and home grid
- [ ] **93.** Investments: every section loads — Dashboard, Positions, Transactions, Account Performance, Watch & Test, Chart & Analysis, CSV Import, Tax Lots, Export for AI Analysis, Settings
- [ ] **94.** Investments: the actions still write — add/edit a position, a transaction, a watchlist entry, an account
- [ ] **95.** Investments: Tax Lots deep links still resolve (ticker picker, and the links out of the positions grid)
- [ ] **96.** Investments: CSV import of a broker file
- [ ] **97.** Admin → SQL Explorer: the Investments group lists the inv_ tables, and Table References names them
- [ ] **98.** Admin → Background Tasks: the Investments auto-refresh still finds its module
- [ ] **99.** Home: the Daily Glance card renders and its "Launch Investments" link goes to the new URL
- [ ] **100.** Investments: uploaded section/card icons survived the rename (slot ids were deliberately left on `stock_*`)
- [x] **101.** Expense: Transaction Rule Types — group rules by type, filter the rules list, manage types in Meta Data  — tested 2026-09-23
- [x] **102.** Security → Visits: why a visit was scored suspicious (signals on the row)

---

## 2026-09-22 — Release

- [x] **103.** CSV Analysis: pooled datasets
- [x] **104.** Admin-set preferences (allow edit user's preferences)
- [x] **105.** Location icons

## 2026-09-20

- [x] **106.** Journal: filter the category and tag lists in Meta Data
- [x] **107.** Journal: a saved-location library
- [x] **108.** Journal: Entries as one screen with two tabs
- [x] **109.** Tools: a CSV file browser beside the SQLite one

## 2026-09-19

- [x] **110.** Journal: keep or file a photo from an entry
- [x] **111.** TreeNav: each group reads as its own embossed card
- [x] **112.** Tools: SQLite uploads over 4 MB, with an admin-set cap
- [ ] **113.** Stocks: icons on the indexes board
- [ ] **114.** Stocks: playback of portfolio history
- [ ] **115.** Music: a sleep timer that stops the player after a set time

## 2026-09-17

- [ ] **116.** Home screen: launch a card's module from its title
- [ ] **117.** Journal: review existing entries before importing from a calendar
- [ ] **118.** Tools: a new module, opening with a SQLite file browser

## 2026-09-15

- [ ] **119.** Floating layer: a clock over every page
- [ ] **120.** Floating layer: a calculator over every page
- [ ] **121.** Floating layer: a scratchpad over every page
- [ ] **122.** Stocks: the indexes board loads when you open the card
- [ ] **123.** Admin: clear deployment records in bulk, or prune to the newest few
- [ ] **124.** Journal: jump to the next day that has an entry
- [ ] **125.** NAS: a startup crash that says what broke

## 2026-09-14

- [ ] **126.** Journal: date the template suggestion by the local calendar
- [ ] **127.** Themes: tell the browser a dark theme is dark
- [ ] **128.** Export for AI: measured correlations, and the sectors you hold nothing in
- [ ] **129.** Home: a Clock card, with the weather where you are
- [ ] **130.** Picture Gallery: Magic List — photographs conjured from a description
- [ ] **131.** Stocks: candlesticks in the ticker viewer's Today card
- [ ] **132.** Stocks: consult AI about one ticker
- [ ] **133.** Stocks: a transaction knows which account it belongs to

## 2026-09-13

- [ ] **134.** Attendance: bigger cards in the register grid
- [ ] **135.** Admin: random theme generation
- [ ] **136.** Music Library: an Albums view
- [ ] **137.** Stocks & ETFs: a recorded trade can update the holding
- [ ] **138.** MyJournal: New Entry becomes a section
- [ ] **139.** Games: Bridge
- [ ] **140.** SQL Explorer: BLOB cells fetched on demand
- [ ] **141.** SQL Explorer: tables grouped by module
- [ ] **142.** Account: two compact navigation styles, and the reader picks
- [ ] **143.** Icon names: the compiler catches glyph-table drift

## 2026-09-11

- [ ] **144.** Journal: Calendar Import — read a Google/Outlook .ics and pick events to import
- [ ] **145.** Journal: re-importing a renamed or moved event updates it instead of duplicating
- [ ] **146.** Journal: a large .ics (2.4 MB) uploads without tripping the action-argument limit
- [ ] **147.** Journal: restoring an imported entry from the recycle bin keeps its identity
- [ ] **148.** Stocks: a portfolio brief for an LLM
- [ ] **149.** Attendance: one register per class per day again
- [ ] **150.** Attendance: session labels read in local time, not four hours ahead

## 2026-09-10

- [ ] **151.** Picture Gallery: albums
- [ ] **152.** Picture Gallery: a + on every photograph
- [ ] **153.** Home screen: a handwritten quote, no header, and a slimmer rail

## 2026-09-09

- [ ] **154.** Security: every exported server action authorises on its first line
- [ ] **155.** Stocks & ETFs: analyze several tickers at once, and link to an analysis
- [ ] **156.** Music Library: the song on YouTube
- [ ] **157.** Music Library: a real fullscreen visualizer
- [ ] **158.** Picture Gallery: a module of its own, not a corner of the home screen

## 2026-09-08

- [ ] **159.** Games: Mahjong pickers and board frame
- [ ] **160.** Stocks & ETFs: today's session in the ticker viewer
- [ ] **161.** Journal: a space-separated Tags column no longer imports as one long tag
- [ ] **162.** CSV Analytics: bulk edit rows
- [ ] **163.** CSV Analytics: a CLI for bulk edit
- [ ] **164.** Photographs: one viewer, with a capture timestamp and a heart

## 2026-09-06 — Release

- [ ] **165.** Games: Mahjong, the four-player game against three bots
- [ ] **166.** Stocks & ETFs: the Tax Lot Portfolio Analyzer
- [ ] **167.** About: count untagged changes instead of reporting zero
- [ ] **168.** Home: the Random Photo card streams instead of blocking first paint
- [ ] **169.** Photos: an absolute path can no longer escape the photo folder
- [ ] **170.** Compact grids: long values are readable
- [ ] **171.** Compact grids: a second layout for reading
- [ ] **172.** Music: the story behind the song, beside the lyrics
- [ ] **173.** Games: Mahjong Match
- [ ] **174.** Games: card icons across the whole arcade
- [ ] **175.** Attendance: upload your own icon for a student action
- [ ] **176.** CSV Analysis: named views over a dataset

## 2026-09-03

- [ ] **177.** Attendance: a class records the weekday it meets on
- [ ] **178.** Attendance: the home screen opens on today's register
- [ ] **179.** Photos: a viewer component with its own actions
- [ ] **180.** Journal: a photos slideshow and folder module
- [ ] **181.** Games: sudoku and blackjack polish
- [ ] **182.** Stocks: the refresh total counts up as prices land

## 2026-09-02 — Release

- [ ] **183.** Expense: top-5 cards link through to their transactions
- [ ] **184.** Expense: the vendor rollup stops inventing vendors from payment lines
- [ ] **185.** Stocks: the indexes refresh becomes an icon
- [ ] **186.** Favourite photos: a slideshow
- [ ] **187.** Carousel graphics are resized on upload
- [ ] **188.** SQL Explorer: a schema browser
- [ ] **189.** SQL Explorer: prose for every table
- [ ] **190.** Music: a spectrum analyser under the cover art
- [ ] **191.** Games: Sudoku
- [ ] **192.** Games: Blackjack
- [ ] **193.** Games: Minesweeper
- [ ] **194.** Journal: a recycle bin
- [ ] **195.** Journal: a Correct tab
- [ ] **196.** Journal: metadata backup

## 2026-09-01 — Release

- [ ] **197.** Journal import: an overwrite mode, with the plan shown before it writes
- [ ] **198.** Favourite photos: their own screen
- [ ] **199.** Favourite photos: a zip download
- [ ] **200.** Admin: a deployment history, with the build log attached
- [ ] **201.** Games: Tetris
- [ ] **202.** Games: Arrow Clearing becomes an actual puzzle
- [ ] **203.** SQL Explorer: a Truncate button, behind a warning that counts the rows
- [ ] **204.** Journal import: normalized entry time stops a re-import duplicating

## 2026-08-30

- [ ] **205.** Themes: colour themes are data, and the builder warns before you blind yourself
- [ ] **206.** Games: Arrow Clearing cannot generate an unsolvable board
- [ ] **207.** Games: an arcade, and a scoreboard the whole house shares

## 2026-08-29

- [ ] **208.** Stocks: five threads on refresh
- [ ] **209.** Stocks: a wildcard that was lying to you
- [ ] **210.** Home: the random photo card says how old the photo is
- [ ] **211.** Stocks: Watch & Test — watch lists, signals and simulation on one screen
- [ ] **212.** Expense: re-run a rule over transactions you have already imported
- [ ] **213.** Expense: a vendor is somebody now, not just a total

## 2026-08-28

- [ ] **214.** Home screen: arrange it yourself
- [ ] **215.** CSV Analysis: the two-tier nav
- [ ] **216.** Home: a photograph drawn at random
- [ ] **217.** Uploaded icons get cleaned up on the way in
- [ ] **218.** Icons: any single icon can be replaced without changing the icon set (73 slots)
- [ ] **219.** Admin → Configuration → Icons: upload an SVG or image per position
- [ ] **220.** Icons: uploaded SVG is sanitized on write
- [ ] **221.** Home: a picture behind the day
- [ ] **222.** Expense: rules that say why

## 2026-08-26

- [ ] **223.** Admin → Background Tasks: every timer in one place, including jobs that never ran
- [ ] **224.** A job killed mid-pass reads as interrupted, never as ok
- [ ] **225.** CLI: list-scheduled-jobs gives the same answer without the web server
- [ ] **226.** Last-run stamps survive the restarts a deploy performs
- [ ] **227.** Stocks: an Indexes card of eleven benchmarks in four groups
- [ ] **228.** Stocks: a new dashboard widget lands beside its neighbour, not at the bottom
- [ ] **229.** Stocks → Simulation: "what if I'd bought then?" across ten windows

## 2026-08-25

- [ ] **230.** Music: a scan that finishes (no OOM on a large NAS folder)
- [ ] **231.** Music: an abandoned scan run closes itself instead of reading "running" forever
- [ ] **232.** Progress3D: one progress bar across the app
- [ ] **233.** Per-module background pictures
- [ ] **234.** Attendance: a Detail report — the whole term as a grid
- [ ] **235.** About: a Server Log tab

## 2026-08-19

- [ ] **236.** Stocks: find a ticker, and star the ones you watch daily
- [ ] **237.** Music Library: Magic Playlists assembled from a query
- [ ] **238.** Music Library: a visible play queue
- [ ] **239.** Music Library: lyrics on demand
- [ ] **240.** Grids that count their own columns
- [ ] **241.** Seven more glyphs
- [ ] **242.** Ticker detail: how far a trade has moved since you made it
- [ ] **243.** Music Library: stream 20,000 songs off the NAS
- [ ] **244.** Attendance: two registers a day
- [ ] **245.** Attendance: student actions, a teacher-editable catalog
- [ ] **246.** Attendance: 12 icon sets, applied to the section nav too

## 2026-08-16

- [ ] **247.** Attendance: a new module — pick a class, tap who is here, save
- [ ] **248.** Attendance: a student can sit in several classes
- [ ] **249.** "Absent" and "attendance was never taken" stay distinguishable
- [ ] **250.** Admin → Security: a sign-in audit log recording logins, failures and logouts
- [ ] **251.** Stocks: allocation by sector
- [ ] **252.** Stocks: candlestick charts
- [ ] **253.** Admin: import daily quotes from a newsletter

## 2026-08-15

- [ ] **254.** Journal: clickable taxonomy
- [ ] **255.** About page: inline markdown in the change log
- [ ] **256.** About page: memory as meters
- [ ] **257.** Home: Daily Glance moves off the Stocks dashboard
- [ ] **258.** Installable PWA: stable identity, module shortcuts, iOS launch screens
- [ ] **259.** Per-user preferences: a favourite module you can open on startup

## 2026-08-14

- [ ] **260.** Journal: a filtered Entries browser with saved AND/OR filters
- [ ] **261.** Journal: icons for categories and tags
- [ ] **262.** Deploys apply their own migrations, and fail loudly rather than serving new code
- [ ] **263.** CSV Analytics: add columns without re-importing a file
- [ ] **264.** ModuleCarousel: a grid on desktop, coverflow on phones
- [ ] **265.** DataGrid: column headers popped up into a 3D bar
- [ ] **266.** Journal: home-screen search
- [ ] **267.** The section bar moved to the bottom, and modules collapsed into a menu

## 2026-08-11

- [ ] **268.** CSV Analytics: add custom columns during append/truncate

## 2026-08-10

- [ ] **269.** The section tree became a bar, and surfaces learned to lift

## 2026-08-08

- [ ] **270.** The compact section bar
- [ ] **271.** User management gated on admin
- [ ] **272.** Home: announce a new deployment
- [ ] **273.** Navigation moved to the edges — a top bar plus a compact bottom module bar
- [ ] **274.** Both nav bars minimise to a puck and remember it
- [ ] **275.** Every chart got a gear

## 2026-08-07

- [ ] **276.** Restart the NAS after a publish without SSH
- [ ] **277.** The app works on a phone — one layout boundary at 1024px, decided server-side
- [ ] **278.** Installable to the home screen
- [ ] **279.** Stocks: ticker viewer as cards, with Events and Yahoo Detail tabs
- [ ] **280.** Stocks: risk cached and served at any age, refreshed only by Recalculate
- [ ] **281.** Stocks: earnings data no longer vanishes (Yahoo User-Agent and crumb race)
- [ ] **282.** Home: the module grid becomes a carousel with per-module artwork
- [ ] **283.** Image uploads send a File in FormData rather than base64

## 2026-08-05

- [ ] **284.** Stocks: positions split into Stocks / ETF / Others
- [ ] **285.** Stocks: Daily Glance — one table for the three buckets, with the total
- [ ] **286.** Stocks: Account Performance Over Time on one set of axes
- [ ] **287.** Stocks: remember which account a broker's CSV label means
- [ ] **288.** Hide the sidebar to its accent strip, and give the page back the gutter
- [ ] **289.** Stocks: performance chart points shaped by what they are
- [ ] **290.** Stocks: ticker viewer — everything about one symbol in one dialog
- [ ] **291.** Stocks: choose which dashboard widgets show, and in what order
- [ ] **292.** Stocks: record the brokerage firm on a trade, and fix duplicate detection
- [ ] **293.** Stocks: cost basis, so total return is possible at all
- [ ] **294.** Stocks: daily snapshots, value and gain/loss per bucket
- [ ] **295.** Stocks: an icon per investment account
- [ ] **296.** Stocks: eight routed sections behind a TreeNav, loading per section
- [ ] **297.** Stocks: Refresh All with per-ticker progress
- [ ] **298.** Stocks: a per-ticker news lookup
- [ ] **299.** CSV import: one screen for all three types, listing every row
- [ ] **300.** A verification gate: typecheck, boundary, tests, migration dry-run, e2e

## 2026-08-03

- [ ] **301.** Full-width layout: one shared container across every full-page screen
- [ ] **302.** A fixed sidebar raised above the page, so a module gets the rest of the screen
- [ ] **303.** Expense: spend stats
- [ ] **304.** Expense: an auto-import switch
- [ ] **305.** Expense: an uploadable icon per category
- [ ] **306.** Stocks: cache and show ticker logos
- [ ] **307.** DataGrid: filter expressions
- [ ] **308.** DataGrid: column aggregates
- [ ] **309.** DataGrid: record view
- [ ] **310.** Modal extracted as its own component
- [ ] **311.** Three colour themes and three icon sets

## 2026-08-02

- [ ] **312.** Expense: automatic CSV import from a watched folder, one sub-folder per card
- [ ] **313.** Expense: a processed file is renamed .backup, a failure .failed
- [ ] **314.** Expense: post-import rules — one condition, any number of field assignments
- [ ] **315.** Expense: "Manually Run Import Clean up" with real progress
- [ ] **316.** Expense: the tree-nav overhaul
- [ ] **317.** Expense: a new module for credit-card spending
- [ ] **318.** Expense: fuzzy auto-categorisation by glob against the statement description
- [ ] **319.** Expense: CSV import with a saved column mapping per card company
- [ ] **320.** Admin: import daily quotes from a newsletter

## 2026-07-30

- [ ] **321.** Result grid: search, filters, sticky header, column control, row selection
- [ ] **322.** Journal: entry authoring with category/tag autocomplete
- [ ] **323.** Journal: a Leaflet location picker with search and multiple pins
- [ ] **324.** Journal: fetch today's weather
- [ ] **325.** Journal: the entry screen, with Print/Save-PDF, Edit, Lock and Delete
- [ ] **326.** Journal: Today In History

## 2026-07-27

- [ ] **327.** Journal: a new module, with CSV import of a real export
- [ ] **328.** Real Estate and Property Watch removed
- [ ] **329.** Every table renamed to a 3-letter module prefix
- [ ] **330.** Daily Quote

## 2026-07-25

- [ ] **331.** Self-signup, always as a plain user with no module access
- [ ] **332.** Admin elevation behind a secret that stays hidden until you type "adm"
- [ ] **333.** User-selectable module icon sets
- [ ] **334.** Daybreak, the first light theme

## 2026-07-21

- [ ] **335.** Interactive DataGrid: click-to-sort, paging, Export CSV, Show SQL
- [ ] **336.** CSV Analysis: Show Data and Chart per entry
- [ ] **337.** CSV chart builder with presets
- [ ] **338.** ChartXY: line/bar/scatter/area with zoom

## 2026-07-19

- [ ] **339.** CSV Analytics: a new module
- [ ] **340.** Theme and UI polish
- [ ] **341.** ARM/Synology NAS deployment support

## 2026-07-18

- [ ] **342.** Stocks & ETFs: accounts, positions, transactions and portfolio summary
- [ ] **343.** Stocks & ETFs: a Yahoo Finance market-data client with manual/CLI refresh
- [ ] **344.** Stocks & ETFs: volatility, correlation and Sharpe analytics
- [ ] **345.** Stocks & ETFs: a Next Day Actions signal scanner
- [ ] **346.** Stocks & ETFs: CSV import with saved column-mapping presets
- [ ] **347.** Admin: SQL Explorer
- [ ] **348.** ChartLine, ChartBar and Tabs components
- [ ] **349.** Publish applies pending migrations, with an automatic backup
- [ ] **350.** ~~Real Estate: property portfolio and a RentCast watch list~~ *(removed 2026-07-27, migration 0026)*

## 2026-07-13

- [ ] **351.** Google auto-registration
- [ ] **352.** User avatars
- [ ] **353.** start.bat port cleanup

## 2026-07-12

- [ ] **354.** User management
- [ ] **355.** Authentication and Google sign-in
- [ ] **356.** Administration section
- [ ] **357.** Module Settings
- [ ] **358.** Initial scaffold: modules, settings, admin section
