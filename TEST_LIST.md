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

## 2026-10-01 — Release (Merge cleanup, Log-only lens, Table Usage, chrome refinements)

No new migrations — nothing here changes a table. The Table Usage tab reads SQLite's
built-in `dbstat` virtual table, not one of ours.

Items 1–3 are the Journal same-date card's new Log-only toggle and the CLI flag. Items
4–6 are the merge-then-offer-to-delete flow — item 5 is the one that matters most for
trust: a save failure or an abandoned draft must never cost any writing, and the
cleanup prompt must only ever name entries the merge actually read. Item 7 is the new
Table Usage tab; it costs a real file walk, so it must not run itself on page load.
Items 8–10 are chrome-only polish with no migration and no new table: the home-screen
drag target, the nav tree's scroll memory, and the music player's transport panel —
item 10 is desktop/phone parity, since the panel has to restack narrow.

- [ ] **1.** Journal → Review Data → "Review multiple entries on same date" card: the
  title-bar "Review only Log entries" toggle narrows the list to dates with two or more
  Log entries; turning it off restores the full list
- [ ] **2.** Journal → Review Data: a date with one Log entry and two written entries
  does not appear under the Log-only toggle (it must not show as "1 of 1")
- [ ] **3.** CLI: `npm run cli -- journal-same-date --log-only` matches what the toggle
  shows on the web screen for the same data
- [ ] **4.** Journal → Review Data: merging several entries and saving now shows a
  follow-up dialog — "Merged entry created successfully. Would you like to delete the
  original N entries?" — with Delete N and Keep them
- [ ] **5.** Journal → Review Data: if one of the ticked entries vanished before the
  merge ran, the cleanup dialog's count and offer reflect only the entries the merge
  actually read, not the original selection; choosing Delete N sends exactly those to
  the recycle bin (undoable from CSV Import → Correct)
- [ ] **6.** CLI: `npm run cli -- journal-same-date --merge 41,42,43 --save
  --delete-originals` creates the merged entry and then recycles the three sources in
  one command; omitting `--save` leaves `--delete-originals` with no effect
- [ ] **7.** Administration → SQL Explorer → Table Usage: pressing Measure lists every
  table ranked by size (table + index bytes), each row showing a proportional bar,
  percent of total, and a real row count; Open jumps to that table in Tables Explorer
- [ ] **8.** Home screen (desktop, two-column layout): a card is now dragged by its
  whole frame rather than a handle row; the up/down keyboard buttons appear only on
  hover or keyboard focus, in the card's top-right corner
- [ ] **9.** Desktop navigation tree: scroll partway down a long module list, click a
  module or section, and the tree opens already scrolled to the same position instead
  of snapping back to the top
- [ ] **10.** Music → player screen: the seek bar, transport, volume and sleep timer now
  sit in one full-width panel below the cover and lyrics; narrow, the panel's three
  clusters stack in reading order, and a track with no cover art shows a spinning vinyl
  placeholder that pauses when playback pauses

## 2026-09-30 — Release (TODO Lists, Chrome Style & Border Weight, Journal review)

**Migration 0123 must be applied** — `tol_todo_categories` and `tol_todo_items`. If
Tools → TODO Lists or the home-screen TODO card 404s or reports "no such table", check
`sys_schema_migrations` before reading anything here as a bug. Migrations 0121 and 0122
are data-only seed rows (`chrome_style`, `border_widths`) — their settings fall back to
the pre-existing look if missing, so they degrade quietly rather than erroring, but
should still be confirmed applied.

