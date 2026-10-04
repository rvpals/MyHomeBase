# Testing List

This file combines two resources: a guide on *how* to test (the methodology), and the *what* to test (the feature checklist for each release).

---

## How to test — Manual UI Testing Checklist

Manual testing checklist for verifying UI changes work correctly on desktop and mobile.

### Ground rules

- **Test on both desktop and mobile.** The viewport boundary is 1024px. Open DevTools
  (`F12`), toggle device emulation (`Ctrl+Shift+M`), and test at the widths where
  changes apply: narrow screens (mobile), wide screens (desktop). Max-lg variants should
  work on phones; desktop classes should not affect them.
- **Before testing, clear the dev cache.** Run `npm run clean:next` to avoid stale pages.
- **The dev server runs on port 3000.** Start it with `npm run dev`, then open
  `http://localhost:3000` in your browser.
- **Signing in during dev:** credentials are in `.env.local` (or ask). The smoke test uses
  `verify-smoke-user`. You can also create an account via `/login/register`.
- **Test the golden path first**, then edge cases. Changes that break things often break
  the happy path; if that works, the rest usually does too.
- **Name the screens you tested.** Don't just say "the UI works" — say which pages and
  features you actually opened and used. Undocumented screens are unverified screens.

### 1. Start the dev server

```
npm run dev
```

It takes ~10 seconds to boot. When you see `▲ Ready in`, open `http://localhost:3000` in
your browser.

### 2. Pick a viewport and test the change

Open DevTools (`F12`). If your change touches layout (width, padding, positioning,
responsive breakpoints):

- **Test narrow (mobile).** Toggle device emulation (`Ctrl+Shift+M`), set width to 360px
  or smaller, and use the feature. Check that:
  - Text wraps naturally (no overflow)
  - Buttons and form fields are large enough to tap
  - Navigation or floating elements don't cover content
  - The layout doesn't break into columns unexpectedly
- **Test wide (desktop).** Close device emulation (`Ctrl+Shift+M` again) and use the
  feature at full width (or constrain to ~1440px to match typical desktop). Check that:
  - Layout uses available space sensibly
  - Responsive breakpoints (e.g., max-lg:, lg:) behave as intended
  - The change didn't accidentally affect unrelated screens

If your change is logic-only (no layout), test on desktop.

### 3. Test the golden path

The happy path is the normal, expected use of the feature. Examples:

- **Creating a record:** open the form, fill in required fields, submit, see the new row
  in the list.
- **Deleting a record:** click delete, confirm, see it disappear.
- **Editing a record:** click edit, change a field, save, see the change reflected.
- **Navigating:** click a link, see the new page load, click back, see you returned.

Go through these steps slowly. Watch for:

- **Errors in the console.** DevTools Console tab should be silent (no red errors).
- **Visual glitches.** Misaligned text, overlapping elements, buttons that don't look
  clickable, icons that don't render.
- **Stale data.** After an edit or delete, did the UI update immediately, or is it
  showing outdated state?
- **Broken links or buttons.** Click things and confirm they do what you expect.

### 4. Test edge cases

Once the golden path works, try:

- **Empty states.** What does the screen look like when there are no records? Is there
  an empty-state message?
- **Long content.** Long names, long descriptions, long lists. Do they overflow, wrap
  gracefully, or truncate?
- **Rapid interactions.** Click a button twice fast. Submit a form twice. Does it double-submit
  or properly debounce?
- **Different data.** If the feature works with different kinds of records, test a few
  variants.
- **Undo/redo or navigating away.** If the feature has state, does navigating to another
  page and back preserve or reset it?

### 5. Check for regressions

Before closing:

- **Visit the home page** and confirm nothing is visibly broken.
- **Click through the main navigation** (tree on desktop, bottom bar on mobile) and
  spot-check a few other modules to make sure the change didn't break unrelated screens.
- **Reload the page** (`Ctrl+R` or `Cmd+R`) and confirm state is restored correctly.

### 6. Report

State which screens you tested, how you tested them (desktop, mobile, or both), and what
you found. Example:

> Tested on desktop and mobile (360px). Created a new household recipe, edited the name,
> and deleted it. Golden path works. No console errors. Tested with a long recipe name —
> it wraps correctly on mobile. Navigation still works. ✓

If you found an issue, name the screen, the viewport width, the exact steps to reproduce,
and what went wrong.

**Don't test alone.** If Min asks you to test something, he owns verifying it works in the
production instance on the NAS. Your job is to catch obvious breakage and regressions in
the dev server — not to sign off on a release.

---

## What to test — Features by Release

Everything built in MyHomeBase, newest first, so the things most likely to need
a look are at the top.

**Why this file exists.** Uncommitted work in the tree carries no proof anyone
ever saw it on screen, and across sessions there is no memory of what was
checked (`CLAUDE.md` → *Report done honestly*). A commit records that something
was *written*; this file records that it was *tried*.

### How to mark an item

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

## 2026-10-04 — Release (HSA Tracker, Foreign Currencies, Journal lock marker)

**Migrations 0128 and 0129 must be applied on the NAS first** — without them every HSA
screen fails with "no such table"/"no such column". **The receipt folder must be set in
Household → Configuration before any receipt can be attached**; attaching is refused
until it is, so test that refusal before setting it. Configuration is admin-only — check
it with a non-admin too. The Take photo button and the browser-side photo resize are
**phone-only** paths. Foreign Currencies calls an external provider eleven times, so it
needs network and may be slow.

