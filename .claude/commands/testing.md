---
description: Interactive testing checklist — mark items as tested. Reads Testing_List.md, shows untested items newest first, skip already-marked items.
---

# Testing Command

Interactive checklist for marking features as tested. This reads `Testing_List.md` and presents untested items (those marked `[ ]`) starting from the newest release. Already-marked items (`[x]` or `[~]`) are hidden.

## How it works

1. Review items below, newest releases first
2. Test each feature according to the testing methodology in `Testing_List.md` → "How to test"
3. Mark it as you go: change `[ ]` to `[x]` (works), `[~]` (partly working/broken), or add a note with the date

## Marking convention

- `[ ]` = not tested yet
- `[x]` = works — add the date tested (e.g., `[x] Feature name — tested 2026-10-02`)
- `[~]` = partly working or broken — add the date and one line explaining what's wrong (e.g., `[~] Feature name — 2026-10-02, broken on mobile`)

---

## 2026-10-02 — Release (Count by Years)

- [ ] **1.** Journal → Statistics card: "Count by Years" section appears with years
  listed newest-first, each year clickable/expandable to show months December-to-January
- [ ] **2.** Click a year (e.g., "2023") to navigate to Entries screen filtered to that
  year's entries; date range query appears in the filter bar
- [ ] **3.** Click a month (e.g., "October") to navigate to Entries screen filtered to
  just that month; month boundary is correct (October has 31 days)
- [ ] **4.** Tree-nav styling: chevron rotates on expand, spine and elbow lines draw
  correctly, hover states work on both year and month rows

---

## 2026-10-01 — Release (Merge cleanup, Log-only lens, Table Usage, chrome refinements)

- [ ] **5.** Journal → Review Data → "Review multiple entries on same date" card: the
  title-bar "Review only Log entries" toggle narrows the list to dates with two or more
  Log entries; turning it off restores the full list
- [ ] **6.** Journal → Review Data: a date with one Log entry and two written entries
  does not appear under the Log-only toggle (it must not show as "1 of 1")
- [ ] **7.** CLI: `npm run cli -- journal-same-date --log-only` matches what the toggle
  shows on the web screen for the same data
- [ ] **8.** Journal → Review Data: merging several entries and saving now shows a
  follow-up dialog — "Merged entry created successfully. Would you like to delete the
  original N entries?" — with Delete N and Keep them
- [ ] **9.** Journal → Review Data: if one of the ticked entries vanished before the
  merge ran, the cleanup dialog's count and offer reflect only the entries the merge
  actually read, not the original selection; choosing Delete N sends exactly those to
  the recycle bin (undoable from CSV Import → Correct)
- [ ] **10.** CLI: `npm run cli -- journal-same-date --merge 41,42,43 --save
  --delete-originals` creates the merged entry and then recycles the three sources in
  one command; omitting `--save` leaves `--delete-originals` with no effect
- [ ] **11.** Administration → SQL Explorer → Table Usage: pressing Measure lists every
  table ranked by size (table + index bytes), each row showing a proportional bar,
  percent of total, and a real row count; Open jumps to that table in Tables Explorer
- [ ] **12.** Home screen (desktop, two-column layout): a card is now dragged by its
  whole frame rather than a handle row; the up/down keyboard buttons appear only on
  hover or keyboard focus, in the card's top-right corner
- [ ] **13.** Desktop navigation tree: scroll partway down a long module list, click a
  module or section, and the tree opens already scrolled to the same position instead
  of snapping back to the top
- [ ] **14.** Music → player screen: the seek bar, transport, volume and sleep timer now
  sit in one full-width panel below the cover and lyrics; narrow, the panel's three
  clusters stack in reading order, and a track with no cover art shows a spinning vinyl
  placeholder that pauses when playback pauses

---

## Full list

For all other releases and the complete testing methodology (ground rules, 6-step process), see **`Testing_List.md`** in the project root.

This command shows only the **newest untested items**. Already-marked items (`[x]` or `[~]`) are hidden to keep focus on what's left to test.