Items 11–18 are TODO Lists — item 13 is the one regression check for the shared-list
design (two browsers/accounts must see the same tick land), and item 17 is the delete
guard that must never cascade. Items 19–20 are Chrome Style and Border Weight — both are
desktop-only in effect (item 20's inner-divider axis has nothing to show on a phone,
where the tree doesn't render). Items 21–22 are the Journal Main-tab fix — item 21 is
the one that matters most for trust: a tag or category that is all logged activity must
no longer show a count with nothing behind it. Items 23–28 are the calendar import
review rework; item 23 is its own regression check (an untouched date must never be
written by a batch commit). Items 29–31 are Top Words and the new rank bars. Items 32–33
are small polish.

- [ ] **11.** Tools → TODO Lists: the side panel lists every list with an item count;
  switching lists swaps the grid without a page reload
- [ ] **12.** Tools → TODO Lists: adding an item requires a list and a title; it appears
  immediately at the bottom of that list's outstanding items
- [ ] **13.** Tools → TODO Lists: ticking an item moves it into a "Completed (N)" group
  rather than deleting it, and the same list opened from a second account/browser shows
  the same tick (lists and items are shared, not per-person)
- [ ] **14.** Tools → TODO Lists: the hover ✕ removes a single completed item; "Clear
  all" empties the whole Completed group in one click
- [ ] **15.** Tools → TODO Lists: on a phone, the ✕ and list-delete controls are visible
  without hovering (there is no hover on touch)
- [ ] **16.** Home screen: the TODO card shows the same lists as tabs with a checkbox per
  outstanding item; its title links straight to the Tools screen
- [ ] **17.** Administration → TODO Lists: renaming and reordering a list is immediate;
  deleting a list that still holds items (completed ones included) is refused and names
  the counts in the refusal
- [ ] **18.** CLI: `npm run cli -- todo` lists every list and its outstanding items;
  `--add "…" --list "<name>"`, `--done <id>`, `--delete <id>` and `--new-list "<name>"`
  each work and match what the web screens show afterward
- [ ] **19.** Administration → Display Settings → Chrome Style: picking Inset, Outset or
  Emboss changes the header and the navigation tree's bevel immediately on Save; the
  four preview cards show four visibly different treatments before saving anything
- [ ] **20.** Administration → Display Settings → Border Weight: moving the Chrome
  outline, Inner dividers and Everything else sliders each visibly thickens only their
  own scope (header/tree outer edge; tree's internal rules; every other border app-wide)
  and nothing shifts layout at 1–4px
- [ ] **21.** Journal → a tag or category whose entries are all tagged "Log": clicking
  it from the Statistics card's Main-tab view now shows those entries instead of an
  empty list (previously the count was right and the list was empty)
- [ ] **22.** Journal → Entries browser: the dedicated Log tab still excludes non-Log
  entries as before — only the Main tab's behavior changed
- [ ] **23.** Journal → Preferences → "Review before calendar import" on, then import a
  calendar with more than 10 conflicting dates: the review dialog pages 10 at a time,
  and "Commit reviewed" writes only the dates actually decided on-screen, never an
  un-paged-to date
- [ ] **24.** Journal → calendar import review dialog: a conflicting date's existing
  entry can be quick-edited without closing the dialog, and the row gets an "edited"
  badge afterward
- [ ] **25.** Journal → calendar import review dialog: a locked existing entry's
  quick-edit is disabled rather than offered and then rejected
- [ ] **26.** Journal → calendar import: starting an import shows a progress dialog
  with the event count while it runs, and a result summary (imported/updated/
  skipped/excluded counts, with duration) once it finishes
- [ ] **27.** Journal → calendar import: "Import all" still imports everything except
  dates explicitly declined, matching the pre-existing behavior
- [ ] **28.** Journal → calendar import review dialog: the Instructions card's open/
  closed state does not persist between dialog openings (it is controlled, unlike other
  collapsible cards)
- [ ] **29.** Journal home screen: Top Tags, Top Categories and Top 10 Words each show a
  small proportional bar beside every row, sized against that list's own top entry;
  hidden on a phone
- [ ] **30.** Journal home screen → Top 10 Words: clicking the ✕ beside a word removes
  it from the ranking everywhere, and a word that would otherwise rank in the top 10
  moves up to fill its place
- [ ] **31.** Journal → Preferences → Excluded words: a dismissed word is listed as a
  chip; clicking it restores the word and it can rank again on the home screen
- [ ] **32.** Any screen with a collapsible card (e.g. Journal's Recent Entries):
  collapse one, navigate away and back — it stays collapsed; a card using controlled
  `open`/`onOpenChange` is unaffected
- [ ] **33.** Home screen → My Shortcuts with 1–3 shortcuts on a phone: the tiles fill
  the row as full-width bars instead of leaving a ragged empty grid cell

---

## 2026-09-29 — Release (Household: Recipes, a personal home-screen layout)

**Migrations 0118, 0119 and 0120 must all be applied** — `hsh_recipes` and
`hsh_recipe_tags`, then the Household module's seed row, then `category` on
`hsh_recipes`. If any Household screen 404s or reports "no such column", check
`sys_schema_migrations` before reading anything here as a bug. The home-screen
layout items need no migration — both new preferences are plain
`user_preferences` rows.

Items 11–19 are Household → Recipes. Item 12 is the one regression check — the tab
strip must not silently drop a recipe, so its Uncategorised count has to match
reality. Item 17 is the one that matters most for trust: a picture failure must
never read as "the recipe wasn't saved" when it was. Items 20–25 are the home
screen's personal layout; item 23 is its own regression check, since the two
orderings (household default vs. a reader's drag) must never leak into each
other.

- [ ] **34.** Household → Recipes: the list shows tabs — All, one per category with
  a count, then Uncategorised — instead of a Category dropdown; clicking a
  category tab narrows the grid and updates the URL (`?category=`)
- [ ] **35.** Household → Recipes: the Uncategorised tab's count matches the number
  of recipes with no category set, and narrows the grid to exactly those
- [ ] **36.** Household → Recipes: a bookmarked or refreshed `?category=` URL opens
  on the right tab; Uncategorised does not survive a refresh (falls back to All)
- [ ] **37.** Household → Recipes: the grid shows Name, Description, Tags, Made and
  Rating; Category, Source and the picture are gone from the grid but still
  visible in the record view
- [ ] **38.** Household → Recipes: clicking **View**, or clicking anywhere on a row,
  opens a record view showing every field — including ingredients, directions
  and notes, each inside its own bordered/inset panel
- [ ] **39.** Household → Recipes → Edit: Ingredients and Directions are each a
  full-width row (not side-by-side), Description is a 3-line box, there is no
  Cancel button (the modal's own close and Escape still work), and Save reads
  "Save Recipe"
- [ ] **40.** Household → Recipes → Add: choosing a picture before saving shows a
  preview immediately; saving the new recipe attaches that picture without a
  second trip back into the editor
- [ ] **41.** Household → Recipes: if attaching a picture fails right after a
  successful save, the message says the recipe *was* saved and names the
  picture as the only thing that didn't attach — never reads as if nothing
  happened
- [ ] **42.** Household → Recipes: a picture added through the editor or through
  "Replace picture" in the record view is visibly smaller than the original
  file (check its size via the browser's network tab or file download) —
  existing pictures added before this release are untouched
- [ ] **43.** Home screen (full/desktop layout, ≥1280px wide): a control above the
  cards switches between one and two columns
- [ ] **44.** Home screen: dragging a card by its handle moves it to a new
  position; the new order persists after a refresh
- [ ] **45.** Home screen: with no pointer, the up/down buttons on a card move it
  one place at a time, wrapping neither at the top nor the bottom of the list
- [ ] **46.** Home screen: an admin reordering *Administration → Display Settings
  → Dashboard Widgets* is picked up by a reader who has never dragged a card,
  but does **not** change the arrangement of a reader who has
- [ ] **47.** Home screen: the module carousel always spans both columns and is
  not draggable, regardless of the column count
- [ ] **48.** Home screen on a phone or a narrow window (<1280px): no column
  control appears, and the cards are a single stack exactly as before this
  release

---

## 2026-09-28 — Release (Journal Review Data, module texture picker, app-wide texture)

**Migrations 0116 and 0117 must both be applied** — `app_wide` on
`sys_dashboard_texture`, then `texture_id`/`texture_mode` on `sys_module_texture`. Both
ship inert (item 18 confirms the Music Library still shows its own picture unchanged
after 0117's backfill runs). If any texture screen reports "no such column", check
`sys_schema_migrations` before reading anything here as a bug.

Items 11–17 are the new Journal screen. Item 14 is the one that matters most — a merge
must never be destructive, so the source entries have to still be there after saving
the draft. Items 18–21 are the module texture picker; item 18 is the regression check,
since a wrong backfill would silently swap Music's picture for the app-wide one. Items
22–24 are the app-wide texture scope, and item 22 is its own regression check for the
same reason — this ships off, so an existing install must render unchanged until an
admin ticks it on.

- [ ] **49.** Journal → Data Management → Review Data: the card lists every date carrying more than one entry, each row showing its position ("2 of 4"), time, title and a 100-word excerpt — including untitled entries, which the Correct tab beside it leaves out
- [ ] **50.** Journal → Review Data: clicking a row opens the full entry, with an Edit button that opens the same form the single-entry screen uses; closing it returns to the list with page, sort and ticks intact
- [ ] **51.** Journal → Review Data: Edit is disabled on a locked entry, the same as it is from `/entries/[id]`
- [ ] **52.** Journal → Review Data: ticking several entries and choosing Merge drafts one new entry (earliest date/time, titles joined with `/`, each source's content under a `— HH:MM · Title` line, categories and tags combined) and opens it in the ordinary entry form — saving creates the new entry and leaves every source entry exactly where it was
- [ ] **53.** Journal → Review Data: locations and weather are not carried into a merged draft, and the form still lets you add them
- [ ] **54.** Journal → Review Data: ticking several entries and choosing Delete asks first, then moves them to the recycle bin (restorable from the Correct tab)
- [ ] **55.** CLI: `npm run cli -- journal-same-date`, `--merge 41,42,43` (prints only), `--merge ... --save` (creates), and `--delete 41,42` all behave as documented
- [ ] **56.** Administration → Configuration → Module Configuration: the Music Library's background texture control shows "Its own uploaded picture" already selected, and the module's screens still show the same picture as before this release
- [ ] **57.** Administration → Configuration → Module Configuration: a module with no picture of its own can pick "Pick one from the library" and choose a thumbnail from the App Texture library; that module's screens then show it with that picture's own opacity/blur
- [ ] **58.** Administration → Configuration → Module Configuration: a module set to "None — plain paper" stays flat even when an app-wide texture is on
- [ ] **59.** Administration → Configuration → App Texture: deleting a library picture that a module was pointed at drops that module back to the app background rather than breaking its screen
- [ ] **60.** Administration → Configuration → App Texture: on an install that has not touched the new "Show on every screen" tick box, the background still appears only on the home dashboard, exactly as before this release
- [ ] **61.** Administration → Configuration → App Texture: ticking "Show on every screen" puts the selected picture behind every module, Administration and the account screen, all sharing one background
- [ ] **62.** Administration → Configuration → App Texture: with the app-wide texture on, a module that still has its own uploaded picture (Music) keeps showing its own picture instead of the app-wide one

---

## 2026-09-27 — Release (My Shortcuts, uploaded icons)

**Migrations 0114 and 0115 must both be applied** — `sys_user_shortcuts` and then
its two icon-upload columns. 0115 exists because 0114 had already run on the NAS
when the columns were needed; an earlier attempt folded them into 0114, which the
runner skipped, and every home screen died on `no such column: icon_image`. If
items 25–33 report a missing table or column, check `sys_schema_migrations` before
reading anything here as a bug.

Items 25–33 are the new card. **Item 30 is the one that matters most** — it is the
privacy boundary, and it needs two accounts: shortcuts and their uploaded pictures
are per-person, unlike every other image in this app. Item 28 needs a second
account too, or a module grant revoked, to see a shortcut go unavailable rather
than vanish.

Item 34 is desktop-only (there is no hover on a phone); item 35 is its phone
counterpart, where the tile controls are always visible instead.

- [ ] **63.** Home: the My Shortcuts card appears, and Admin → Display Settings → Dashboard Widgets can hide and reorder it like any other card
- [ ] **64.** Add a shortcut to a web address — a bare `example.com` gets `https://` added, and the tile opens it in a new tab
- [ ] **65.** Add a shortcut to a page in this app: pick a module, then a section — and separately, a module's own main page
- [ ] **66.** A shortcut into a module you can no longer open draws greyed out with a reason, rather than disappearing
- [ ] **67.** Upload a picture as a shortcut's icon; removing it falls back to the glyph underneath rather than leaving the tile blank
- [ ] **68.** Two accounts: each sees only their own shortcuts, and one cannot fetch the other's uploaded icon by its URL
- [ ] **69.** Edit, reorder and remove a shortcut from the card itself; renaming one keeps its uploaded picture
- [ ] **70.** The twelfth shortcut is the last — Add is refused with a message rather than failing silently
- [ ] **71.** An oversized picture (over 256 KB) is refused immediately with the app's own wording, not a server error
- [ ] **72.** Desktop: shortcut tiles read as 3D buttons — they lift on hover and press down on click, and the row controls appear on hover
- [ ] **73.** Phone: the tiles reflow to the width available and their edit controls are visible without hovering
- [ ] **74.** Navigation: a section group whose heading has its own page draws as a link with its glyph; headings without one stay plain labels
- [ ] **75.** Music: reorder a playlist entry up and down — a playlist holding the same track twice moves the two copies independently
- [ ] **76.** Administration → About loads and shows its disk figures (this screen previously failed to build)

---

## 2026-09-25 — Release (navigation tree)

**No migration.** The remembered expanded set is a new key in the existing
`sys_user_preferences` table, so nothing schema-level shipped here.

**This release replaces the navigation on every desktop screen in the app**, so
item 39 is the one that matters: if `NavTree` fails to render, every page behind
the login goes with it. Check that first and the rest afterwards.

Items 39–44 are desktop-only by design. Item 45 is the counterpart and is
arguably the more important check of the two — the phone was deliberately left
alone, so the test is that nothing about it *changed*. Item 46 needs two devices,
or one device and a logout, to prove the preference is stored per person rather
than in that browser.

- [ ] **77.** Every module and Admin: the left column is one tree — Home on top, each module a heading that expands to its sections
- [ ] **78.** The tree: clicking a module heading expands and collapses it; the module you are currently in is always open
- [ ] **79.** Filter: typing `import` finds Journal, Investments and Expense sections together, each labelled with its module
- [ ] **80.** Filter: matches starting with what you typed rank first; Esc clears; clearing restores the collapse state you had
- [ ] **81.** Collapse: `«` folds the tree to a thin strip and the content widens; the strip and the header's `»` both reopen it
- [ ] **82.** Icons: Admin → Display Settings → Icons can replace the tree's Home and filter glyphs, and each module's section icons still resolve
- [ ] **83.** Phone: the bottom bar and its sheet behave exactly as before — no tree, no strip, nothing new
- [ ] **84.** The set of expanded modules survives a reload, and is remembered per user rather than per browser

---

## 2026-09-25 — Release

Migration 0112 (`sys_saved_sql_queries`) was applied on the NAS during this
release's publish. If items 47–49 ever report "no such table", that is the thing to
re-check before reading anything else here as a bug.

Item 50 costs live provider calls on every expand, so it can only really be judged
during market hours; item 52 needs a file whose tags actually carry lyrics, which
not every track in the library has. Item 54 is phone-relevant — the expanded index
panel adds six figures and a sparkline to a row that was already tight.

- [ ] **85.** Admin → SQL Explorer → SQL Query: save a statement with a name, description and tags; it appears on the Saved SQL card
- [ ] **86.** Admin → SQL Explorer: Load fills the editor and does **not** execute — confirm with a statement you would not want run
- [ ] **87.** Admin → SQL Explorer: saving under an existing name replaces that row, and the dialog warns before it does
- [ ] **88.** Investments → Indexes card: a row expands to show day range, 52-week range with its marker, moving averages, one-year change, all-time high and a sparkline
- [ ] **89.** Investments → Indexes card: a symbol whose second pass fails keeps its row and shows em-dashes (the three commodity futures have no one-year change)
- [ ] **90.** Music: a track with embedded lyrics shows them attributed "From this file's own tags", without a network lookup
- [ ] **91.** Music: a track with no embedded and no lrclib match offers the Google search link
- [ ] **92.** Investments → Indexes card: the expanded panel and sparkline are readable on a phone
- [ ] **93.** Admin → Daily Quote → All Quotes: the new nav entry opens the listing screen
- [ ] **94.** CLI: `saved-sql list` / `show` / `save` / `delete` behave as documented

---

## 2026-09-24 — Release

No new migrations: 0109–0111 shipped with the previous release and are already
applied on the NAS. Item 59 is the one to watch — the dedup rule changed, so a
scan that used to return nothing may now return groups, and blank-named places
can group on distance alone. Items 61 and 60 are phone-relevant: the popup and the
picker's refusal message both have to be readable narrow.

- [ ] **95.** Admin → Message Queue: the screen lists read and unread together, newest first, with each message's source
- [ ] **96.** Admin → Message Queue: tick rows and Delete removes them; Purge by age (7/30/90/365 days) clears everything older and keeps the rest
- [ ] **97.** Journal → Merging & Dedup: the "Within" slider (10–500m, default 75m) rescans on release, and groups found by distance are labelled "proximity"
- [ ] **98.** Journal → Merging & Dedup: two pins ~25–50m apart with similar names now group (they did not before); merging one still works
- [ ] **99.** Journal → entry form: adding a location already on the entry is refused with a message, and the draft pin stays put — from both the map tab and the library tab
- [ ] **100.** Journal: clicking a numbered map pin opens a popup with number, name, address, coordinates and chips, readable in the dark theme
- [ ] **101.** Journal: a single entry page shows the module rail, section panel and header (no more bare page with a "Back to My Journal" link)

---

## 2026-09-23 — Release

Migrations 0106, 0107 and 0108 are applied on the NAS. The Investments rename
touched ~83 files and renamed 17 tables, so the items below are worth a walk
through even where the screen looks unchanged — a missed server action throws
only when that one feature is used, not when the page loads.

- [ ] **102.** Investments: the module opens at /modules/investments, named Investments on the rail and home grid
- [ ] **103.** Investments: every section loads — Dashboard, Positions, Transactions, Account Performance, Watch & Test, Chart & Analysis, CSV Import, Tax Lots, Export for AI Analysis, Settings
- [ ] **104.** Investments: the actions still write — add/edit a position, a transaction, a watchlist entry, an account
- [ ] **105.** Investments: Tax Lots deep links still resolve (ticker picker, and the links out of the positions grid)
- [ ] **106.** Investments: CSV import of a broker file
- [ ] **107.** Admin → SQL Explorer: the Investments group lists the inv_ tables, and Table References names them
- [ ] **108.** Admin → Background Tasks: the Investments auto-refresh still finds its module
- [ ] **109.** Home: the Daily Glance card renders and its "Launch Investments" link goes to the new URL
- [ ] **110.** Investments: uploaded section/card icons survived the rename (slot ids were deliberately left on `stock_*`)
- [x] **111.** Expense: Transaction Rule Types — group rules by type, filter the rules list, manage types in Meta Data  — tested 2026-09-23
- [x] **112.** Security → Visits: why a visit was scored suspicious (signals on the row)

---

## 2026-09-22 — Release

- [x] **113.** CSV Analysis: pooled datasets
- [x] **114.** Admin-set preferences (allow edit user's preferences)
- [x] **115.** Location icons

## 2026-09-20

- [x] **116.** Journal: filter the category and tag lists in Meta Data
- [x] **117.** Journal: a saved-location library
- [x] **118.** Journal: Entries as one screen with two tabs
- [x] **119.** Tools: a CSV file browser beside the SQLite one

## 2026-09-19

- [x] **120.** Journal: keep or file a photo from an entry
- [x] **121.** TreeNav: each group reads as its own embossed card
- [x] **122.** Tools: SQLite uploads over 4 MB, with an admin-set cap
- [ ] **123.** Stocks: icons on the indexes board
- [ ] **124.** Stocks: playback of portfolio history
- [ ] **125.** Music: a sleep timer that stops the player after a set time

## 2026-09-17

- [ ] **126.** Home screen: launch a card's module from its title
- [ ] **127.** Journal: review existing entries before importing from a calendar
- [ ] **128.** Tools: a new module, opening with a SQLite file browser

## 2026-09-15

- [ ] **129.** Floating layer: a clock over every page
- [ ] **130.** Floating layer: a calculator over every page
- [ ] **131.** Floating layer: a scratchpad over every page
- [ ] **132.** Stocks: the indexes board loads when you open the card
- [ ] **133.** Admin: clear deployment records in bulk, or prune to the newest few
- [ ] **134.** Journal: jump to the next day that has an entry
- [ ] **135.** NAS: a startup crash that says what broke

## 2026-09-14

- [ ] **136.** Journal: date the template suggestion by the local calendar
- [ ] **137.** Themes: tell the browser a dark theme is dark
- [ ] **138.** Export for AI: measured correlations, and the sectors you hold nothing in
- [ ] **139.** Home: a Clock card, with the weather where you are
- [ ] **140.** Picture Gallery: Magic List — photographs conjured from a description
- [ ] **141.** Stocks: candlesticks in the ticker viewer's Today card
- [ ] **142.** Stocks: consult AI about one ticker
- [ ] **143.** Stocks: a transaction knows which account it belongs to

## 2026-09-13

- [ ] **144.** Attendance: bigger cards in the register grid
- [ ] **145.** Admin: random theme generation
- [ ] **146.** Music Library: an Albums view
- [ ] **147.** Stocks & ETFs: a recorded trade can update the holding
- [ ] **148.** MyJournal: New Entry becomes a section
- [ ] **149.** Games: Bridge
- [ ] **150.** SQL Explorer: BLOB cells fetched on demand
- [ ] **151.** SQL Explorer: tables grouped by module
- [ ] **152.** Account: two compact navigation styles, and the reader picks
- [ ] **153.** Icon names: the compiler catches glyph-table drift

## 2026-09-11

- [ ] **154.** Journal: Calendar Import — read a Google/Outlook .ics and pick events to import
- [ ] **155.** Journal: re-importing a renamed or moved event updates it instead of duplicating
- [ ] **156.** Journal: a large .ics (2.4 MB) uploads without tripping the action-argument limit
- [ ] **157.** Journal: restoring an imported entry from the recycle bin keeps its identity
- [ ] **158.** Stocks: a portfolio brief for an LLM
- [ ] **159.** Attendance: one register per class per day again
- [ ] **160.** Attendance: session labels read in local time, not four hours ahead

## 2026-09-10

- [ ] **161.** Picture Gallery: albums
- [ ] **162.** Picture Gallery: a + on every photograph
- [ ] **163.** Home screen: a handwritten quote, no header, and a slimmer rail

## 2026-09-09

- [ ] **164.** Security: every exported server action authorises on its first line
- [ ] **165.** Stocks & ETFs: analyze several tickers at once, and link to an analysis
- [ ] **166.** Music Library: the song on YouTube
- [ ] **167.** Music Library: a real fullscreen visualizer
- [ ] **168.** Picture Gallery: a module of its own, not a corner of the home screen

## 2026-09-08

- [ ] **169.** Games: Mahjong pickers and board frame
- [ ] **170.** Stocks & ETFs: today's session in the ticker viewer
- [ ] **171.** Journal: a space-separated Tags column no longer imports as one long tag
- [ ] **172.** CSV Analytics: bulk edit rows
- [ ] **173.** CSV Analytics: a CLI for bulk edit
- [ ] **174.** Photographs: one viewer, with a capture timestamp and a heart

## 2026-09-06 — Release

- [ ] **175.** Games: Mahjong, the four-player game against three bots
- [ ] **176.** Stocks & ETFs: the Tax Lot Portfolio Analyzer
- [ ] **177.** About: count untagged changes instead of reporting zero
- [ ] **178.** Home: the Random Photo card streams instead of blocking first paint
- [ ] **179.** Photos: an absolute path can no longer escape the photo folder
- [ ] **180.** Compact grids: long values are readable
- [ ] **181.** Compact grids: a second layout for reading
- [ ] **182.** Music: the story behind the song, beside the lyrics
- [ ] **183.** Games: Mahjong Match
- [ ] **184.** Games: card icons across the whole arcade
- [ ] **185.** Attendance: upload your own icon for a student action
- [ ] **186.** CSV Analysis: named views over a dataset

## 2026-09-03

- [ ] **187.** Attendance: a class records the weekday it meets on
- [ ] **188.** Attendance: the home screen opens on today's register
- [ ] **189.** Photos: a viewer component with its own actions
- [ ] **190.** Journal: a photos slideshow and folder module
- [ ] **191.** Games: sudoku and blackjack polish
- [ ] **192.** Stocks: the refresh total counts up as prices land

## 2026-09-02 — Release

- [ ] **193.** Expense: top-5 cards link through to their transactions
- [ ] **194.** Expense: the vendor rollup stops inventing vendors from payment lines
- [ ] **195.** Stocks: the indexes refresh becomes an icon
- [ ] **196.** Favourite photos: a slideshow
- [ ] **197.** Carousel graphics are resized on upload
- [ ] **198.** SQL Explorer: a schema browser
- [ ] **199.** SQL Explorer: prose for every table
- [ ] **200.** Music: a spectrum analyser under the cover art
- [ ] **201.** Games: Sudoku
- [ ] **202.** Games: Blackjack
- [ ] **203.** Games: Minesweeper
- [ ] **204.** Journal: a recycle bin
- [ ] **205.** Journal: a Correct tab
- [ ] **206.** Journal: metadata backup

## 2026-09-01 — Release

- [ ] **207.** Journal import: an overwrite mode, with the plan shown before it writes
- [ ] **208.** Favourite photos: their own screen
- [ ] **209.** Favourite photos: a zip download
- [ ] **210.** Admin: a deployment history, with the build log attached
- [ ] **211.** Games: Tetris
- [ ] **212.** Games: Arrow Clearing becomes an actual puzzle
- [ ] **213.** SQL Explorer: a Truncate button, behind a warning that counts the rows
- [ ] **214.** Journal import: normalized entry time stops a re-import duplicating

## 2026-08-30

- [ ] **215.** Themes: colour themes are data, and the builder warns before you blind yourself
- [ ] **216.** Games: Arrow Clearing cannot generate an unsolvable board
- [ ] **217.** Games: an arcade, and a scoreboard the whole house shares

## 2026-08-29

- [ ] **218.** Stocks: five threads on refresh
- [ ] **219.** Stocks: a wildcard that was lying to you
- [ ] **220.** Home: the random photo card says how old the photo is
- [ ] **221.** Stocks: Watch & Test — watch lists, signals and simulation on one screen
- [ ] **222.** Expense: re-run a rule over transactions you have already imported
- [ ] **223.** Expense: a vendor is somebody now, not just a total

## 2026-08-28

- [ ] **224.** Home screen: arrange it yourself
- [ ] **225.** CSV Analysis: the two-tier nav
- [ ] **226.** Home: a photograph drawn at random
- [ ] **227.** Uploaded icons get cleaned up on the way in
- [ ] **228.** Icons: any single icon can be replaced without changing the icon set (73 slots)
- [ ] **229.** Admin → Configuration → Icons: upload an SVG or image per position
- [ ] **230.** Icons: uploaded SVG is sanitized on write
- [ ] **231.** Home: a picture behind the day
- [ ] **232.** Expense: rules that say why

## 2026-08-26

- [ ] **233.** Admin → Background Tasks: every timer in one place, including jobs that never ran
- [ ] **234.** A job killed mid-pass reads as interrupted, never as ok
- [ ] **235.** CLI: list-scheduled-jobs gives the same answer without the web server
- [ ] **236.** Last-run stamps survive the restarts a deploy performs
- [ ] **237.** Stocks: an Indexes card of eleven benchmarks in four groups
- [ ] **238.** Stocks: a new dashboard widget lands beside its neighbour, not at the bottom
- [ ] **239.** Stocks → Simulation: "what if I'd bought then?" across ten windows

## 2026-08-25

- [ ] **240.** Music: a scan that finishes (no OOM on a large NAS folder)
- [ ] **241.** Music: an abandoned scan run closes itself instead of reading "running" forever
- [ ] **242.** Progress3D: one progress bar across the app
- [ ] **243.** Per-module background pictures
- [ ] **244.** Attendance: a Detail report — the whole term as a grid
- [ ] **245.** About: a Server Log tab

## 2026-08-19

- [ ] **246.** Stocks: find a ticker, and star the ones you watch daily
- [ ] **247.** Music Library: Magic Playlists assembled from a query
- [ ] **248.** Music Library: a visible play queue
- [ ] **249.** Music Library: lyrics on demand
- [ ] **250.** Grids that count their own columns
- [ ] **251.** Seven more glyphs
- [ ] **252.** Ticker detail: how far a trade has moved since you made it
- [ ] **253.** Music Library: stream 20,000 songs off the NAS
- [ ] **254.** Attendance: two registers a day
- [ ] **255.** Attendance: student actions, a teacher-editable catalog
- [ ] **256.** Attendance: 12 icon sets, applied to the section nav too

## 2026-08-16

- [ ] **257.** Attendance: a new module — pick a class, tap who is here, save
- [ ] **258.** Attendance: a student can sit in several classes
- [ ] **259.** "Absent" and "attendance was never taken" stay distinguishable
- [ ] **260.** Admin → Security: a sign-in audit log recording logins, failures and logouts
- [ ] **261.** Stocks: allocation by sector
- [ ] **262.** Stocks: candlestick charts
- [ ] **263.** Admin: import daily quotes from a newsletter

## 2026-08-15

- [ ] **264.** Journal: clickable taxonomy
- [ ] **265.** About page: inline markdown in the change log
- [ ] **266.** About page: memory as meters
- [ ] **267.** Home: Daily Glance moves off the Stocks dashboard
- [ ] **268.** Installable PWA: stable identity, module shortcuts, iOS launch screens
- [ ] **269.** Per-user preferences: a favourite module you can open on startup

## 2026-08-14

- [ ] **270.** Journal: a filtered Entries browser with saved AND/OR filters
- [ ] **271.** Journal: icons for categories and tags
- [ ] **272.** Deploys apply their own migrations, and fail loudly rather than serving new code
- [ ] **273.** CSV Analytics: add columns without re-importing a file
- [ ] **274.** ModuleCarousel: a grid on desktop, coverflow on phones
- [ ] **275.** DataGrid: column headers popped up into a 3D bar
- [ ] **276.** Journal: home-screen search
- [ ] **277.** The section bar moved to the bottom, and modules collapsed into a menu

## 2026-08-11

- [ ] **278.** CSV Analytics: add custom columns during append/truncate

## 2026-08-10

- [ ] **279.** The section tree became a bar, and surfaces learned to lift

## 2026-08-08

- [ ] **280.** The compact section bar
- [ ] **281.** User management gated on admin
- [ ] **282.** Home: announce a new deployment
- [ ] **283.** Navigation moved to the edges — a top bar plus a compact bottom module bar
- [ ] **284.** Both nav bars minimise to a puck and remember it
- [ ] **285.** Every chart got a gear

## 2026-08-07

- [ ] **286.** Restart the NAS after a publish without SSH
- [ ] **287.** The app works on a phone — one layout boundary at 1024px, decided server-side
- [ ] **288.** Installable to the home screen
- [ ] **289.** Stocks: ticker viewer as cards, with Events and Yahoo Detail tabs
- [ ] **290.** Stocks: risk cached and served at any age, refreshed only by Recalculate
- [ ] **291.** Stocks: earnings data no longer vanishes (Yahoo User-Agent and crumb race)
- [ ] **292.** Home: the module grid becomes a carousel with per-module artwork
- [ ] **293.** Image uploads send a File in FormData rather than base64

## 2026-08-05

- [ ] **294.** Stocks: positions split into Stocks / ETF / Others
- [ ] **295.** Stocks: Daily Glance — one table for the three buckets, with the total
- [ ] **296.** Stocks: Account Performance Over Time on one set of axes
- [ ] **297.** Stocks: remember which account a broker's CSV label means
- [ ] **298.** Hide the sidebar to its accent strip, and give the page back the gutter
- [ ] **299.** Stocks: performance chart points shaped by what they are
- [ ] **300.** Stocks: ticker viewer — everything about one symbol in one dialog
- [ ] **301.** Stocks: choose which dashboard widgets show, and in what order
- [ ] **302.** Stocks: record the brokerage firm on a trade, and fix duplicate detection
- [ ] **303.** Stocks: cost basis, so total return is possible at all
- [ ] **304.** Stocks: daily snapshots, value and gain/loss per bucket
- [ ] **305.** Stocks: an icon per investment account
- [ ] **306.** Stocks: eight routed sections behind a TreeNav, loading per section
- [ ] **307.** Stocks: Refresh All with per-ticker progress
- [ ] **308.** Stocks: a per-ticker news lookup
- [ ] **309.** CSV import: one screen for all three types, listing every row
- [ ] **310.** A verification gate: typecheck, boundary, tests, migration dry-run, e2e

## 2026-08-03

- [ ] **311.** Full-width layout: one shared container across every full-page screen
- [ ] **312.** A fixed sidebar raised above the page, so a module gets the rest of the screen
- [ ] **313.** Expense: spend stats
- [ ] **314.** Expense: an auto-import switch
- [ ] **315.** Expense: an uploadable icon per category
- [ ] **316.** Stocks: cache and show ticker logos
- [ ] **317.** DataGrid: filter expressions
- [ ] **318.** DataGrid: column aggregates
- [ ] **319.** DataGrid: record view
- [ ] **320.** Modal extracted as its own component
- [ ] **321.** Three colour themes and three icon sets

## 2026-08-02

- [ ] **322.** Expense: automatic CSV import from a watched folder, one sub-folder per card
- [ ] **323.** Expense: a processed file is renamed .backup, a failure .failed
- [ ] **324.** Expense: post-import rules — one condition, any number of field assignments
- [ ] **325.** Expense: "Manually Run Import Clean up" with real progress
- [ ] **326.** Expense: the tree-nav overhaul
- [ ] **327.** Expense: a new module for credit-card spending
- [ ] **328.** Expense: fuzzy auto-categorisation by glob against the statement description
- [ ] **329.** Expense: CSV import with a saved column mapping per card company
- [ ] **330.** Admin: import daily quotes from a newsletter

## 2026-07-30

- [ ] **331.** Result grid: search, filters, sticky header, column control, row selection
- [ ] **332.** Journal: entry authoring with category/tag autocomplete
- [ ] **333.** Journal: a Leaflet location picker with search and multiple pins
- [ ] **334.** Journal: fetch today's weather
- [ ] **335.** Journal: the entry screen, with Print/Save-PDF, Edit, Lock and Delete
- [ ] **336.** Journal: Today In History

## 2026-07-27

- [ ] **337.** Journal: a new module, with CSV import of a real export
- [ ] **338.** Real Estate and Property Watch removed
- [ ] **339.** Every table renamed to a 3-letter module prefix
- [ ] **340.** Daily Quote

## 2026-07-25

- [ ] **341.** Self-signup, always as a plain user with no module access
- [ ] **342.** Admin elevation behind a secret that stays hidden until you type "adm"
- [ ] **343.** User-selectable module icon sets
- [ ] **344.** Daybreak, the first light theme

## 2026-07-21

- [ ] **345.** Interactive DataGrid: click-to-sort, paging, Export CSV, Show SQL
- [ ] **346.** CSV Analysis: Show Data and Chart per entry
- [ ] **347.** CSV chart builder with presets
- [ ] **348.** ChartXY: line/bar/scatter/area with zoom

## 2026-07-19

- [ ] **349.** CSV Analytics: a new module
- [ ] **350.** Theme and UI polish
- [ ] **351.** ARM/Synology NAS deployment support

## 2026-07-18

- [ ] **352.** Stocks & ETFs: accounts, positions, transactions and portfolio summary
- [ ] **353.** Stocks & ETFs: a Yahoo Finance market-data client with manual/CLI refresh
- [ ] **354.** Stocks & ETFs: volatility, correlation and Sharpe analytics
- [ ] **355.** Stocks & ETFs: a Next Day Actions signal scanner
- [ ] **356.** Stocks & ETFs: CSV import with saved column-mapping presets
- [ ] **357.** Admin: SQL Explorer
- [ ] **358.** ChartLine, ChartBar and Tabs components
- [ ] **359.** Publish applies pending migrations, with an automatic backup
- [ ] **360.** ~~Real Estate: property portfolio and a RentCast watch list~~ *(removed 2026-07-27, migration 0026)*

## 2026-07-13

- [ ] **361.** Google auto-registration
- [ ] **362.** User avatars
- [ ] **363.** start.bat port cleanup

## 2026-07-12

- [ ] **364.** User management
- [ ] **365.** Authentication and Google sign-in
- [ ] **366.** Administration section
- [ ] **367.** Module Settings
- [ ] **368.** Initial scaffold: modules, settings, admin section