- [ ] **1.** Household → HSA Tracker → Receipts: the section replaces the old placeholder screen
- [ ] **2.** HSA: a new expense with date, time, amount, product/service, type and payee saves and appears in the grid
- [ ] **3.** HSA: Date and Time default to now when the dialog opens, and a past date can be entered instead
- [ ] **4.** HSA: Product or Service offers what you have entered before, and still accepts a new value typed in
- [ ] **5.** HSA: a zero amount, a negative, or a third decimal is refused rather than silently rounded
- [ ] **6.** HSA: the view switch cuts the grid All / By year; latest year first, one year open at a time
- [ ] **7.** HSA: a year header shows its count, receipts held, what is still unreimbursed, and the year's total
- [ ] **8.** HSA: clicking a row opens the record viewer (not the generic modal), with the receipt in its own block
- [ ] **9.** HSA: marking an expense reimbursed and un-reimbursing it both stick
- [ ] **10.** HSA: the grid's Receipt column shows Open or a dash, and sorts/exports as Yes/No
- [ ] **11.** HSA: deleting an expense warns that its receipt file goes too, then removes both
- [ ] **12.** Household → Configuration: the section exists at module level and is admin-only — a non-admin gets a not-found, not a hidden row
- [ ] **13.** Configuration: the server-side folder browser walks folders one level at a time
- [ ] **14.** Configuration: saving a folder the server cannot write to is refused with a reason, not saved
- [ ] **15.** Configuration: Cards — adding, hiding and deleting a card all work; a hidden card stops being offered
- [ ] **16.** HSA: an expense whose card was later renamed or deleted still shows its original Paid with value
- [ ] **17.** HSA: with no receipt folder set, attaching a receipt is refused and the expense still saves
- [ ] **18.** HSA: an attached receipt is filed on the NAS under `<folder>/<year>/<date>_<payee>_<amount>_<id>.<ext>`
- [ ] **19.** HSA: editing an expense's Date, Payee or Amount renames the receipt file on disk
- [ ] **20.** HSA: changing an expense's year moves its receipt into that year's folder
- [ ] **21.** HSA: removing a receipt from an expense deletes the file after warning
- [ ] **22.** HSA: clicking the stored path in the viewer opens the file; a PDF opens as a PDF
- [ ] **23.** HSA (phone): Take photo opens the rear camera directly; it is hidden on a desktop
- [ ] **24.** HSA (phone): Attach receipt offers the photo library and Files, and accepts a PDF
- [ ] **25.** HSA (phone): a large camera photo uploads successfully and stays legible down to the line items
- [ ] **26.** Investments → Dashboard: the Foreign Currencies card lists eleven currencies with flag, name, rate and today's move
- [ ] **27.** Foreign Currencies: nothing is fetched until the card is expanded; Refresh refetches
- [ ] **28.** Foreign Currencies: reopening the card within a minute reuses the board instead of refetching
- [ ] **29.** Foreign Currencies: rates show their real precision (four decimals where the pair needs it), not rounded to cents
- [ ] **30.** Foreign Currencies: the flags render as drawn shapes on Windows, not as letter pairs
- [ ] **31.** Journal → Review: the locked marker is a padlock on the entry's title, not in the Time column
- [ ] **32.** Journal → Correct: the locked marker is a padlock beside the group, not in the Time column
- [ ] **33.** Journal: editing a locked entry still leaves it locked afterwards
- [ ] **34.** Home screen: the up/down move buttons are gone from draggable cards; dragging the frame still reorders
- [ ] **35.** Configuration → Icons → Icon Positions: `stock_card_currencies` and `household_section_configuration` can be given an uploaded icon
- [ ] **36.** CLI: `npm run cli -- hsa` lists expenses; `--add`, `--reimburse`, `--delete` and the card flags all work
- [ ] **37.** CLI: `npm run cli -- hsa --set-receipt-root` sets the folder and `--receipt-root` prints it
- [ ] **38.** Admin → SQL Explorer → Table references: `hsh_hsa_expenses` and `hsh_hsa_cards` appear under Household, not Unclassified

## 2026-10-02 (late) — Release (Biggest Changes, Volatility, tabbed Icons, draggable toolbars)

No migrations. New icon slots appear only in Icon Positions. Biggest Changes calls the
market-data provider once per held ticker, so it needs network and may be slow. Drag
reorder is desktop-only to try; check the Indexes two-column layout on both widths.

- [ ] **39.** Investments → Portfolio Summary: a "Biggest Changes" tab sits between Summary and History
- [ ] **40.** Biggest Changes: This Week / This Month / This Year each load a gainers table and a losers table (max ten rows each)
- [ ] **41.** Biggest Changes: a period with no history for any ticker shows an empty state rather than an error
- [ ] **42.** Portfolio Summary tiles: Volatility shows 30d and 52w percentages; Unassigned is gone
- [ ] **43.** Annual Income tile shows dollars plus a yield percentage
- [ ] **44.** Hovering the info icon on each summary tile shows its description
- [ ] **45.** Indexes card: after 4 PM, opening it does not refetch; before 4 PM a stale board refetches
- [ ] **46.** Indexes card: two columns on a desktop, one column on a phone
- [ ] **47.** Configuration → Icons: Icon Sets and Icon Positions tabs switch correctly; picking a set still saves
- [ ] **48.** Icon Positions: one tab per group, only the active group's slots are listed; uploading an override still works
- [ ] **49.** Attendance → Classes / Rosters: the Add a class, Add a student and Import a roster cards show an icon, replaceable in Icon Positions (group "Attendance cards")
- [ ] **50.** Display settings → Toolbars: drag an item to a new position and the order persists after reload
- [ ] **51.** Toolbar items: the ↑ ↓ Remove buttons appear on hover or keyboard focus and still work
- [ ] **52.** Phone: Biggest Changes tables and the tabbed Icons screen are usable at a narrow width

---

## 2026-10-02 — Release (Count by Years)

One new feature, no migrations. The tree-nav styling matches the Entries browser;
date filtering is the only risky part — it constructs and URL-encodes date range
queries.

- [ ] **53.** Journal → Statistics card: "Count by Years" section appears with years
  listed newest-first, each year clickable/expandable to show months December-to-January
- [ ] **54.** Click a year (e.g., "2023") to navigate to Entries screen filtered to that
  year's entries; date range query appears in the filter bar
- [ ] **55.** Click a month (e.g., "October") to navigate to Entries screen filtered to
  just that month; month boundary is correct (October has 31 days)
- [ ] **56.** Tree-nav styling: chevron rotates on expand, spine and elbow lines draw
  correctly, hover states work on both year and month rows

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

- [ ] **57.** Journal → Review Data → "Review multiple entries on same date" card: the
  title-bar "Review only Log entries" toggle narrows the list to dates with two or more
  Log entries; turning it off restores the full list
- [ ] **58.** Journal → Review Data: a date with one Log entry and two written entries
  does not appear under the Log-only toggle (it must not show as "1 of 1")
- [ ] **59.** CLI: `npm run cli -- journal-same-date --log-only` matches what the toggle
  shows on the web screen for the same data
- [ ] **60.** Journal → Review Data: merging several entries and saving now shows a
  follow-up dialog — "Merged entry created successfully. Would you like to delete the
  original N entries?" — with Delete N and Keep them
- [ ] **61.** Journal → Review Data: if one of the ticked entries vanished before the
  merge ran, the cleanup dialog's count and offer reflect only the entries the merge
  actually read, not the original selection; choosing Delete N sends exactly those to
  the recycle bin (undoable from CSV Import → Correct)
- [ ] **62.** CLI: `npm run cli -- journal-same-date --merge 41,42,43 --save
  --delete-originals` creates the merged entry and then recycles the three sources in
  one command; omitting `--save` leaves `--delete-originals` with no effect
- [ ] **63.** Administration → SQL Explorer → Table Usage: pressing Measure lists every
  table ranked by size (table + index bytes), each row showing a proportional bar,
  percent of total, and a real row count; Open jumps to that table in Tables Explorer
- [ ] **64.** Home screen (desktop, two-column layout): a card is now dragged by its
  whole frame rather than a handle row; the up/down keyboard buttons appear only on
  hover or keyboard focus, in the card's top-right corner
- [ ] **65.** Desktop navigation tree: scroll partway down a long module list, click a
  module or section, and the tree opens already scrolled to the same position instead
  of snapping back to the top
- [ ] **66.** Music → player screen: the seek bar, transport, volume and sleep timer now
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

Items 15–22 are TODO Lists — item 18 is the one regression check for the shared-list
design (two browsers/accounts must see the same tick land), and item 21 is the delete
guard that must never cascade. Items 23–24 are Chrome Style and Border Weight — both are
desktop-only in effect (item 24's inner-divider axis has nothing to show on a phone,
where the tree doesn't render). Items 25–26 are the Journal Main-tab fix — item 25 is
the one that matters most for trust: a tag or category that is all logged activity must
no longer show a count with nothing behind it. Items 27–32 are the calendar import
review rework; item 27 is its own regression check (an untouched date must never be
written by a batch commit). Items 33–35 are Top Words and the new rank bars. Items 36–37
are small polish.

- [ ] **67.** Tools → TODO Lists: the side panel lists every list with an item count;
  switching lists swaps the grid without a page reload
- [ ] **68.** Tools → TODO Lists: adding an item requires a list and a title; it appears
  immediately at the bottom of that list's outstanding items
- [ ] **69.** Tools → TODO Lists: ticking an item moves it into a "Completed (N)" group
  rather than deleting it, and the same list opened from a second account/browser shows
  the same tick (lists and items are shared, not per-person)
- [ ] **70.** Tools → TODO Lists: the hover ✕ removes a single completed item; "Clear
  all" empties the whole Completed group in one click
- [ ] **71.** Tools → TODO Lists: on a phone, the ✕ and list-delete controls are visible
  without hovering (there is no hover on touch)
- [ ] **72.** Home screen: the TODO card shows the same lists as tabs with a checkbox per
  outstanding item; its title links straight to the Tools screen
- [ ] **73.** Administration → TODO Lists: renaming and reordering a list is immediate;
  deleting a list that still holds items (completed ones included) is refused and names
  the counts in the refusal
- [ ] **74.** CLI: `npm run cli -- todo` lists every list and its outstanding items;
  `--add "…" --list "<name>"`, `--done <id>`, `--delete <id>` and `--new-list "<name>"`
  each work and match what the web screens show afterward
- [ ] **75.** Administration → Display Settings → Chrome Style: picking Inset, Outset or
  Emboss changes the header and the navigation tree's bevel immediately on Save; the
  four preview cards show four visibly different treatments before saving anything
- [ ] **76.** Administration → Display Settings → Border Weight: moving the Chrome
  outline, Inner dividers and Everything else sliders each visibly thickens only their
  own scope (header/tree outer edge; tree's internal rules; every other border app-wide)
  and nothing shifts layout at 1–4px
- [ ] **77.** Journal → a tag or category whose entries are all tagged "Log": clicking
  it from the Statistics card's Main-tab view now shows those entries instead of an
  empty list (previously the count was right and the list was empty)
- [ ] **78.** Journal → Entries browser: the dedicated Log tab still excludes non-Log
  entries as before — only the Main tab's behavior changed
- [ ] **79.** Journal → Preferences → "Review before calendar import" on, then import a
  calendar with more than 10 conflicting dates: the review dialog pages 10 at a time,
  and "Commit reviewed" writes only the dates actually decided on-screen, never an
  un-paged-to date
- [ ] **80.** Journal → calendar import review dialog: a conflicting date's existing
  entry can be quick-edited without closing the dialog, and the row gets an "edited"
  badge afterward
- [ ] **81.** Journal → calendar import review dialog: a locked existing entry's
  quick-edit is disabled rather than offered and then rejected
- [ ] **82.** Journal → calendar import: starting an import shows a progress dialog
  with the event count while it runs, and a result summary (imported/updated/
  skipped/excluded counts, with duration) once it finishes
- [ ] **83.** Journal → calendar import: "Import all" still imports everything except
  dates explicitly declined, matching the pre-existing behavior
- [ ] **84.** Journal → calendar import review dialog: the Instructions card's open/
  closed state does not persist between dialog openings (it is controlled, unlike other
  collapsible cards)
- [ ] **85.** Journal home screen: Top Tags, Top Categories and Top 10 Words each show a
  small proportional bar beside every row, sized against that list's own top entry;
  hidden on a phone
- [ ] **86.** Journal home screen → Top 10 Words: clicking the ✕ beside a word removes
  it from the ranking everywhere, and a word that would otherwise rank in the top 10
  moves up to fill its place
- [ ] **87.** Journal → Preferences → Excluded words: a dismissed word is listed as a
  chip; clicking it restores the word and it can rank again on the home screen
- [ ] **88.** Any screen with a collapsible card (e.g. Journal's Recent Entries):
  collapse one, navigate away and back — it stays collapsed; a card using controlled
  `open`/`onOpenChange` is unaffected
- [ ] **89.** Home screen → My Shortcuts with 1–3 shortcuts on a phone: the tiles fill
  the row as full-width bars instead of leaving a ragged empty grid cell

---

## 2026-09-29 — Release (Household: Recipes, a personal home-screen layout)

**Migrations 0118, 0119 and 0120 must all be applied** — `hsh_recipes` and
`hsh_recipe_tags`, then the Household module's seed row, then `category` on
`hsh_recipes`. If any Household screen 404s or reports "no such column", check
`sys_schema_migrations` before reading anything here as a bug. The home-screen
layout items need no migration — both new preferences are plain
`user_preferences` rows.

Items 38–46 are Household → Recipes. Item 39 is the one regression check — the tab
strip must not silently drop a recipe, so its Uncategorised count has to match
reality. Item 42 is the one that matters most for trust: a picture failure must
never read as "the recipe wasn't saved" when it was. Items 47–52 are the home
screen's personal layout; item 50 is its own regression check, since the two
orderings (household default vs. a reader's drag) must never leak into each
other.

- [ ] **90.** Household → Recipes: the list shows tabs — All, one per category with
  a count, then Uncategorised — instead of a Category dropdown; clicking a
  category tab narrows the grid and updates the URL (`?category=`)
- [ ] **91.** Household → Recipes: the Uncategorised tab's count matches the number
  of recipes with no category set, and narrows the grid to exactly those
- [ ] **92.** Household → Recipes: a bookmarked or refreshed `?category=` URL opens
  on the right tab; Uncategorised does not survive a refresh (falls back to All)
- [ ] **93.** Household → Recipes: the grid shows Name, Description, Tags, Made and
  Rating; Category, Source and the picture are gone from the grid but still
  visible in the record view
- [ ] **94.** Household → Recipes: clicking **View**, or clicking anywhere on a row,
  opens a record view showing every field — including ingredients, directions
  and notes, each inside its own bordered/inset panel
- [ ] **95.** Household → Recipes → Edit: Ingredients and Directions are each a
  full-width row (not side-by-side), Description is a 3-line box, there is no
  Cancel button (the modal's own close and Escape still work), and Save reads
  "Save Recipe"
- [ ] **96.** Household → Recipes → Add: choosing a picture before saving shows a
  preview immediately; saving the new recipe attaches that picture without a
  second trip back into the editor
- [ ] **97.** Household → Recipes: if attaching a picture fails right after a
  successful save, the message says the recipe *was* saved and names the
  picture as the only thing that didn't attach — never reads as if nothing
  happened
- [ ] **98.** Household → Recipes: a picture added through the editor or through
  "Replace picture" in the record view is visibly smaller than the original
  file (check its size via the browser's network tab or file download) —
  existing pictures added before this release are untouched
- [ ] **99.** Home screen (full/desktop layout, ≥1280px wide): a control above the
  cards switches between one and two columns
- [ ] **100.** Home screen: dragging a card by its handle moves it to a new
  position; the new order persists after a refresh
- [ ] **101.** Home screen: with no pointer, the up/down buttons on a card move it
  one place at a time, wrapping neither at the top nor the bottom of the list
- [ ] **102.** Home screen: an admin reordering *Administration → Display Settings
  → Dashboard Widgets* is picked up by a reader who has never dragged a card,
  but does **not** change the arrangement of a reader who has
- [ ] **103.** Home screen: the module carousel always spans both columns and is
  not draggable, regardless of the column count
- [ ] **104.** Home screen on a phone or a narrow window (<1280px): no column
  control appears, and the cards are a single stack exactly as before this
  release

---

## 2026-09-28 — Release (Journal Review Data, module texture picker, app-wide texture)

**Migrations 0116 and 0117 must both be applied** — `app_wide` on
`sys_dashboard_texture`, then `texture_id`/`texture_mode` on `sys_module_texture`. Both
ship inert (item 59 confirms the Music Library still shows its own picture unchanged
after 0117's backfill runs). If any texture screen reports "no such column", check
`sys_schema_migrations` before reading anything here as a bug.

Items 53–61 are the new Journal screen. Item 56 is the one that matters most — a merge
must never be destructive, so the source entries have to still be there after saving
the draft. Items 62–65 are the module texture picker; item 62 is the regression check,
since a wrong backfill would silently swap Music's picture for the app-wide one. Items
66–68 are the app-wide texture scope, and item 66 is its own regression check for the
same reason — this ships off, so an existing install must render unchanged until an
admin ticks it on.

- [ ] **105.** Journal → Data Management → Review Data: the card lists every date carrying more than one entry, each row showing its position ("2 of 4"), time, title and a 100-word excerpt — including untitled entries, which the Correct tab beside it leaves out
- [ ] **106.** Journal → Review Data: clicking a row opens the full entry, with an Edit button that opens the same form the single-entry screen uses; closing it returns to the list with page, sort and ticks intact
- [ ] **107.** Journal → Review Data: Edit is disabled on a locked entry, the same as it is from `/entries/[id]`
- [ ] **108.** Journal → Review Data: ticking several entries and choosing Merge drafts one new entry (earliest date/time, titles joined with `/`, each source's content under a `— HH:MM · Title` line, categories and tags combined) and opens it in the ordinary entry form — saving creates the new entry and leaves every source entry exactly where it was
- [ ] **109.** Journal → Review Data: locations and weather are not carried into a merged draft, and the form still lets you add them
- [ ] **110.** Journal → Review Data: ticking several entries and choosing Delete asks first, then moves them to the recycle bin (restorable from the Correct tab)
- [ ] **111.** CLI: `npm run cli -- journal-same-date`, `--merge 41,42,43` (prints only), `--merge ... --save` (creates), and `--delete 41,42` all behave as documented
- [ ] **112.** Administration → Configuration → Module Configuration: the Music Library's background texture control shows "Its own uploaded picture" already selected, and the module's screens still show the same picture as before this release
- [ ] **113.** Administration → Configuration → Module Configuration: a module with no picture of its own can pick "Pick one from the library" and choose a thumbnail from the App Texture library; that module's screens then show it with that picture's own opacity/blur
- [ ] **114.** Administration → Configuration → Module Configuration: a module set to "None — plain paper" stays flat even when an app-wide texture is on
- [ ] **115.** Administration → Configuration → App Texture: deleting a library picture that a module was pointed at drops that module back to the app background rather than breaking its screen
- [ ] **116.** Administration → Configuration → App Texture: on an install that has not touched the new "Show on every screen" tick box, the background still appears only on the home dashboard, exactly as before this release
- [ ] **117.** Administration → Configuration → App Texture: ticking "Show on every screen" puts the selected picture behind every module, Administration and the account screen, all sharing one background
- [ ] **118.** Administration → Configuration → App Texture: with the app-wide texture on, a module that still has its own uploaded picture (Music) keeps showing its own picture instead of the app-wide one

---

## 2026-09-27 — Release (My Shortcuts, uploaded icons)

**Migrations 0114 and 0115 must both be applied** — `sys_user_shortcuts` and then
its two icon-upload columns. 0115 exists because 0114 had already run on the NAS
when the columns were needed; an earlier attempt folded them into 0114, which the
runner skipped, and every home screen died on `no such column: icon_image`. If
items 67–75 report a missing table or column, check `sys_schema_migrations` before
reading anything here as a bug.

Items 67–75 are the new card. **Item 72 is the one that matters most** — it is the
privacy boundary, and it needs two accounts: shortcuts and their uploaded pictures
are per-person, unlike every other image in this app. Item 70 needs a second
account too, or a module grant revoked, to see a shortcut go unavailable rather
than vanish.

Item 76 is desktop-only (there is no hover on a phone); item 77 is its phone
counterpart, where the tile controls are always visible instead.

- [ ] **119.** Home: the My Shortcuts card appears, and Admin → Display Settings → Dashboard Widgets can hide and reorder it like any other card
- [ ] **120.** Add a shortcut to a web address — a bare `example.com` gets `https://` added, and the tile opens it in a new tab
- [ ] **121.** Add a shortcut to a page in this app: pick a module, then a section — and separately, a module's own main page
- [ ] **122.** A shortcut into a module you can no longer open draws greyed out with a reason, rather than disappearing
- [ ] **123.** Upload a picture as a shortcut's icon; removing it falls back to the glyph underneath rather than leaving the tile blank
- [ ] **124.** Two accounts: each sees only their own shortcuts, and one cannot fetch the other's uploaded icon by its URL
- [ ] **125.** Edit, reorder and remove a shortcut from the card itself; renaming one keeps its uploaded picture
- [ ] **126.** The twelfth shortcut is the last — Add is refused with a message rather than failing silently
- [ ] **127.** An oversized picture (over 256 KB) is refused immediately with the app's own wording, not a server error
- [ ] **128.** Desktop: shortcut tiles read as 3D buttons — they lift on hover and press down on click, and the row controls appear on hover
- [ ] **129.** Phone: the tiles reflow to the width available and their edit controls are visible without hovering
- [ ] **130.** Navigation: a section group whose heading has its own page draws as a link with its glyph; headings without one stay plain labels
- [ ] **131.** Music: reorder a playlist entry up and down — a playlist holding the same track twice moves the two copies independently
- [ ] **132.** Administration → About loads and shows its disk figures (this screen previously failed to build)

---

## 2026-09-25 — Release (navigation tree)

**No migration.** The remembered expanded set is a new key in the existing
`sys_user_preferences` table, so nothing schema-level shipped here.

**This release replaces the navigation on every desktop screen in the app**, so
item 81 is the one that matters: if `NavTree` fails to render, every page behind
the login goes with it. Check that first and the rest afterwards.

Items 81–86 are desktop-only by design. Item 87 is the counterpart and is
arguably the more important check of the two — the phone was deliberately left
alone, so the test is that nothing about it *changed*. Item 88 needs two devices,
or one device and a logout, to prove the preference is stored per person rather
than in that browser.

- [ ] **133.** Every module and Admin: the left column is one tree — Home on top, each module a heading that expands to its sections
- [ ] **134.** The tree: clicking a module heading expands and collapses it; the module you are currently in is always open
- [ ] **135.** Filter: typing `import` finds Journal, Investments and Expense sections together, each labelled with its module
- [ ] **136.** Filter: matches starting with what you typed rank first; Esc clears; clearing restores the collapse state you had
- [ ] **137.** Collapse: `«` folds the tree to a thin strip and the content widens; the strip and the header's `»` both reopen it
- [ ] **138.** Icons: Admin → Display Settings → Icons can replace the tree's Home and filter glyphs, and each module's section icons still resolve
- [ ] **139.** Phone: the bottom bar and its sheet behave exactly as before — no tree, no strip, nothing new
- [ ] **140.** The set of expanded modules survives a reload, and is remembered per user rather than per browser

---

## 2026-09-25 — Release

Migration 0112 (`sys_saved_sql_queries`) was applied on the NAS during this
release's publish. If items 89–91 ever report "no such table", that is the thing to
re-check before reading anything else here as a bug.

Item 94 costs live provider calls on every expand, so it can only really be judged
during market hours; item 96 needs a file whose tags actually carry lyrics, which
not every track in the library has. Item 98 is phone-relevant — the expanded index
panel adds six figures and a sparkline to a row that was already tight.

- [ ] **141.** Admin → SQL Explorer → SQL Query: save a statement with a name, description and tags; it appears on the Saved SQL card
- [ ] **142.** Admin → SQL Explorer: Load fills the editor and does **not** execute — confirm with a statement you would not want run
- [ ] **143.** Admin → SQL Explorer: saving under an existing name replaces that row, and the dialog warns before it does
- [ ] **144.** Investments → Indexes card: a row expands to show day range, 52-week range with its marker, moving averages, one-year change, all-time high and a sparkline
- [ ] **145.** Investments → Indexes card: a symbol whose second pass fails keeps its row and shows em-dashes (the three commodity futures have no one-year change)
- [ ] **146.** Music: a track with embedded lyrics shows them attributed "From this file's own tags", without a network lookup
- [ ] **147.** Music: a track with no embedded and no lrclib match offers the Google search link
- [ ] **148.** Investments → Indexes card: the expanded panel and sparkline are readable on a phone
- [ ] **149.** Admin → Daily Quote → All Quotes: the new nav entry opens the listing screen
- [ ] **150.** CLI: `saved-sql list` / `show` / `save` / `delete` behave as documented

---

## 2026-09-24 — Release

No new migrations: 0109–0111 shipped with the previous release and are already
applied on the NAS. Item 103 is the one to watch — the dedup rule changed, so a
scan that used to return nothing may now return groups, and blank-named places
can group on distance alone. Items 105 and 104 are phone-relevant: the popup and the
picker's refusal message both have to be readable narrow.

- [ ] **151.** Admin → Message Queue: the screen lists read and unread together, newest first, with each message's source
- [ ] **152.** Admin → Message Queue: tick rows and Delete removes them; Purge by age (7/30/90/365 days) clears everything older and keeps the rest
- [ ] **153.** Journal → Merging & Dedup: the "Within" slider (10–500m, default 75m) rescans on release, and groups found by distance are labelled "proximity"
- [ ] **154.** Journal → Merging & Dedup: two pins ~25–50m apart with similar names now group (they did not before); merging one still works
- [ ] **155.** Journal → entry form: adding a location already on the entry is refused with a message, and the draft pin stays put — from both the map tab and the library tab
- [ ] **156.** Journal: clicking a numbered map pin opens a popup with number, name, address, coordinates and chips, readable in the dark theme
- [ ] **157.** Journal: a single entry page shows the module rail, section panel and header (no more bare page with a "Back to My Journal" link)

---

## 2026-09-23 — Release

Migrations 0106, 0107 and 0108 are applied on the NAS. The Investments rename
touched ~83 files and renamed 17 tables, so the items below are worth a walk
through even where the screen looks unchanged — a missed server action throws
only when that one feature is used, not when the page loads.

- [ ] **158.** Investments: the module opens at /modules/investments, named Investments on the rail and home grid
- [ ] **159.** Investments: every section loads — Dashboard, Positions, Transactions, Account Performance, Watch & Test, Chart & Analysis, CSV Import, Tax Lots, Export for AI Analysis, Settings
- [ ] **160.** Investments: the actions still write — add/edit a position, a transaction, a watchlist entry, an account
- [ ] **161.** Investments: Tax Lots deep links still resolve (ticker picker, and the links out of the positions grid)
- [ ] **162.** Investments: CSV import of a broker file
- [ ] **163.** Admin → SQL Explorer: the Investments group lists the inv_ tables, and Table References names them
- [ ] **164.** Admin → Background Tasks: the Investments auto-refresh still finds its module
- [ ] **165.** Home: the Daily Glance card renders and its "Launch Investments" link goes to the new URL
- [ ] **166.** Investments: uploaded section/card icons survived the rename (slot ids were deliberately left on `stock_*`)
- [x] **167.** Expense: Transaction Rule Types — group rules by type, filter the rules list, manage types in Meta Data  — tested 2026-09-23
- [x] **168.** Security → Visits: why a visit was scored suspicious (signals on the row)

---

## 2026-09-22 — Release

- [x] **169.** CSV Analysis: pooled datasets
- [x] **170.** Admin-set preferences (allow edit user's preferences)
- [x] **171.** Location icons

## 2026-09-20

- [x] **172.** Journal: filter the category and tag lists in Meta Data
- [x] **173.** Journal: a saved-location library
- [x] **174.** Journal: Entries as one screen with two tabs
- [x] **175.** Tools: a CSV file browser beside the SQLite one

## 2026-09-19

- [x] **176.** Journal: keep or file a photo from an entry
- [x] **177.** TreeNav: each group reads as its own embossed card
- [x] **178.** Tools: SQLite uploads over 4 MB, with an admin-set cap
- [ ] **179.** Stocks: icons on the indexes board
- [ ] **180.** Stocks: playback of portfolio history
- [ ] **181.** Music: a sleep timer that stops the player after a set time

## 2026-09-17

- [ ] **182.** Home screen: launch a card's module from its title
- [ ] **183.** Journal: review existing entries before importing from a calendar
- [ ] **184.** Tools: a new module, opening with a SQLite file browser

## 2026-09-15

- [ ] **185.** Floating layer: a clock over every page
- [ ] **186.** Floating layer: a calculator over every page
- [ ] **187.** Floating layer: a scratchpad over every page
- [ ] **188.** Stocks: the indexes board loads when you open the card
- [ ] **189.** Admin: clear deployment records in bulk, or prune to the newest few
- [ ] **190.** Journal: jump to the next day that has an entry
- [ ] **191.** NAS: a startup crash that says what broke

## 2026-09-14

- [ ] **192.** Journal: date the template suggestion by the local calendar
- [ ] **193.** Themes: tell the browser a dark theme is dark
- [ ] **194.** Export for AI: measured correlations, and the sectors you hold nothing in
- [ ] **195.** Home: a Clock card, with the weather where you are
- [ ] **196.** Picture Gallery: Magic List — photographs conjured from a description
- [ ] **197.** Stocks: candlesticks in the ticker viewer's Today card
- [ ] **198.** Stocks: consult AI about one ticker
- [ ] **199.** Stocks: a transaction knows which account it belongs to

## 2026-09-13

- [ ] **200.** Attendance: bigger cards in the register grid
- [ ] **201.** Admin: random theme generation
- [ ] **202.** Music Library: an Albums view
- [ ] **203.** Stocks & ETFs: a recorded trade can update the holding
- [ ] **204.** MyJournal: New Entry becomes a section
- [ ] **205.** Games: Bridge
- [ ] **206.** SQL Explorer: BLOB cells fetched on demand
- [ ] **207.** SQL Explorer: tables grouped by module
- [ ] **208.** Account: two compact navigation styles, and the reader picks
- [ ] **209.** Icon names: the compiler catches glyph-table drift

## 2026-09-11

- [ ] **210.** Journal: Calendar Import — read a Google/Outlook .ics and pick events to import
- [ ] **211.** Journal: re-importing a renamed or moved event updates it instead of duplicating
- [ ] **212.** Journal: a large .ics (2.4 MB) uploads without tripping the action-argument limit
- [ ] **213.** Journal: restoring an imported entry from the recycle bin keeps its identity
- [ ] **214.** Stocks: a portfolio brief for an LLM
- [ ] **215.** Attendance: one register per class per day again
- [ ] **216.** Attendance: session labels read in local time, not four hours ahead

## 2026-09-10

- [ ] **217.** Picture Gallery: albums
- [ ] **218.** Picture Gallery: a + on every photograph
- [ ] **219.** Home screen: a handwritten quote, no header, and a slimmer rail

## 2026-09-09

- [ ] **220.** Security: every exported server action authorises on its first line
- [ ] **221.** Stocks & ETFs: analyze several tickers at once, and link to an analysis
- [ ] **222.** Music Library: the song on YouTube
- [ ] **223.** Music Library: a real fullscreen visualizer
- [ ] **224.** Picture Gallery: a module of its own, not a corner of the home screen

## 2026-09-08

- [ ] **225.** Games: Mahjong pickers and board frame
- [ ] **226.** Stocks & ETFs: today's session in the ticker viewer
- [ ] **227.** Journal: a space-separated Tags column no longer imports as one long tag
- [ ] **228.** CSV Analytics: bulk edit rows
- [ ] **229.** CSV Analytics: a CLI for bulk edit
- [ ] **230.** Photographs: one viewer, with a capture timestamp and a heart

## 2026-09-06 — Release

- [ ] **231.** Games: Mahjong, the four-player game against three bots
- [ ] **232.** Stocks & ETFs: the Tax Lot Portfolio Analyzer
- [ ] **233.** About: count untagged changes instead of reporting zero
- [ ] **234.** Home: the Random Photo card streams instead of blocking first paint
- [ ] **235.** Photos: an absolute path can no longer escape the photo folder
- [ ] **236.** Compact grids: long values are readable
- [ ] **237.** Compact grids: a second layout for reading
- [ ] **238.** Music: the story behind the song, beside the lyrics
- [ ] **239.** Games: Mahjong Match
- [ ] **240.** Games: card icons across the whole arcade
- [ ] **241.** Attendance: upload your own icon for a student action
- [ ] **242.** CSV Analysis: named views over a dataset

## 2026-09-03

- [ ] **243.** Attendance: a class records the weekday it meets on
- [ ] **244.** Attendance: the home screen opens on today's register
- [ ] **245.** Photos: a viewer component with its own actions
- [ ] **246.** Journal: a photos slideshow and folder module
- [ ] **247.** Games: sudoku and blackjack polish
- [ ] **248.** Stocks: the refresh total counts up as prices land

## 2026-09-02 — Release

- [ ] **249.** Expense: top-5 cards link through to their transactions
- [ ] **250.** Expense: the vendor rollup stops inventing vendors from payment lines
- [ ] **251.** Stocks: the indexes refresh becomes an icon
- [ ] **252.** Favourite photos: a slideshow
- [ ] **253.** Carousel graphics are resized on upload
- [ ] **254.** SQL Explorer: a schema browser
- [ ] **255.** SQL Explorer: prose for every table
- [ ] **256.** Music: a spectrum analyser under the cover art
- [ ] **257.** Games: Sudoku
- [ ] **258.** Games: Blackjack
- [ ] **259.** Games: Minesweeper
- [ ] **260.** Journal: a recycle bin
- [ ] **261.** Journal: a Correct tab
- [ ] **262.** Journal: metadata backup

## 2026-09-01 — Release

- [ ] **263.** Journal import: an overwrite mode, with the plan shown before it writes
- [ ] **264.** Favourite photos: their own screen
- [ ] **265.** Favourite photos: a zip download
- [ ] **266.** Admin: a deployment history, with the build log attached
- [ ] **267.** Games: Tetris
- [ ] **268.** Games: Arrow Clearing becomes an actual puzzle
- [ ] **269.** SQL Explorer: a Truncate button, behind a warning that counts the rows
- [ ] **270.** Journal import: normalized entry time stops a re-import duplicating

## 2026-08-30

- [ ] **271.** Themes: colour themes are data, and the builder warns before you blind yourself
- [ ] **272.** Games: Arrow Clearing cannot generate an unsolvable board
- [ ] **273.** Games: an arcade, and a scoreboard the whole house shares

## 2026-08-29

- [ ] **274.** Stocks: five threads on refresh
- [ ] **275.** Stocks: a wildcard that was lying to you
- [ ] **276.** Home: the random photo card says how old the photo is
- [ ] **277.** Stocks: Watch & Test — watch lists, signals and simulation on one screen
- [ ] **278.** Expense: re-run a rule over transactions you have already imported
- [ ] **279.** Expense: a vendor is somebody now, not just a total

## 2026-08-28

- [ ] **280.** Home screen: arrange it yourself
- [ ] **281.** CSV Analysis: the two-tier nav
- [ ] **282.** Home: a photograph drawn at random
- [ ] **283.** Uploaded icons get cleaned up on the way in
- [ ] **284.** Icons: any single icon can be replaced without changing the icon set (73 slots)
- [ ] **285.** Admin → Configuration → Icons: upload an SVG or image per position
- [ ] **286.** Icons: uploaded SVG is sanitized on write
- [ ] **287.** Home: a picture behind the day
- [ ] **288.** Expense: rules that say why

## 2026-08-26

- [ ] **289.** Admin → Background Tasks: every timer in one place, including jobs that never ran
- [ ] **290.** A job killed mid-pass reads as interrupted, never as ok
- [ ] **291.** CLI: list-scheduled-jobs gives the same answer without the web server
- [ ] **292.** Last-run stamps survive the restarts a deploy performs
- [ ] **293.** Stocks: an Indexes card of eleven benchmarks in four groups
- [ ] **294.** Stocks: a new dashboard widget lands beside its neighbour, not at the bottom
- [ ] **295.** Stocks → Simulation: "what if I'd bought then?" across ten windows

## 2026-08-25

- [ ] **296.** Music: a scan that finishes (no OOM on a large NAS folder)
- [ ] **297.** Music: an abandoned scan run closes itself instead of reading "running" forever
- [ ] **298.** Progress3D: one progress bar across the app
- [ ] **299.** Per-module background pictures
- [ ] **300.** Attendance: a Detail report — the whole term as a grid
- [ ] **301.** About: a Server Log tab

## 2026-08-19

- [ ] **302.** Stocks: find a ticker, and star the ones you watch daily
- [ ] **303.** Music Library: Magic Playlists assembled from a query
- [ ] **304.** Music Library: a visible play queue
- [ ] **305.** Music Library: lyrics on demand
- [ ] **306.** Grids that count their own columns
- [ ] **307.** Seven more glyphs
- [ ] **308.** Ticker detail: how far a trade has moved since you made it
- [ ] **309.** Music Library: stream 20,000 songs off the NAS
- [ ] **310.** Attendance: two registers a day
- [ ] **311.** Attendance: student actions, a teacher-editable catalog
- [ ] **312.** Attendance: 12 icon sets, applied to the section nav too

## 2026-08-16

- [ ] **313.** Attendance: a new module — pick a class, tap who is here, save
- [ ] **314.** Attendance: a student can sit in several classes
- [ ] **315.** "Absent" and "attendance was never taken" stay distinguishable
- [ ] **316.** Admin → Security: a sign-in audit log recording logins, failures and logouts
- [ ] **317.** Stocks: allocation by sector
- [ ] **318.** Stocks: candlestick charts
- [ ] **319.** Admin: import daily quotes from a newsletter

## 2026-08-15

- [ ] **320.** Journal: clickable taxonomy
- [ ] **321.** About page: inline markdown in the change log
- [ ] **322.** About page: memory as meters
- [ ] **323.** Home: Daily Glance moves off the Stocks dashboard
- [ ] **324.** Installable PWA: stable identity, module shortcuts, iOS launch screens
- [ ] **325.** Per-user preferences: a favourite module you can open on startup

## 2026-08-14

- [ ] **326.** Journal: a filtered Entries browser with saved AND/OR filters
- [ ] **327.** Journal: icons for categories and tags
- [ ] **328.** Deploys apply their own migrations, and fail loudly rather than serving new code
- [ ] **329.** CSV Analytics: add columns without re-importing a file
- [ ] **330.** ModuleCarousel: a grid on desktop, coverflow on phones
- [ ] **331.** DataGrid: column headers popped up into a 3D bar
- [ ] **332.** Journal: home-screen search
- [ ] **333.** The section bar moved to the bottom, and modules collapsed into a menu

## 2026-08-11

- [ ] **334.** CSV Analytics: add custom columns during append/truncate

## 2026-08-10

- [ ] **335.** The section tree became a bar, and surfaces learned to lift

## 2026-08-08

- [ ] **336.** The compact section bar
- [ ] **337.** User management gated on admin
- [ ] **338.** Home: announce a new deployment
- [ ] **339.** Navigation moved to the edges — a top bar plus a compact bottom module bar
- [ ] **340.** Both nav bars minimise to a puck and remember it
- [ ] **341.** Every chart got a gear

## 2026-08-07

- [ ] **342.** Restart the NAS after a publish without SSH
- [ ] **343.** The app works on a phone — one layout boundary at 1024px, decided server-side
- [ ] **344.** Installable to the home screen
- [ ] **345.** Stocks: ticker viewer as cards, with Events and Yahoo Detail tabs
- [ ] **346.** Stocks: risk cached and served at any age, refreshed only by Recalculate
- [ ] **347.** Stocks: earnings data no longer vanishes (Yahoo User-Agent and crumb race)
- [ ] **348.** Home: the module grid becomes a carousel with per-module artwork
- [ ] **349.** Image uploads send a File in FormData rather than base64

## 2026-08-05

- [ ] **350.** Stocks: positions split into Stocks / ETF / Others
- [ ] **351.** Stocks: Daily Glance — one table for the three buckets, with the total
- [ ] **352.** Stocks: Account Performance Over Time on one set of axes
- [ ] **353.** Stocks: remember which account a broker's CSV label means
- [ ] **354.** Hide the sidebar to its accent strip, and give the page back the gutter
- [ ] **355.** Stocks: performance chart points shaped by what they are
- [ ] **356.** Stocks: ticker viewer — everything about one symbol in one dialog
- [ ] **357.** Stocks: choose which dashboard widgets show, and in what order
- [ ] **358.** Stocks: record the brokerage firm on a trade, and fix duplicate detection
- [ ] **359.** Stocks: cost basis, so total return is possible at all
- [ ] **360.** Stocks: daily snapshots, value and gain/loss per bucket
- [ ] **361.** Stocks: an icon per investment account
- [ ] **362.** Stocks: eight routed sections behind a TreeNav, loading per section
- [ ] **363.** Stocks: Refresh All with per-ticker progress
- [ ] **364.** Stocks: a per-ticker news lookup
- [ ] **365.** CSV import: one screen for all three types, listing every row
- [ ] **366.** A verification gate: typecheck, boundary, tests, migration dry-run, e2e

## 2026-08-03

- [ ] **367.** Full-width layout: one shared container across every full-page screen
- [ ] **368.** A fixed sidebar raised above the page, so a module gets the rest of the screen
- [ ] **369.** Expense: spend stats
- [ ] **370.** Expense: an auto-import switch
- [ ] **371.** Expense: an uploadable icon per category
- [ ] **372.** Stocks: cache and show ticker logos
- [ ] **373.** DataGrid: filter expressions
- [ ] **374.** DataGrid: column aggregates
- [ ] **375.** DataGrid: record view
- [ ] **376.** Modal extracted as its own component
- [ ] **377.** Three colour themes and three icon sets

## 2026-08-02

- [ ] **378.** Expense: automatic CSV import from a watched folder, one sub-folder per card
- [ ] **379.** Expense: a processed file is renamed .backup, a failure .failed
- [ ] **380.** Expense: post-import rules — one condition, any number of field assignments
- [ ] **381.** Expense: "Manually Run Import Clean up" with real progress
- [ ] **382.** Expense: the tree-nav overhaul
- [ ] **383.** Expense: a new module for credit-card spending
- [ ] **384.** Expense: fuzzy auto-categorisation by glob against the statement description
- [ ] **385.** Expense: CSV import with a saved column mapping per card company
- [ ] **386.** Admin: import daily quotes from a newsletter

## 2026-07-30

- [ ] **387.** Result grid: search, filters, sticky header, column control, row selection
- [ ] **388.** Journal: entry authoring with category/tag autocomplete
- [ ] **389.** Journal: a Leaflet location picker with search and multiple pins
- [ ] **390.** Journal: fetch today's weather
- [ ] **391.** Journal: the entry screen, with Print/Save-PDF, Edit, Lock and Delete
- [ ] **392.** Journal: Today In History

## 2026-07-27

- [ ] **393.** Journal: a new module, with CSV import of a real export
- [ ] **394.** Real Estate and Property Watch removed
- [ ] **395.** Every table renamed to a 3-letter module prefix
- [ ] **396.** Daily Quote

## 2026-07-25

- [ ] **397.** Self-signup, always as a plain user with no module access
- [ ] **398.** Admin elevation behind a secret that stays hidden until you type "adm"
- [ ] **399.** User-selectable module icon sets
- [ ] **400.** Daybreak, the first light theme

## 2026-07-21

- [ ] **401.** Interactive DataGrid: click-to-sort, paging, Export CSV, Show SQL
- [ ] **402.** CSV Analysis: Show Data and Chart per entry
- [ ] **403.** CSV chart builder with presets
- [ ] **404.** ChartXY: line/bar/scatter/area with zoom

## 2026-07-19

- [ ] **405.** CSV Analytics: a new module
- [ ] **406.** Theme and UI polish
- [ ] **407.** ARM/Synology NAS deployment support

## 2026-07-18

- [ ] **408.** Stocks & ETFs: accounts, positions, transactions and portfolio summary
- [ ] **409.** Stocks & ETFs: a Yahoo Finance market-data client with manual/CLI refresh
- [ ] **410.** Stocks & ETFs: volatility, correlation and Sharpe analytics
- [ ] **411.** Stocks & ETFs: a Next Day Actions signal scanner
- [ ] **412.** Stocks & ETFs: CSV import with saved column-mapping presets
- [ ] **413.** Admin: SQL Explorer
- [ ] **414.** ChartLine, ChartBar and Tabs components
- [ ] **415.** Publish applies pending migrations, with an automatic backup
- [ ] **416.** ~~Real Estate: property portfolio and a RentCast watch list~~ *(removed 2026-07-27, migration 0026)*

## 2026-07-13

- [ ] **417.** Google auto-registration
- [ ] **418.** User avatars
- [ ] **419.** start.bat port cleanup

## 2026-07-12

- [ ] **420.** User management
- [ ] **421.** Authentication and Google sign-in
- [ ] **422.** Administration section
- [ ] **423.** Module Settings
- [ ] **424.** Initial scaffold: modules, settings, admin section
