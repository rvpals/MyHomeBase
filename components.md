# Components Registry

The single source of truth for reusable UI components. **Before building any UI element,
read this file first.** If a registered component fits, import it and use it — do not
rebuild it, and do not create a second component that does the same thing under a
different name.

Every entry below gives you: what it's called, where the source lives, how to import and
call it, its props, and a real module that already uses it — so you can copy a working
pattern instead of inventing one.

## How this works

1. **Reuse first.** Search this registry before writing a new presentational component.
2. **Ask before creating a new reusable one.** When about to build something that looks
   reusable (a card, modal, table, form field, badge…) and nothing here fits, ask in one
   line: *"This looks reusable — should we make it a shared component? If so, give it a
   name."* Then wait for the name.
3. **On a name, create and register.** Put it at `src/components/<kebab-name>.tsx` with a
   `PascalCase` export, then add a section below. Start from
   [`src/components/_component-template.tsx`](src/components/_component-template.tsx),
   not from scratch.
4. **One-offs stay local.** Page-specific UI that won't be reused lives in the route's
   `view.tsx` and is *not* registered. Don't ask about obviously trivial local markup.
5. **This file is the index; the source is the contract.** Props here are a working
   summary — the typed props + JSDoc in each component file are authoritative. If they
   disagree, the file wins and this entry needs fixing.

## Rules for every registered component

- Pure presentation: **props in, events out.** No data fetching, no business logic, no
  `lib` imports beyond types. Data arrives as props from the page that fetched it.
- Accepts a `className` passthrough, merged last so the caller wins.
- Colors and fonts are **theme tokens** (`bg-paper`, `text-ink`, `text-brass-dark`,
  `border-line`, `font-display`…), never literal hex/rgb. See `design.md`.
- Follows the conventions of the components already listed here (styling approach,
  prop-naming, variant patterns).
- **Works below 1024px as well as above.** Say which in the entry — "responsive via
  `max-lg:`", or "has a compact mode", or "unchanged, it's small already". A component
  that only works wide isn't finished. See `design.md` → *Phone and desktop*.

> Imports use the `@/` path alias (`@/* -> src/*`, configured in `tsconfig.json`).

---

## Index

| Component | Use it for | Source | Client? |
|-----------|-----------|--------|---------|
| [`Button`](#button) | Any button or button-styled link | [src/components/button.tsx](src/components/button.tsx) | no |
| [`DataGrid`](#datagrid) | **Result grid** — any table of records | [src/components/data-grid.tsx](src/components/data-grid.tsx) | yes |
| [`DataGridCompact`](#datagridcompact) | `DataGrid`'s card list below 1024px — **not called directly** | [src/components/data-grid-compact.tsx](src/components/data-grid-compact.tsx) | yes |
| [`Modal`](#modal) | **Any dialog** — overlay, panel, Esc/focus handling | [src/components/modal.tsx](src/components/modal.tsx) | yes |
| [`Comments`](#comments) | A note/instruction parked beside a feature, behind an info chip | [src/components/comments.tsx](src/components/comments.tsx) | yes |
| [`CollapsibleCard`](#collapsiblecard) | A titled section that expands/collapses | [src/components/collapsible-card.tsx](src/components/collapsible-card.tsx) | yes |
| [`Tabs`](#tabs) | One-of-N panels in the same space | [src/components/tabs.tsx](src/components/tabs.tsx) | yes |
| [`ViewModeSwitch`](#viewmodeswitch) | **Same data, re-cut** — segmented control, `<select>` when narrow | [src/components/view-mode-switch.tsx](src/components/view-mode-switch.tsx) | yes |
| [`ModuleCarousel`](#modulecarousel) | The home screen's module picker (grid on desktop, coverflow on phones) | [src/components/module-carousel.tsx](src/components/module-carousel.tsx) | yes |
| [`TwoTierShell`](#twotiershell) | **The navigation shell** — module rail + section panel + header | [src/components/two-tier-shell.tsx](src/components/two-tier-shell.tsx) | yes |
| [`ModuleRail`](#modulerail) | Tier 1 — the 64px module icon rail | [src/components/module-rail.tsx](src/components/module-rail.tsx) | yes |
| [`SectionPanel`](#sectionpanel) | Tier 2 — the 240px section panel / compact bottom sheet | [src/components/section-panel.tsx](src/components/section-panel.tsx) | yes |
| [`AppHeader`](#appheader) | Tier 3 — the utility bar: breadcrumb, global actions, profile | [src/components/app-header.tsx](src/components/app-header.tsx) | yes |
| [`NavMenus`](#navmenus) | The shared module switcher and profile dropdowns | [src/components/nav-menus.tsx](src/components/nav-menus.tsx) | yes |
| [`MusicPlayerProvider`](#musicplayerprovider) | Owns the single `<audio>` element and playback state — mount in the layout | [src/components/music-player-provider.tsx](src/components/music-player-provider.tsx) | yes |
| [`MusicPlayerBar`](#musicplayerbar) | The persistent "what's playing" strip, above the section nav on every page | [src/components/music-player-bar.tsx](src/components/music-player-bar.tsx) | yes |
| [`SelectionBar`](#selectionbar) | Tick several rows, then send them somewhere (with `useSelection`) | [src/components/selection-bar.tsx](src/components/selection-bar.tsx) | yes |
| [`ViewportSwitch`](#viewportswitch) | The global compact/full switch | [src/components/viewport-switch.tsx](src/components/viewport-switch.tsx) | yes |
| [`Avatar`](#avatar) | A user's picture, or initials fallback | [src/components/avatar.tsx](src/components/avatar.tsx) | no |
| [`TickerLogo`](#tickerlogo) | A stock/ETF logo, or a monogram fallback | [src/components/ticker-logo.tsx](src/components/ticker-logo.tsx) | yes |
| [`FileDropzone`](#filedropzone) | Drag-and-drop file picker | [src/components/file-dropzone.tsx](src/components/file-dropzone.tsx) | yes |
| [`CsvMappingTable`](#csvmappingtable) | Map a CSV's columns to target fields | [src/components/csv-mapping-table.tsx](src/components/csv-mapping-table.tsx) | yes |
| [`IconSelect`](#iconselect) | A dropdown whose options carry an image | [src/components/icon-select.tsx](src/components/icon-select.tsx) | yes |
| [`TokenPicker`](#tokenpicker) | **Several names on one record** — removable chips + a dropdown to add | [src/components/token-picker.tsx](src/components/token-picker.tsx) | yes |
| [`ColorField`](#colorfield) | **One color** — a swatch that opens the OS picker + the hex typed out | [src/components/color-field.tsx](src/components/color-field.tsx) | yes |
| [`ChartLine`](#chartline) | Time-series line chart | [src/components/chart-line.tsx](src/components/chart-line.tsx) | yes |
| [`ChartBar`](#chartbar) | Category comparison / part-to-whole | [src/components/chart-bar.tsx](src/components/chart-bar.tsx) | yes |
| [`ChartPie`](#chartpie) | Share of a whole — **max 5 slices** | [src/components/chart-pie.tsx](src/components/chart-pie.tsx) | yes |
| [`ChartXY`](#chartxy) | User-configurable line/bar/scatter/area + zoom | [src/components/chart-xy.tsx](src/components/chart-xy.tsx) | yes |
| [`ChartCandle`](#chartcandle) | Candlestick / OHLC — four prices per period | [src/components/chart-candle.tsx](src/components/chart-candle.tsx) | yes |
| [`ChartToolbar`](#chartoolbar) | A chart's gear control — **not called directly** | [src/components/chart-toolbar.tsx](src/components/chart-toolbar.tsx) | yes |
| [`UsageMeter`](#usagemeter) | A stat tile whose value is part of a known total | [src/components/usage-meter.tsx](src/components/usage-meter.tsx) | no |
| [`Progress3D`](#progress3d) | **Any progress bar** — work underway, 0..max | [src/components/progress-3d.tsx](src/components/progress-3d.tsx) | no |
| [`JournalViewer`](#journalviewer) | Full detail sheet for one journal entry | [src/components/journal-viewer.tsx](src/components/journal-viewer.tsx) | yes |
| [`PhotoLightbox`](#photolightbox) | Full-screen photo overlay with prev/next over a set | [src/components/photo-lightbox.tsx](src/components/photo-lightbox.tsx) | yes |
| [`PhotoOfTheDay`](#photooftheday--photoofthedaybutton) / `PhotoOfTheDayButton` | **Photos for a date or a date range**, as a closable dialog | [src/components/photo-of-the-day.tsx](src/components/photo-of-the-day.tsx) | yes |
| [`TickerViewer`](#tickerviewer) | Full record dialog for one ticker — 3 tabs of cards | [src/components/ticker-viewer.tsx](src/components/ticker-viewer.tsx) | yes |
| [`IconSetProvider`](#iconsetprovider--useiconset) / `useIconSet` | Active module icon set (context) | [src/components/icon-set-context.tsx](src/components/icon-set-context.tsx) | yes |
| [`ViewportProvider`](#viewportprovider--useviewport) / `useViewport` | Compact vs full layout (context) | [src/components/viewport-context.tsx](src/components/viewport-context.tsx) | yes |
| [`ModuleIcon`](#moduleicon--moduleiconpreview) / `ModuleIconPreview` | Render a module glyph | [src/components/module-icons.tsx](src/components/module-icons.tsx) | yes |
| [`SlotIcon`](#sloticon) | Render the icon for a named place in the app, honouring per-slot overrides | [src/components/slot-icon.tsx](src/components/slot-icon.tsx) | yes |
| [`IconOverrideProvider`](#iconoverrideprovider--useiconoverrides) / `useIconOverrides` | Per-slot icon overrides for the active set (context) | [src/components/icon-override-context.tsx](src/components/icon-override-context.tsx) | yes |
| [`useCurrentPosition`](#usecurrentposition) | Read the device's GPS coordinates (hook) | [src/components/use-current-position.ts](src/components/use-current-position.ts) | yes |
| [`AppVersionWatch`](#appversionwatch) | Prompts a stale installed PWA to reload after a deploy — mount in the layout | [src/components/app-version-watch.tsx](src/components/app-version-watch.tsx) | yes |

Small helpers that are not full components: [see below](#unregistered-helpers).

---

## Button

Button with a hard offset shadow that collapses on press, reading as a physical 3D
switch. **Every** clickable action uses this — do not hand-roll a `<button className=...>`.

- **Source:** [src/components/button.tsx](src/components/button.tsx)
- **Import:** `import { Button } from "@/components/button";`
- **Client component:** no (usable from a server component; it renders no hooks)

| Prop | Type | Notes |
|------|------|-------|
| `children` | `ReactNode` | Label/content. |
| `variant?` | `"primary" \| "secondary" \| "danger"` | Default `"primary"`. |
| `size?` | `"sm" \| "md"` | Default `"md"`. Use `sm` inside grids/toolbars. |
| `href?` | `string` | When set, renders a `next/link` instead of a `<button>`. |
| `type?` | `"button" \| "submit"` | Default `"button"`. Ignored when `href` is set. |
| `onClick?` | `() => void` | |
| `disabled?` | `boolean` | |
| `title?` | `string` | Native tooltip. Use it when the label is an icon or glyph. |
| `ariaLabel?` | `string` | **Required when `children` is only an icon or glyph** — a screen reader has nothing else to read. |
| `ariaExpanded?` / `ariaControls?` | `boolean` / `string` | For a button that opens a panel: its state, and the `id` it controls. `ChartToolbar`'s gear uses both. |
| `className?` | `string` | Merged last. |

```tsx
<Button onClick={handleSave}>Save</Button>
<Button size="sm" variant="secondary" onClick={() => setPanel(undefined)}>Close</Button>
<Button variant="danger" onClick={handleDelete}>Delete</Button>
<Button href="/admin">Administration</Button>
```

**Used by:** nearly every view — e.g. the home page
[src/app/(protected)/page.tsx](src/app/(protected)/page.tsx), the CSV Analysis view
[csv-analytics-view.tsx:787](src/app/(protected)/modules/[slug]/csv-analytics-view.tsx#L787).

**Notes:** `primary`/`secondary` take their fill and shadow from theme tokens; `danger`
stays a fixed semantic red across every color theme. Respects `prefers-reduced-motion`.

---

## DataGrid

**This is the "result grid."** The generic table for any list of records: search,
per-column filters with comparison operators, sortable sticky headers,
show/hide/reorder/resize columns, a row-density control, per-column footer totals,
optional row selection with bulk actions, a single-record modal, pagination, CSV export,
and an optional "Show SQL" re-run dialog. Do not build another table.

- **Source:** [src/components/data-grid.tsx](src/components/data-grid.tsx)
- **Import:** `import { DataGrid, type DataGridColumn } from "@/components/data-grid";`
  (also exports `type CellValue`, `type PageSize`, `type Density`, `type AggregateKind`)
- **Client component:** yes — the caller must be `"use client"` (or render it from one).
- **Mechanics live in the lib:** sorting/searching/filtering/paging/CSV are pure functions
  in [src/lib/shared/table.ts](src/lib/shared/table.ts) (unit-tested). The component holds
  only view state. Fix table *behaviour* in the lib, not here.

### Column shape — `DataGridColumn<T>`

| Field | Type | Notes |
|-------|------|-------|
| `key` | `string` | Unique; React key + sort identity. |
| `header` | `string` | |
| `render` | `(row: T) => ReactNode` | The cell UI. |
| `value?` | `(row: T) => CellValue` | **The important one.** Raw primitive used for sort, search, filter, CSV export and the footer total. A column participates in those *only* when this is supplied. |
| `sortable?` | `boolean` | Set `false` to keep `value` but disable sorting. |
| `className?` | `string` | Applied to both header and body cells. |
| `aggregate?` | `"sum" \| "avg" \| "min" \| "max" \| "count"` | Show a rollup in the table footer. Requires `value`. |
| `formatAggregate?` | `(result: number) => ReactNode` | Formats that total, e.g. `(cents) => formatCents(cents)`. Defaults to `toLocaleString()`. |
| `minWidth?` | `number` | Resize floor in pixels. Default `64`. |
| `excludeFromRecordView?` | `boolean` | Keep this column out of the record modal. **Set it on action columns** — a row's Edit/Delete buttons don't belong in a read-out of the record. |

### Grid props — `DataGridProps<T>`

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `columns` | `DataGridColumn<T>[]` | — | |
| `rows` | `T[]` | — | Already-fetched data. The grid never fetches. |
| `getRowKey` | `(row: T) => string \| number` | — | Stable row identity (React key + selection). |
| `emptyMessage?` | `string` | `"No rows to show."` | |
| `defaultPageSize?` | `number \| "ALL"` | `100` | Paging appears once rows exceed it. |
| `enableExport?` | `boolean` | `true` | "Export CSV" shows only if some column has `value`. |
| `exportFileName?` | `string` | `"export"` | Without extension. |
| `showStatusBar?` | `boolean` | `true` | The footer bar: record count, per-page, paging, Export CSV, Show SQL. `false` for a bare grid. |
| `showToolbar?` | `boolean` | `true` | The whole controls row at once — search, Filters, Columns, Rows (and on a phone, Sort by). `false` for a dashboard card where the row is pure chrome. |
| `enableSearch?` | `boolean` | `true` | |
| `enableColumnFilters?` | `boolean` | `true` | Per-column filter row, hidden until opened. |
| `enableColumnPicker?` | `boolean` | `true` | Show/hide/reorder panel. |
| `enableColumnResize?` | `boolean` | `true` | Drag a header's right edge; double-click it to restore auto width. |
| `enableDensity?` | `boolean` | `true` | Compact/normal/comfortable row-height control. |
| `defaultDensity?` | `Density` | `"normal"` | |
| `stickyHeader?` | `boolean` | `true` | |
| `maxHeight?` | `string` | `"70vh"` | Pass `""` to remove the cap. |
| `enableSelection?` | `boolean` | `false` | Adds a checkbox column. |
| `renderSelectionActions?` | `(selectedRows: T[], clearSelection: () => void) => ReactNode` | — | Bulk actions in the toolbar. Select-all covers the whole filtered set. |
| `enableRecordView?` | `boolean` | `true` | Per-row button opening the whole record in a `Modal`. |
| `recordViewTitle?` | `(row: T) => string` | `"Record"` | Heading for that modal. |
| `storageKey?` | `string` | — | Persists the view (order, hidden, widths, density, sort, page size) to `localStorage`. **Not** search/filters. |
| `onRowClick?` | `(row: T) => void` | — | Makes rows clickable/keyboard-focusable for "open this record". |
| `sql?` | `string` | — | With `onRunSql`, adds a "Show SQL" button. |
| `onRunSql?` | `(sql: string) => void \| Promise<void>` | — | Called with the edited query; **the caller runs it** and passes fresh `rows` back. |

```tsx
"use client";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";

const columns: DataGridColumn<Quote>[] = [
  { key: "text", header: "Quote", render: (row) => row.text, value: (row) => row.text },
  { key: "author", header: "Author", render: (row) => row.author, value: (row) => row.author },
  {
    key: "actions",
    header: "Actions",
    render: (row) => (
      <Button size="sm" variant="secondary" onClick={() => setEditing(row)}>Edit</Button>
    ),
  },
];

<DataGrid
  columns={columns}
  rows={quotes}
  getRowKey={(row) => row.id}
  emptyMessage="No quotes yet."
  exportFileName="daily-quotes"
/>;
```

Row-click navigation:

```tsx
<DataGrid
  columns={columns}
  rows={entries}
  getRowKey={(entry) => entry.id}
  onRowClick={(entry) => router.push(`/modules/journal/entries/${entry.id}`)}
/>
```

**Used by:**
- Daily Quote admin — [daily-quote/view.tsx:209](src/app/(protected)/admin/daily-quote/view.tsx#L209) *(simplest example, start here)*
- MyJournal — [journal-view.tsx:220](src/app/(protected)/modules/[slug]/journal-view.tsx#L220) *(row click + "Show SQL" re-run)*
- User Management — [user-management/view.tsx](src/app/(protected)/admin/user-management/view.tsx) *(cells rendering `Avatar`)*
- Expense transactions — [expense-transactions-view.tsx](src/app/(protected)/modules/[slug]/expense-transactions-view.tsx) *(row selection + bulk edit/delete)*
- Stocks & ETFs simulation — [stock-simulation-view.tsx](src/app/(protected)/modules/[slug]/stock-simulation-view.tsx) *(a fixed ten-row table: `showToolbar={false}` with `defaultPageSize="ALL"`, keeping sort and the status bar's CSV export)*
- CSV Analysis, SQL Explorer, Stocks & ETFs (accounts / positions / watchlist / analytics / next-day actions)

**Filter operators.** A column filter box is a substring match by default, and also
understands `>100`, `>=100`, `<50`, `<=50`, `!=new`, `=new` (exact) and `100..200` /
`2026-07-01..2026-07-31` ranges (inclusive, and open-ended as `100..` or `..100`). Bounds
compare numerically when both sides look numeric and as text otherwise, which is what
makes the operators work on ISO dates for free. A half-typed operator (`>` alone) matches
everything rather than blanking the grid. The parsing is
[`parseFilterExpression`](src/lib/shared/table.ts) — extend it there, with tests, not here.

**Footer totals.** Set `aggregate` on a column to get a `<tfoot>` rollup, computed over the
filtered set across **all pages** (the same scope Export CSV uses), not just the page on
screen. `aggregate` skips nulls rather than treating them as zero, and ignores values that
aren't numeric, so one stray `"n/a"` can't turn a total into `NaN`.

**Resizing.** Fixed table layout is applied **only once a grid has stored widths**, so a
grid nobody has dragged still auto-sizes to its content exactly as before. The first drag
measures every column's current width and pins them all, so pinning one column doesn't
re-flow the rest. "Reset" in the Columns panel clears widths, order and hidden together.

**Notes:** headers sit in a raised `bg-brass-soft` bar and are click-to-sort
(asc → desc → none) for columns with `value`; rows alternate `bg-paper`/`bg-paper-raised`.
The footer is a raised status bar: record count (noting "filtered from N"), page-size
selector (10…1000/ALL, plus whatever `defaultPageSize` is set to), and prev/next. Export
reflects the current filter + sort across all pages. Selection is **pruned to the filtered
set** — changing the search or a filter drops ticks for rows that no longer match, so
"12 selected" always equals what a bulk action will touch. For `enableSelection`, copy the
Expense transactions grid
([expense-transactions-view.tsx](src/app/(protected)/modules/[slug]/expense-transactions-view.tsx)):
`renderSelectionActions` gets the selected rows plus a `clearSelection` callback — keep
hold of that callback if the action opens a dialog, and call it once the write lands so
the ticks don't outlive the rows they referred to.

**Below 1024px it isn't a table.** `DataGrid` is a thin dispatcher: it reads
`useIsCompact()` and renders either the full table or [`DataGridCompact`](#datagridcompact).
Call sites are unchanged and don't choose.

---

## DataGridCompact

**`DataGrid`'s compact form — one card per row.** You do not call this; `DataGrid`
delegates to it below 1024px, so every grid in the app gets it for free.

- **Source:** [src/components/data-grid-compact.tsx](src/components/data-grid-compact.tsx)
- **Client component:** yes

Not a narrower table — a different shape. The Positions grid is **1498px wide**; on a
390px phone that is four screens of horizontal dragging to read one row, and restyling
can't fix it, because a table's premise is that columns line up across rows and there is
room for them to. A card drops that premise: the first column becomes the heading (the
thing that identifies the record) and the rest become label/value pairs.

**It implements a deliberate subset** — search, sort and row click. Column
reorder/resize, per-column filters, CSV export, density and selection stay on the full
layout: they need a pointer and a wide screen, and cramming them in would recreate the
problem.

**Two things worth knowing if you touch it:**
- It renders **50 cards at a time** with a "Show more" button. The full grid paginates;
  without a cap a few thousand expense rows would become a few thousand cards, freezing
  exactly the hardware least able to absorb it.
- `DataGrid` dispatches to it as a **sibling component, not an early return**. The full
  implementation calls fifteen-odd hooks, and returning before them would change the hook
  count when the viewport flips — which it does, once, when the width corrector overrules
  the User-Agent guess.

---

## Modal

**Any dialog.** The dimmed overlay, the centred panel, the title, and the keyboard and
focus behaviour every dialog needs. Do not hand-roll another `fixed inset-0` overlay —
that's what this was extracted from.

- **Source:** [src/components/modal.tsx](src/components/modal.tsx)
- **Import:** `import { Modal } from "@/components/modal";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `title` | `string` | Heading, and the dialog's accessible name. |
| `description?` | `ReactNode` | Sub-heading under the title — context, not actions. |
| `children` | `ReactNode` | The body. The only part that scrolls. |
| `footer?` | `ReactNode` | Bottom-right action bar; pass `Button`s in reading order. |
| `onClose` | `() => void` | Fired by Escape, an overlay click, and the ✕. |
| `size?` | `"sm" \| "md" \| "lg" \| "full" \| "window"` | Default `"md"` (`max-w-2xl`). `"full"` fills the viewport edge to edge; `"window"` is the draggable 80% floating variant (below). |
| `isBusy?` | `boolean` | Suppresses Escape / overlay-click / ✕ while a write is in flight. |
| `className?` | `string` | Applied to the panel, merged last. |

```tsx
{isEditing && (
  <Modal
    title="Bulk edit 12 transaction(s)"
    description="Ticked fields are applied to every selected row."
    onClose={() => setIsEditing(false)}
    isBusy={isSaving}
    footer={
      <>
        <Button variant="secondary" onClick={() => setIsEditing(false)} disabled={isSaving}>Cancel</Button>
        <Button onClick={handleApply} disabled={isSaving}>Apply</Button>
      </>
    }
  >
    <FieldList />
  </Modal>
)}
```

**Used by:** `DataGrid`'s record view and "Show SQL" dialog
[data-grid.tsx](src/components/data-grid.tsx), the Expense bulk-edit dialog
[expense-transactions-view.tsx](src/app/(protected)/modules/[slug]/expense-transactions-view.tsx),
and the ticker viewer [ticker-viewer.tsx](src/components/ticker-viewer.tsx) — the only
caller of `size="window"`.

`size="full"` drops the overlay's gutter and the panel's rounding so nothing of the page
shows around it. It is still a dialog — Escape, the ✕, the focus trap and the body-scroll
lock all behave identically — so it returns the reader to the screen underneath rather than
being a route they have to navigate back from. Don't use it for a form.

**`size="window"` — the floating variant.** 80vw × 80vh, centred, rounded, **draggable by
its header**, with a maximize button beside the ✕ that swaps it to the `full` treatment and
back. This is the one to reach for on a whole-record viewer (`TickerViewer`): a reader
comparing the dialog against the page behind it can now shove it aside instead of closing
and reopening.

It is **still a modal** — the dimmed overlay, Escape, the focus trap, `aria-modal` and the
scroll lock are all unchanged, so the page behind stays visible but inert. Three details
worth knowing before reusing it:

- **The drag is clamped** so at least 140px of the panel and the full height of the header
  stay on screen, and the header can never go above the top edge. The header is the only
  handle, so a window dragged clean off the viewport would be unrecoverable.
- **Position and maximized-ness reset every time it mounts.** Nothing is persisted.
- **Presses on the header's buttons aren't drags** — the handler ignores any pointerdown
  landing on a `button`/`a`/input, so put header controls in freely.

```tsx
<Modal title={ticker} size="window" onClose={onClose}>
  <TickerBody />
</Modal>
```

**Notes:** it owns **no** open/closed state — the caller decides whether to render it, so
guard it with `{isOpen && <Modal …>}`. On mount it focuses the first focusable element in
the panel and restores focus to whatever was focused before on unmount; Tab cycles inside
the panel; `body` scrolling is locked while it's up. An overlay click only dismisses when
the click both starts and ends on the overlay, so dragging a text selection out of the
panel doesn't close it.

---

## Comments

**A note or instruction parked next to a feature.** A small info chip; pressing it opens
the text in a dialog. Reach for this when a control needs
explaining but the explanation isn't worth permanent screen space — the chip costs a line
of nothing, where the same copy inline pushes the feature itself down the page.

- **Source:** [src/components/comments.tsx](src/components/comments.tsx)
- **Import:** `import { Comments } from "@/components/comments";`
- **Client component:** yes (it owns whether the dialog is open)

| Prop | Type | Notes |
|------|------|-------|
| `title` | `string` | The dialog heading, **and** the chip's accessible name when there's no visible `label`. |
| `content` | `ReactNode` | The note. `ReactNode` not `string`, so it can carry a list or emphasis; a plain string is the common case. |
| `label?` | `string` | Text beside the glyph. Omit for an icon-only chip. |
| `icon?` | `"info" \| "note" \| "clip"` | Default `"info"` — the circled "i", the near-universal mark for "explanatory text lives here". `"note"` (sticky note) and `"clip"` (paper clip) are for content that's genuinely a jotting or an attachment rather than an explanation. |
| `size?` | `"sm" \| "md"` | Dialog width, forwarded to `Modal`. Default `"sm"`. |
| `className?` | `string` | Merged last. |

```tsx
<Comments
  title="Instructions"
  label="How this works"
  content="Positions can be typed in by hand or imported from a broker CSV."
/>
```

Icon-only, beside a heading — `title` is the accessible name, so nothing is lost:

```tsx
<h2 className="flex items-center gap-2 font-display text-lg text-ink">
  Next-day actions
  <Comments title="How the scan works" content={<ScanNotes />} />
</h2>
```

**Used by:** the home screen's Today In History card
[today-in-history-widget.tsx](<src/app/(protected)/today-in-history-widget.tsx>), in
`CollapsibleCard`'s `headerAction` slot — that combination is the one to copy for a
dashboard card, since the chip stays reachable while the card is collapsed and pressing it
doesn't toggle the card. Also the Stocks dashboard's refresh control
[stock-refresh-control.tsx](src/app/(protected)/modules/[slug]/stock-refresh-control.tsx),
where a `title="Note"` chip sits beside the section heading and explains what the refresh
icon next to it does.

**Notes:** the chip is the low-emphasis `bg-brass-soft` / `text-brass-dark` badge from
`design.md`, **not** a `Button` — this is an aside beside a heading, and the hard offset
shadow would read as the section's primary action. It inherits every dialog behaviour from
[`Modal`](#modal) (Escape, overlay click, focus trap, scroll lock), so don't add key
handling here.

**Below 1024px:** unchanged, it's small already. `py-1.5` on a 16px glyph puts the hit area
near the 44px comfortable tap target, and `Modal`'s `sm` is `w-full max-w-md`, which fits a
390px screen.

All three glyphs come from [`tree-icons.tsx`](src/components/tree-icons.tsx) — `info` was
already there for Admin's About page; `note` and `clip` were added alongside this component
rather than living in it, so they're available to `SectionPanel` and anything else using
`TreeIcon` and the app keeps exactly one glyph registry.

---

## CollapsibleCard

A titled card whose body expands/collapses. The standard wrapper for a secondary section
(a form, a settings block, a detail panel) that shouldn't dominate the page.

- **Source:** [src/components/collapsible-card.tsx](src/components/collapsible-card.tsx)
- **Import:** `import { CollapsibleCard } from "@/components/collapsible-card";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `title` | `string` | Always-visible header text. **Plain text, not HTML** — write `&` not `&amp;`. |
| `titleIcon?` | `ReactNode` | Small decorative glyph before the title, inside the toggle. Takes the accent colour and stays `shrink-0`, so a long title truncates around it. **Decorative only** — the title text is the accessible name, so pass an `aria-hidden` icon (`TreeIcon` already is). |
| `defaultOpen?` | `boolean` | Default `false`. Ignored when `open` is supplied. |
| `open?` | `boolean` | Supply with `onOpenChange` for controlled use; omit both to let the card own its state. |
| `onOpenChange?` | `(open: boolean) => void` | Called with the state being moved to. |
| `headerAction?` | `ReactNode` | Rendered on the title line, left of the chevron, **always visible**. Clicking it does not toggle the card. |
| `children` | `ReactNode` | Body. |
| `className?` | `string` | Merged last, so it wins. The hook for the opt-in surface treatments below. |

```tsx
<CollapsibleCard title="Add an entry" defaultOpen>
  <JournalEntryForm onSubmit={handleCreate} />
</CollapsibleCard>
```

With a glyph on the title line — reuse an existing icon rather than hand-rolling
a second one ([`TreeIcon`](src/components/tree-icons.tsx) covers `history`,
`chart`, `list`, `quote`…):

```tsx
<CollapsibleCard title="Daily Quote" titleIcon={<SlotIcon slot={QUOTE_SLOT} className="h-4 w-4" />}>
  <Quote quote={quote} />
</CollapsibleCard>
```

When the card belongs to a *module* — a dashboard card summarising one module's
data — badge it with that module's own icon instead, so the source is obvious at
a glance. The icon name is a DB column, so pass it down from the server rather
than hard-coding a glyph (the home screen's Today In History and Daily Glance
cards both do this):

```tsx
<CollapsibleCard title="Daily Glance" titleIcon={icon && <ModuleIcon name={icon} className="h-4 w-4" />}>
```

**Nesting is allowed, one level.** A card can hold a child card when the child is a
*subset of the same subject* the parent names — the Stocks & ETFs dashboard's
Portfolio Summary holds a collapsed "Portfolio History" this way, so the headline
numbers stay visible while the chart and the snapshot table are one click away.
Give the child `className="mt-6"` to separate it from the body above it, and keep
the parent open by default so the child's header is reachable without two clicks.
Don't go deeper than one level, and don't nest just to group unrelated cards — a
flat stack of siblings (see [TickerViewer](#tickerviewer)) is the pattern for that:

```tsx
<CollapsibleCard title="Portfolio Summary" defaultOpen>
  <PortfolioHeadlineNumbers summary={summary} />
  <CollapsibleCard title="Portfolio History" className="mt-6">
    <ValueChart /> <SnapshotGrid />
  </CollapsibleCard>
</CollapsibleCard>
```

Controlled, with an action that stays reachable while collapsed:

```tsx
<CollapsibleCard
  title="Risks"
  open={isOpen}
  onOpenChange={setIsOpen}
  headerAction={<Button size="sm" onClick={handleRun}>Recalculate</Button>}
>
  <RiskPanel />
</CollapsibleCard>
```

### Surface treatments (opt-in, via `className`)

The card's resting lift is `.card-raised` + `.card-raised-hover`, applied by the component
itself. Two treatments layer on top of it, both opted into through `className` so no prop
and no signature changes — see [design.md](design.md) for the full elevation table.

- **`.card-embossed`** — a bevel, for a card that should read as a **thick slab** rather
  than a sheet just off the page: lit top edge, shadowed underside, deeper cast. Built
  without `Button`'s hard offset on purpose, so it gains depth without reading as
  something you press. Reads subtler on the light themes (Daybreak, Sea Glass), where a
  white card has little to bevel against — that is accepted, not a bug.
- **`.paper-texture`** — a physical-sheet grain, for a card you *write into*. Texture, not
  hierarchy; if the goal is standing out, that's `.card-embossed`.

They compose, and neither needs a layout change — the cast is drawn outside the border box.

```tsx
<CollapsibleCard title="Portfolio Summary" defaultOpen className="card-embossed">
  <Summary />
</CollapsibleCard>
```

**Used by:** Module Configuration
[admin/configuration/modules/page.tsx](src/app/(protected)/admin/configuration/modules/page.tsx),
MyJournal, CSV Analysis, SQL Explorer, Stocks & ETFs, User Management, the About
screen's "Application & System Info" card
[admin/about/view.tsx](src/app/(protected)/admin/about/view.tsx), and all three home-screen
cards — Daily Quote, Today In History and Daily Glance
[page.tsx](<src/app/(protected)/page.tsx>). For the controlled + `headerAction`
combination, see the ticker viewer's Risks card
[ticker-viewer.tsx](src/components/ticker-viewer.tsx) and the home screen's Daily Quote
[daily-quote-widget.tsx](<src/app/(protected)/daily-quote-widget.tsx>).

Also both tabs of the ticker viewer
[ticker-viewer.tsx](src/components/ticker-viewer.tsx) — three cards on "Our data",
four on "Market", all `defaultOpen`. That dialog used to nest a second tab strip
inside the first; **a stack of open cards replaced it** because the sub-tabs hid
sections a reader wanted side by side and gave no clue which ones had anything in
them. Its Risks card is the uncontrolled counterpart to the refresh card above:
`headerAction` holds Recalculate, which stays clickable while the card is shut.

**Notes:** `headerAction` exists as a slot because the header used to be one big
`<button>`, and a button can't nest inside a button. The header is now a flex row: a
toggle button that takes the free space (so the chevron still sits right when there's no
action) plus the action beside it. **A card that starts collapsed but owns a
long-running action should be controlled and open itself when that action starts** —
otherwise the progress and result render out of sight.

---

## Tabs

One active panel at a time. Owns its own active-tab state.

- **Source:** [src/components/tabs.tsx](src/components/tabs.tsx)
- **Import:** `import { Tabs, type TabItem } from "@/components/tabs";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `items` | `TabItem[]` — `{ key, label, content: ReactNode }` | Rendered in order. |
| `defaultActiveKey?` | `string` | Defaults to the first item. |
| `className?` | `string` | |

```tsx
const tabs: TabItem[] = [
  { key: "positions", label: "Positions", content: <PositionsGrid rows={positions} /> },
  { key: "history", label: "History", content: <ChartLine data={history} series={series} xKey="date" /> },
];

<Tabs items={tabs} defaultActiveKey="positions" />
```

**Used by:** Stocks & ETFs —
[stock-positions-view.tsx](src/app/(protected)/modules/[slug]/stock-positions-view.tsx),
[stock-analytics-view.tsx](src/app/(protected)/modules/[slug]/stock-analytics-view.tsx);
the About screen's Application / Change History split
[admin/about/view.tsx](src/app/(protected)/admin/about/view.tsx); the Expense module's
Charts and Analysis Main / Monthly comparison split
[expense-charts-view.tsx](src/app/(protected)/modules/[slug]/expense-charts-view.tsx).

---

## ViewModeSwitch

**Same data, shown a different way.** A segmented control for a set of mutually
exclusive ways to look at one dataset — "view by account / billing cycle / vendor".

**Not `Tabs`.** Tabs put *different content* in one space and read as separate places;
this reads as one dataset being re-cut. Rule of thumb: if every option answers the same
question about the same rows, use this; if the panels hold unrelated things, use `Tabs`.

Below 1024px it renders a full-width native `<select>` instead of the segmented row — at
four or five options the segments would wrap into a ragged block, and a native picker is
easier to hit. Done with `max-lg:` / `lg:` on two elements rather than `useIsCompact()`,
so the desktop classes provably can't regress.

- **Source:** [src/components/view-mode-switch.tsx](src/components/view-mode-switch.tsx)
- **Import:** `import { ViewModeSwitch, type ViewModeOption } from "@/components/view-mode-switch";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `options` | `readonly ViewModeOption<K>[]` — `{ key, label, hint? }` | Rendered in order. `hint` is the native tooltip. |
| `value` | `K` | The selected key. Controlled — the caller owns the state. |
| `onChange` | `(key: K) => void` | |
| `label` | `string` | Shown before the control; also the group's accessible name. |
| `className?` | `string` | |

Generic over the key type, so a caller's own union (`TransactionGroupBy`) survives the
round trip and `onChange` hands back that type rather than `string`.

```tsx
const [groupBy, setGroupBy] = useState<TransactionGroupBy>("all");

<ViewModeSwitch
  options={VIEW_MODE_OPTIONS}
  value={groupBy}
  onChange={setGroupBy}
  label="View"
/>
```

Rendered as a `radiogroup` with `aria-checked` per segment, since one of a set of
mutually exclusive choices is what a radio is — and the visual fill alone doesn't
convey the state to a screen reader.

**Used by:** Expense — the Transactions screen's All / Account / Billing cycle / Vendor /
Category switcher
[expense-transactions-view.tsx](src/app/(protected)/modules/[slug]/expense-transactions-view.tsx).

---

## ModuleCarousel

**The home screen's module picker.** On `full` (desktop) it's a **wrapping grid** of every
module's tile — name above, description below, image or icon glyph in the tile, and the
whole tile is the launch target. Below 1024px it switches to a **coverflow**: the selected
module centred and full size, its neighbours scaled down and dimmed either side, with the
title above the graphic and the description below it and the centred graphic as the launch
target. Which one renders is `useIsCompact()`, not a prop — callers don't choose.

- **Source:** [src/components/module-carousel.tsx](src/components/module-carousel.tsx)
- **Import:** `import { ModuleCarousel, type CarouselModule } from "@/components/module-carousel";`
- **Client component:** yes (selection state, keyboard and touch handling, `useIconSet()`)

| Prop | Type | Notes |
|------|------|-------|
| `modules` | `CarouselModule[]` — `{ slug, name, description?, icon, href, hasImage?, imageVersion? }` | Plain data, not module records: the page is a server component and this is a client island. |
| `initialIndex?` | `number` | Which starts selected. Clamped. Defaults to the first. |
| `className?` | `string` | |

```tsx
<ModuleCarousel
  className="mt-8"
  modules={modules.map((appModule) => ({
    slug: appModule.slug,
    name: appModule.longName,
    description: appModule.description,
    icon: appModule.icon,
    href: `/modules/${appModule.slug}`,
  }))}
/>
```

**Used by:** the home screen — [src/app/(protected)/page.tsx](src/app/(protected)/page.tsx).
It replaced a grid of `ModuleCard`s, which was deleted with its last caller — and then grew
its own grid back for `full`, once the coverflow's one-at-a-time reveal turned out to cost a
desktop visitor more clicks than it saved: with the width to show every module at once,
scaling one up and dimming the rest bought nothing.

**Rotating (compact only).** Prev/next buttons, ← / → while the carousel has focus, clicking
a neighbour, tapping a dot, or swiping. It **wraps** — with only a handful of modules a dead
arrow at either end reads as a bug. It does **not** auto-advance: nav that moves on its own
steals focus and slides the click target out from under the cursor. The grid has no
selection to rotate, so the keydown handler is a no-op on `full`.

**Only the centre is a link.** It's a real `<Link>`, so middle-click and ⌘-click still
work; the neighbours are buttons that only change the selection, and they're `tabIndex={-1}`
because the arrows and dots already cover keyboard selection.

**Three geometry decisions worth keeping:**
- Ring offsets are **pixels, not percentages**. A percentage `translateX` resolves against
  the element's own width, which made the gap change with the tile size and let the
  neighbours overlap the centre.
- On an **even** wheel the item directly opposite the selection isn't drawn. It's
  equidistant both ways, so it can't be placed on a side without sitting alone and
  lopsided — with four modules it stranded one icon out to the right. Not applied below
  four, where it would leave a two-module carousel showing one module.
- Title and description have a fixed `min-height`, so a one-line and a two-line name don't
  shunt the artwork up and down as you rotate.

**The graphic, in priority order.** An **uploaded image** if the module has one
(`hasImage`), otherwise the module's **icon glyph** at ~200px.

- Upload one per module at **Admin → Configuration → Modules**. Stored in
  `sys_modules.carousel_image` and fetched by the browser from
  `/api/modules/<slug>/carousel-image` — `hasImage` is a boolean and `imageVersion` a
  timestamp, so **no page ever carries the bytes**. `imageVersion` is the cache-buster;
  without it a replaced image lingers for the route's 5-minute `max-age`.
- With no upload, how good the glyph looks depends on the icon set: pick `fluent-3d` or
  `flat-color` in Admin → Display Settings → Icons and it renders as real artwork rather than
  a blown-up line icon.

**Notes:** the tile behind a *glyph* is a solid-accent square for monochrome icon sets and
a neutral `bg-paper` one for colorful sets (`useIconSet().colorful`, the same rule the
sidebar badge uses). An uploaded image always gets the neutral tile and `object-cover` —
tinting somebody's artwork would be wrong. The grid's tiles follow the same rule.

**The `full` grid** is `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`, each tile a 128px square
image/glyph over a centred name and description, the whole card a `<Link>` (so middle-click
and ⌘-click work, same as the coverflow's centre tile) with a hover background. The active
module's name in the coverflow header additionally gets a slight `rotateX` + `translateZ`
under `perspective`, purely decorative — it has no effect on hit-testing or layout.

---

## TwoTierShell

**The navigation shell for all new work.** Composes the three tiers — module rail, section
panel, utility header — and owns the state that ties them together. A module shell hands it
data and gets the chrome placed for it. Full design rationale:
[`design.md` → Navigation: the two-tier shell](design.md#navigation-the-two-tier-shell).

- **Source:** [src/components/two-tier-shell.tsx](src/components/two-tier-shell.tsx)
- **Import:** `import { TwoTierShell } from "@/components/two-tier-shell";`
- **Client component:** yes (panel state, `localStorage`, the compact fork)

| Prop | Type | Notes |
|------|------|-------|
| `links` | `NavLink[]` | Every module the reader can reach — tier 1. |
| `sections` | `SectionNode[]` | The current module's sections — tier 2. One level of `children` is supported. |
| `module` | `{ name; icon; href }` | Badged in the panel, first crumb in the breadcrumb. Both fields are admin-editable, so read them from the module row. |
| `currentUser` | `{ id; fullName; avatarMimeType?; updatedAt? }` | For the profile menu. |
| `showAdmin` | `boolean` | Whether the menu offers Administration. |
| `logoutAction` | `() => Promise<void>` | Server action, passed through to the profile menu. |
| `viewportPinned` | `boolean` | Whether the reader pinned the layout by hand. |
| `extraCrumbs` | `Breadcrumb[]` | Appended after `[Module] › [Section]` — a record's name, say. Rarely needed. |
| `headerActions` | `ReactNode` | **Whole-app** actions only. Page actions belong on the page. |

**Usage** — from a server component that can read `deps`, as in
[`stock-shell.tsx`](src/app/(protected)/modules/[slug]/stock-shell.tsx):

```tsx
<TwoTierShell links={links} sections={sections} module={{ name, icon, href }} ...>
  {children}
</TwoTierShell>
```

**Don't place the tiers yourself.** Their widths are published as CSS variables and
`.app-main`'s padding is derived from them; a caller positioning a tier by hand becomes the
fourth thing that has to agree on 64px and the first to drift.

**Responsive:** has a compact mode — the rail becomes a dropdown in the header and the
panel becomes a bottom sheet. That fork is a genuinely different component, which is why it
reads `useIsCompact()` rather than `max-lg:`.

---

## ModuleRail

Tier 1: a 64px icon-only column of modules, fixed to the left edge. Renders on the `full`
layout only — `TwoTierShell` swaps in a dropdown on compact.

- **Source:** [src/components/module-rail.tsx](src/components/module-rail.tsx)
- **Import:** `import { ModuleRail } from "@/components/module-rail";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `links` | `ModuleRailLink[]` | `{ slug, name, href, icon, hint? }`. |
| `isActive` | `(href: string) => boolean` | Supplied by the shell, which owns the pathname. |

Active state is a tint **and** an accent edge bar — at 64px with no label, a tint alone is
easy to miss. The width comes from `--module-rail-width`; never hardcode `64px`.

**Responsive:** renders `null` on compact by the shell's choice, rather than restyling.

---

## SectionPanel

Tier 2: the current module's sections. **Two shapes, picked by layout** — a fixed 240px
column on `full`, a bottom trigger row plus a sheet on compact.

- **Source:** [src/components/section-panel.tsx](src/components/section-panel.tsx)
- **Import:** `import { SectionPanel, type SectionNode } from "@/components/section-panel";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `sections` | `SectionNode[]` | `{ id, label, href, hint?, icon?, children? }`. |
| `module` | `{ name; icon }` | Named in words at the head — this is what keeps the icon-only rail honest. |
| `activeHref` | `string` | Usually the pathname. |
| `isCompact` | `boolean` | Passed down by the shell, not read here. |
| `isOpen` / `onOpenChange` | `boolean` / `(open) => void` | Desktop only; the header's `»` is the way back. |

**Open or closed — there is no middle state**, deliberately unlike the old `TreeNav`'s
full/rail/strip. A 64px icon rail for sections beside the 64px rail for modules is two
ambiguous glyph columns side by side.

Nested groups are an accordion on desktop and **flattened away on compact** — a phone has
no room for a second level, and a dropped heading costs nothing when every child is one tap
away. `flattenSections` is exported for callers that need the same list.

**Responsive:** has a compact mode (bottom sheet, ~44px touch targets, safe-area padding).

---

## AppHeader

Tier 3: a slim utility bar carrying the breadcrumb, whole-app actions and the profile menu.

- **Source:** [src/components/app-header.tsx](src/components/app-header.tsx)
- **Import:** `import { AppHeader, type Breadcrumb } from "@/components/app-header";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `crumbs` | `Breadcrumb[]` | `{ label, href?, icon? }`. The last is the current page and never a link. |
| `moduleSwitcher` | `ReactNode` | Compact folds the module dropdown in here. |
| `actions` | `ReactNode` | Whole-app actions only — search, notifications. |
| `profile` | `ReactNode` | The shell passes `UserMenu`, so this file doesn't import auth. |
| `onExpandPanel` | `() => void` | Renders the `»` that restores a collapsed panel. |

**The breadcrumb is load-bearing.** With the panel collapsed it is the only thing naming the
current section in words — don't drop it to make room.

**Responsive:** `sticky`, not `fixed` — it sits inside the content column, so one
`padding-left` on `.app-main` positions it and the page body together.

---

## NavMenus

The two dropdown menus the navigation shares. Both are placed by
[`TwoTierShell`](#twotiershell) — you rarely render them directly.

- **Source:** [src/components/nav-menus.tsx](src/components/nav-menus.tsx)
- **Import:** `import { ModuleMenu, UserMenu, type NavLink } from "@/components/nav-menus";`
- **Client component:** yes (both own dropdown open/close state)

| Export | What |
|---|---|
| `ModuleMenu` | The compact layout's module switcher, folded into `AppHeader`. Props: `links: NavLink[]`, `isActive: (href) => boolean`. |
| `UserMenu` | The profile menu — account, layout switch, Administration, log out. Props: `currentUser`, `showAdmin`, `logoutAction`, `viewportPinned`, `isAdminRoute`. |
| `NavLink` | `{ slug, name, href, icon, hint? }` — one module, shared by the rail and the menu. |

This file was `AppChrome`, a top bar on every page. That bar is gone with the move to the
two-tier shell; these two menus survived because both are still needed and neither belongs
to a single tier. They stay in one file because they share `useDropdown` and the
`menuItem`/`menuPanel` classes, which is what makes them read as one pattern.

**Responsive:** unchanged at both layouts — they're dropdowns, already small. `ModuleMenu`
is only *rendered* on compact, but that's the shell's call, not a style fork.


## TickerLogo

A stock or ETF's logo beside its symbol, falling back to the symbol's initials.

- **Source:** [src/components/ticker-logo.tsx](src/components/ticker-logo.tsx)
- **Import:** `import { TickerLogo } from "@/components/ticker-logo";`
- **Client component:** yes (it swaps to the fallback on the image's `onError`)

| Prop | Type | Notes |
|------|------|-------|
| `ticker` | `string` | Upper-cased internally; only `A-Z0-9.-` symbols resolve. |
| `size?` | `number` | Pixel square. Default `24`; use `20` in dense grids. |
| `className?` | `string` | Merged last. |

```tsx
{
  key: "ticker",
  header: "Ticker",
  value: (row) => row.ticker,
  render: (row) => (
    <span className="flex items-center gap-2">
      <TickerLogo ticker={row.ticker} />
      {row.ticker}
    </span>
  ),
}
```

**Used by:** the Stocks & ETFs grids — positions and transactions
[stock-positions-view.tsx](src/app/(protected)/modules/[slug]/stock-positions-view.tsx),
plus the watch list, analytics and next-day-actions views.

**Notes:** points at `/api/stocks/tickers/<ticker>/logo`, which downloads the logo on
first request and caches it in `stk_ticker_logos` (bytes in the DB, never in a page
payload). **A missing logo is the normal case** — most ETFs have none — so the route
answers 404 and the component draws the monogram; a "nothing found" result is cached so
the same ticker isn't re-requested on every render. Images are `loading="lazy"`, so a
long grid only fetches what's on screen.

---

## AppVersionWatch

Notices that this client is running an older build than the server serves, and offers a
reload that actually picks up the new one. **Mount once in the root layout** — it is not a
page-level component, and a second instance would mean two prompts.

- **Source:** [src/components/app-version-watch.tsx](src/components/app-version-watch.tsx)
- **Import:** `import { AppVersionWatch, clearCachesAndReload } from "@/components/app-version-watch";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `bootBuildId` | `string \| null` | The build id that served this document. From `getAppVersion(deps.buildIdRepo)`. `null` under `next dev`, which disables the check entirely. |

```tsx
const { buildId } = getAppVersion(deps.buildIdRepo);
<AppVersionWatch bootBuildId={buildId} />
```

**Used by:** [src/app/layout.tsx](src/app/layout.tsx). Its exported
`clearCachesAndReload()` also backs the "Clear cache & relaunch" button on
[Administration → About](src/app/(protected)/admin/about/view.tsx) — the manual control and
the automatic prompt deliberately share one definition of "refresh".

**Notes:** the problem it exists for is that **an installed PWA is suspended, not closed**
— reopening it resumes a days-old document that never re-requests anything, so a deploy
that is live on a desktop stays invisible on a phone. Hence the check runs on
`visibilitychange`, not on a timer: coming back to the foreground is both the moment the
app might be stale and the only moment a suspended app runs code at all. Nothing polls.

`clearCachesAndReload()` clears Cache Storage, unregisters any service workers, then
`location.replace()`s onto a URL carrying a `__v` timestamp. Both cache steps are **no-ops
today** — the app registers no service worker — and are kept so the button doesn't silently
stop working if one is ever added. The cache-busting URL is the part that does the real
work: **no web API can reach the browser's own HTTP cache**, so the only way past it is to
request a URL it has no entry for. The `__v` parameter is stripped via `replaceState` after
load so it never reaches a bookmark.

Renders `null` until the builds differ; then a `fixed top-0 z-40` strip. Pinned to the
**top** deliberately — the bottom edge already stacks the compact section trigger and the
music player on published heights, and a transient bar shouldn't join that contract or make
`.app-main` reserve space for it. Pads by `env(safe-area-inset-top)` since the app paints
under the Dynamic Island. Responsive via `max-lg:` (centred on desktop, label-and-actions
spread on a phone). Dismissible on purpose: an unskippable reload prompt mid-edit would
lose what was being typed, and it returns on the next foreground.

---

## Avatar

A user's profile picture, or an initials circle when they have none.

- **Source:** [src/components/avatar.tsx](src/components/avatar.tsx)
- **Import:** `import { Avatar } from "@/components/avatar";`
- **Client component:** no

| Prop | Type | Notes |
|------|------|-------|
| `userId` | `number` | Builds the image URL. |
| `avatarMimeType?` | `string` | When set, renders the image; otherwise the initials fallback. |
| `fallbackText` | `string` | Initial is derived from this (typically the full name). |
| `size?` | `"sm" \| "md"` | Default `"sm"`. |
| `version?` | `string` | Cache-buster — pass `updatedAt` when the image may have just changed. |
| `className?` | `string` | |

```tsx
<Avatar
  userId={user.id}
  avatarMimeType={user.avatarMimeType}
  fallbackText={user.fullName}
  size="md"
  version={user.updatedAt}
/>
```

**Used by:** `UserMenu`, [/account](src/app/(protected)/account/view.tsx), and the
User Management grid.

**Notes:** renders `<img src="/api/users/{userId}/avatar">` — that route is the only place
avatar bytes are read and served.

---

## FileDropzone

Drag-and-drop file picker with a click-to-browse fallback.

- **Source:** [src/components/file-dropzone.tsx](src/components/file-dropzone.tsx)
- **Import:** `import { FileDropzone } from "@/components/file-dropzone";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `onFile` | `(file: File) => void` | Called with the first dropped/selected file. |
| `accept?` | `string` | Forwarded to the input, e.g. `".csv"`. |
| `label?` | `string` | Default: a generic prompt. |
| `disabled?` | `boolean` | |
| `className?` | `string` | |

```tsx
<FileDropzone
  accept=".csv"
  label="Drop a CSV here, or click to browse"
  onFile={(file) => {
    const reader = new FileReader();
    reader.onload = () => handleCsvText(String(reader.result));
    reader.readAsText(file);
  }}
/>
```

**Used by:** CSV Analysis
[csv-analytics-view.tsx](src/app/(protected)/modules/[slug]/csv-analytics-view.tsx),
MyJournal import [journal-import-view.tsx](src/app/(protected)/modules/[slug]/journal-import-view.tsx).

**Notes:** hands you a raw `File` and never reads it — the caller decides how
(`FileReader.readAsText`, upload, etc.).

---

## CsvMappingTable

The table you map a CSV's columns in: one column per CSV header, a target-field
dropdown under each, an optional per-column options row, and sample data below so you
can see what you're mapping. Any importer that asks the user to line up columns uses
this — don't hand-roll a second header/select/sample table.

- **Source:** [src/components/csv-mapping-table.tsx](src/components/csv-mapping-table.tsx)
- **Import:** `import { CsvMappingTable, CSV_MAPPING_OPTION_INPUT_CLASS, type CsvMappingField } from "@/components/csv-mapping-table";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `headers` | `string[]` | CSV header cells in file order. **Their index is the mapping key.** |
| `sampleRows` | `string[][]` | Rows shown under the controls. Short rows are fine — cells are read by header index, not row position. |
| `fields` | `readonly CsvMappingField[]` — `{ value, label }` | The selectable target fields. An "Ignore" option is added for you. |
| `mapping` | `Record<string, string>` | Column index (as a string) → target field. Absent = ignored. |
| `onMappingChange` | `(columnIndex: number, field: string) => void` | An empty `field` means "ignore this column". |
| `renderFieldOptions?` | `(columnIndex: number, field: string) => ReactNode` | Extra control under a mapped column (date format, delimiter…). Return `null` for fields with no options; **omit the prop entirely** to hide the row. |
| `excludedRowIndexes?` | `ReadonlySet<number>` | Rows the user has dropped. Supply this **and** `onToggleRowExcluded` to turn on per-row exclusion; omit both and there are no row controls. |
| `onToggleRowExcluded?` | `(rowIndex: number) => void` | Raised by a row's ×/Undo control. |
| `rowNumberHeader?` | `string` | Header for the row-number column. Default `"#"`. Only shown with exclusion on. |
| `extraColumn?` | `{ header, renderHeaderControl?, renderCell }` | One importer-owned column before the CSV's own — for a per-row decision made at import time rather than read from the file. `renderCell(rowIndex, row)`. |
| `className?` | `string` | Merged last. Use it to cap height (`max-h-[32rem]`) when passing every row. |

```tsx
<CsvMappingTable
  headers={preview.headers}
  sampleRows={preview.sampleRows}
  fields={POSITION_IMPORT_FIELDS}
  mapping={mapping}
  onMappingChange={updateMapping}
  renderFieldOptions={(index, field) =>
    DATE_FIELDS.has(field) ? (
      <input
        value={fieldOptions[String(index)]?.dateFormat ?? ""}
        onChange={(event) => setDateFormat(index, event.target.value)}
        placeholder="MM/DD/YYYY"
        aria-label="Date format"
        className={CSV_MAPPING_OPTION_INPUT_CLASS}
      />
    ) : null
  }
/>
```

**Used by:** the Expense statement importer
[expense-import-view.tsx](src/app/(protected)/modules/[slug]/expense-import-view.tsx) and the
Stocks & ETFs importer
[stock-import-view.tsx](src/app/(protected)/modules/[slug]/stock-import-view.tsx). The field
lists come from the lib (`EXPENSE_IMPORT_FIELDS`, `POSITION_IMPORT_FIELDS`,
`TRANSACTION_IMPORT_FIELDS`, `PERFORMANCE_IMPORT_FIELDS`), not from the view.

**Notes:** it holds **no** mapping or exclusion state — a mapping is domain data that gets
saved, so the caller owns `mapping`/`excludedRowIndexes` and applies every change. Cells and
controls are keyed by column index rather than header text, because broker exports genuinely
do repeat a header and ship blank ones, which would collide on a text key. Use
`CSV_MAPPING_OPTION_INPUT_CLASS` for anything in the options row so it matches the
dropdowns above it.

**`extraColumn`.** Not a CSV column — a decision column the importer owns. The Stocks
positions import uses it for a per-row **Type** dropdown (a broker export that mixes ETFs and
stocks rarely says which is which), with a "Set all…" picker in `renderHeaderControl`. Keep the
control's styling matched to the field dropdowns above it.

**Row exclusion.** `sampleRows` is whatever you choose to show. The Expense importer passes
`preview.sampleRows` (10 random rows, a visual check only) and leaves exclusion off; the
Stocks importer passes `preview.rows` — every row — plus the two exclusion props, because you
can't remove a row you can't see. Excluded rows render dimmed and struck through rather than
disappearing, so the row numbers keep matching the file. The index a row is keyed by is its
index in `sampleRows`, which is why the caller must pass rows in file order when exclusion is
on.

---

## IconSelect

A dropdown whose options carry a small image beside the label. **This is why it
exists:** neither a native `<select>` nor a `<datalist>` can render an image in its
options, so any picker that needs one uses this instead of hand-rolling a combobox.
By default it's a *combobox*, not a strict picker — typing filters the list and also
commits what you type, so a value that isn't in the list is still allowed.

- **Source:** [src/components/icon-select.tsx](src/components/icon-select.tsx)
- **Import:** `import { IconSelect, type IconSelectOption } from "@/components/icon-select";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `options` | `IconSelectOption[]` — `{ value, label, iconUrl? }` | An option with no `iconUrl` still indents, so labels stay aligned. |
| `value` | `string` | Matched against `options` to show the label + leading icon. |
| `onChange` | `(value: string) => void` | Raises the value itself, not a change event — it can't take a plain input's handler. |
| `allowFreeText?` | `boolean` | Default `true` (typing filters *and* commits). `false` makes it a strict picker: typing only filters. |
| `clearLabel?` | `string` | Adds a first row that sets `""`, e.g. `"— uncategorised —"`. Omit when empty isn't a real choice. |
| `placeholder?` | `string` | |
| `disabled?` | `boolean` | |
| `id?` / `ariaLabel?` | `string` | `id` when a `<label htmlFor>` points at it, `ariaLabel` when there's no visible label. |
| `className?` | `string` | Merged last onto the input (e.g. a width). |

```tsx
<IconSelect
  options={categoryIconSelectOptions(categories)}
  value={form.categoryName}
  onChange={(categoryName) => update("categoryName", categoryName)}
  clearLabel="— uncategorised —"
  placeholder="Leave blank to categorise later"
  ariaLabel="Category"
/>
```

**Used by:** the Expense category pickers — the transaction form and bulk-edit dialog
[expense-transactions-view.tsx](src/app/(protected)/modules/[slug]/expense-transactions-view.tsx)
and the post-import rule editor
[expense-rules-view.tsx](src/app/(protected)/modules/[slug]/expense-rules-view.tsx).
Options are built by `categoryIconSelectOptions` in
[expense-shared.tsx](src/app/(protected)/modules/[slug]/expense-shared.tsx).

**Notes:** keyboard-driven — ArrowUp/ArrowDown move the highlight, Enter picks it
(without submitting the form), Escape/Tab close. A click outside closes it; the
listener is only registered while open. Icons are plain `<img loading="lazy">`, so
the caller passes a URL (typically a DB-backed route like
`/api/expense/categories/<name>/icon`) rather than image bytes.

---

## TokenPicker

A set of chosen names — each one its own removable chip, with a dropdown of the
known names to add from. **Reach for it whenever a record holds *several* of
something from a vocabulary** (categories, tags, labels). It replaces the
delimited free-text field — "FAMILY, PERSONAL" typed into an `<input>` — where a
typo silently creates a new name and there is nothing to click to remove one.

For a single choice that needs an image beside each option, use
[`IconSelect`](#iconselect) instead.

- **Source:** [src/components/token-picker.tsx](src/components/token-picker.tsx)
- **Import:** `import { TokenPicker } from "@/components/token-picker";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `label` | `string` | Rendered above the control, and used to build the two `aria-label`s (singularised by dropping a trailing `s`). |
| `value` | `string[]` | The chosen names, in the order they'll be saved. |
| `onChange` | `(next: string[]) => void` | Raises the whole next array. |
| `options` | `string[]` | Every known name. Already-chosen ones are filtered out of the dropdown, so picking can't duplicate. |
| `allowCreate?` | `boolean` | Default `false`. Adds a text field for a name that isn't in `options` yet. Leave it off for a closed vocabulary. |
| `createPlaceholder?` | `string` | Placeholder for that field. Ignored unless `allowCreate`. |
| `hint?` | `string` | Small muted line under the control. |
| `className?` | `string` | Merged last, e.g. `"sm:col-span-2"` to span a two-column form grid. |

```tsx
<TokenPicker
  className="sm:col-span-2"
  label="Tags"
  value={form.tags}
  onChange={(names) => setTaxonomy("tags", names)}
  options={tagOptions}
  allowCreate
  createPlaceholder="New tag, e.g. Museum"
/>
```

**Used by:** the journal's Categories and Tags fields, in both the create form
[journal-entry-form.tsx](src/app/(protected)/modules/[slug]/journal-entry-form.tsx)
and the edit form
[entry-edit-form.tsx](src/app/(protected)/modules/[slug]/entries/[id]/entry-edit-form.tsx).

**Notes:** duplicate detection is case-insensitive, so adding "Museum" when
"museum" is already chosen is a no-op and the stored casing is whatever went in
first. The create field commits on Enter (`preventDefault`, so it can't submit the
surrounding form) and on blur. The dropdown's own value is always `""` — it's an
action, not a held choice — and it disables itself once every option is chosen.
The component never registers a new name; a typed name is just a string in `value`
until whatever saves the record decides what to do with it. Narrow screens stack
the dropdown above the create field (`max-lg:flex-col`); chips wrap at any width.

---

## ColorField

**One color on a form.** A swatch that opens the OS colour picker, with the hex
spelled out beside it in a text field. **Reach for it whenever a record stores a
colour** — the two halves exist because either alone is half a control: a bare
`<input type="color">` gives no way to paste a brand hex, and a bare text field
gives no way to explore a hue.

- **Source:** [src/components/color-field.tsx](src/components/color-field.tsx)
- **Import:** `import { ColorField } from "@/components/color-field";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `label` | `string` | Rendered above the control, and used to build both `aria-label`s. |
| `value` | `string` | The current `#RRGGBB`. **May be mid-edit and invalid** — that's expected. |
| `onChange` | `(next: string) => void` | Raises **every keystroke**, valid or not. The parent validates. |
| `hint?` | `string` | Small muted line under the control — say what the colour paints. |
| `error?` | `string` | Shown in place of `hint`, in the danger colour, and reddens the border. |
| `disabled?` | `boolean` | |
| `className?` | `string` | Merged last, e.g. `"sm:col-span-2"` to span a two-column form grid. |

```tsx
<ColorField
  label="Brass"
  hint="The accent: active nav, icons, primary buttons."
  value={tokens.brass}
  onChange={(next) => setToken("brass", next)}
  error={fieldErrors.brass}
/>
```

**Used by:** the theme builder's nine colour tokens,
[theme-builder.tsx](src/app/(protected)/admin/configuration/themes/theme-builder.tsx).

**Notes:** the component **does not validate** — it raises whatever is typed and
shows whatever `error` you hand back, so one schema governs the form and the
server. The text field keeps its own draft so a half-typed `#1A2` survives a
re-render; it resyncs by comparing against the previous prop **during render**
rather than in a `useEffect`, because a setState-in-effect fires a second render
pass on every keystroke (ESLint flags it). The swatch falls back to `#000000`
whenever the draft isn't a valid 6-digit hex, since `<input type="color">` accepts
nothing else and would otherwise reset itself. Fixed swatch width by design — a
stretching swatch reads as a banner, and the hex is what needs the room.

---

## Shared chart display props

**Every chart component accepts these four display props, and they mean the same thing on
each.** Defined once as `ChartDisplayDefaults` in
[src/lib/shared/chart-options.ts](src/lib/shared/chart-options.ts); each chart's props
interface `extends` it, so a new option added there reaches all of them and the
typechecker enforces the vocabulary. **Don't add a chart-specific alias for one of these**
(no `showValues`, no `labelPoints`) — extend the shared interface instead.

| Prop | Type | Notes |
|------|------|-------|
| `pointLabels?` | `"none" \| "last" \| "extremes" \| "all"` | Which points print their value. `"none"` for lines/areas, `"all"` for `ChartBar`. |
| `showDots?` | `boolean` | Marker at each point. |
| `showLegend?` | `boolean` | Defaults to "only when there's more than one series". |
| `showGrid?` | `boolean` | |
| `showToolbar?` | `boolean` | Default `true`. `false` drops the reader's gear control. |
| `displayStorageKey?` | `string` | Remembers this chart's display choices in `localStorage`. **Give every chart its own key.** |

**`chartType` is the fifth, and it's optional in a way the others aren't.** It lives on
`ChartDisplay` (not `ChartDisplayDefaults`) and holds `"line" \| "bar" \| "area" \|
"scatter"` — but only for a chart that offers switching. `undefined` means *this chart has
one honest encoding*, not "line": `ChartBar` takes one value per category and `ChartCandle`
needs four prices per period, so neither can be re-encoded and neither carries the field.
It's stored per-field like the rest, and a chart that doesn't switch writes no `chartType`
into `localStorage` at all.

**A call site declares which types it allows**, via `chartTypes` on
[`ChartLine`](#chartline) or [`ChartXY`](#chartxy) — the toolbar never assumes. Honesty
depends on the data, not the component: `scatter` needs a numeric x, so a date-keyed chart
mustn't offer it, and unordered categories mustn't offer `line` (a trend line over
categories implies an order the data doesn't have). One type, or none, renders no picker.

**These are starting values, not settings.** The reader changes any of them from the
chart's own [`ChartToolbar`](#chartoolbar); the prop chooses what they see first. With a
`displayStorageKey` their choice outlives the page.

**`pointLabels` is a mode, not a boolean, on purpose.** The dataviz skill's rule is
*"label selectively — never a number on every point"*: a value beside all 500 dots of a
price history is unreadable. So `"all"` is honoured only up to a cap
(`DEFAULT_MAX_POINT_LABELS`, 12; `COMPACT_MAX_POINT_LABELS`, 4, below 1024px — six labels
across a 390px phone was measured and they touch) and past it draws the high and low
instead, with the toolbar saying so rather than appearing to ignore the choice.
`ChartBar` is exempt: one label per *bar* at its free end is the endorsed treatment.

Which points get labelled is **decided in the lib** —
[`selectLabeledIndexes`](src/lib/shared/chart-options.ts) — not in the components, and it
skips gaps rather than reading a missing reading as `0`. Change labelling *behaviour*
there, with tests. The components only draw, via the shared renderer
[chart-point-labels.tsx](src/components/chart-point-labels.tsx).

---

## ChartLine

Time-series line chart, one or more series.

- **Source:** [src/components/chart-line.tsx](src/components/chart-line.tsx)
- **Import:** `import { ChartLine, type ChartLineSeries } from "@/components/chart-line";`
- **Client component:** yes (wraps Recharts)
- **Also accepts** every [shared chart display prop](#shared-chart-display-props).

| Prop | Type | Notes |
|------|------|-------|
| `data` | `Record<string, number \| string>[]` | Rows with one `xKey` field + one numeric field per series key. Carry extra fields on a row for `renderDot` to switch on. |
| `series` | `{ key, label, color?, renderDot? }[]` | A single series renders with no legend box. |
| `xKey` | `string` | Field used for the x-axis. |
| `formatValue?` | `(value: number) => string` | y-axis ticks, tooltip **and any point label**. |
| `formatX?` | `(value: string \| number) => string` | x-axis ticks. |
| `height?` | `number` | Default `280`. |
| `connectNulls?` | `boolean` | Draw a series through rows where its key is missing instead of breaking. Default `false`. |
| `curve?` | `"monotone" \| "linear"` | Default `"monotone"` (smoothed). `"linear"` joins points with straight segments. |
| `chartTypes?` | `("line" \| "area")[]` | Offers a line ↔ area switch in the toolbar. Omitted by default, and by every current call site. |
| `showLegend?` | `boolean` | Overrides the "legend only when >1 series" default. Set `false` when the caller renders its own. |
| `className?` | `string` | |

```tsx
<ChartLine
  data={history}
  series={[{ key: "totalValue", label: "Total value" }]}
  xKey="date"
  formatValue={(value) => formatCurrency(value)}
/>
```

**Its type switch is line ↔ area only** — the two encodings that share `LineChart`'s row
shape and both support `renderDot`, so switching can never drop a series' custom marks. For
bar or scatter over the same rows use [`ChartXY`](#chartxy), which exists for reader-chosen
encodings. Nothing opts in today; the capability is there for the next call site that wants
it.

**Sparse multi-series.** When series are recorded on different schedules, omit the key on
rows that have no value — *don't* write `0`, which reads as a real reading of zero — and set
`connectNulls` so each line joins across its gaps. Pair it with `curve="linear"`: a smoothed
curve through a sparse series implies intermediate movement the data doesn't record. Assign
each series an explicit `color` from its **stable** index, not its position in a filtered
array, or hiding one series recolours the rest. See the Account Performance Over Time card in
[stock-accounts-view.tsx](src/app/(protected)/modules/[slug]/stock-accounts-view.tsx).

**Custom point marks.** `series[].renderDot` replaces that series' filled circle with
whatever SVG you return, given `{ cx, cy, index, payload, color }` — `payload` is the whole
row, so put a discriminator on it and switch:

```tsx
const data = points.map((point) => ({ date: point.date, price: point.price, mark: markFor(point) }));

<ChartLine
  data={data}
  xKey="date"
  series={[{
    key: "price",
    label: "Price per share",
    renderDot: ({ cx, cy, index, payload }) => (
      <g key={`${payload.date}:${index}`} transform={`translate(${cx}, ${cy})`}
         className={MARK_CLASS[payload.mark as ChartMark]}>
        <MarkShape mark={payload.mark as ChartMark} />
      </g>
    ),
  }]}
/>
```

Reach for it when the **shape** of a point carries meaning the line can't (a buy against a
sell). Prefer a second series when the extra thing is its own quantity — a shape annotates
points you already have. Recharts needs an element back, so return `<g />`, not a fragment
or `undefined`. Fill from `currentColor` and set the colour with a Tailwind text class on
the wrapping `<g>`, so the marks stay theme-driven. The built-in legend names series, not
shapes, so a shape vocabulary needs its own key next to the chart (see `MarkLegend` in
`TickerViewer`).

**Used by:** Stocks & ETFs — account performance history
[stock-accounts-view.tsx](src/app/(protected)/modules/[slug]/stock-accounts-view.tsx), position
price history [stock-analytics-view.tsx](src/app/(protected)/modules/[slug]/stock-analytics-view.tsx),
the Expense module's spend-over-time trend
[expense-charts-view.tsx](src/app/(protected)/modules/[slug]/expense-charts-view.tsx),
and the "My past performance" chart in
[ticker-viewer.tsx](src/components/ticker-viewer.tsx) *(the `renderDot` example)*.

---

## ChartBar

Horizontal bars for part-to-whole or magnitude comparison across a handful of categories.
**Prefer this over [`ChartPie`](#chartpie) whenever the reader compares magnitudes** ("who did I
spend most at") — a bar's length is read more accurately than a slice's angle, and it takes as
many categories as you like. Reach for the pie only when the question is genuinely "what
fraction of the whole", and only up to 5 slices.

- **Source:** [src/components/chart-bar.tsx](src/components/chart-bar.tsx)
- **Import:** `import { ChartBar, type ChartBarItem } from "@/components/chart-bar";`
- **Client component:** yes (wraps Recharts)
- **Also accepts** every [shared chart display prop](#shared-chart-display-props).

| Prop | Type | Notes |
|------|------|-------|
| `items` | `{ key, label, value, color? }[]` | One bar each; `label` is the axis tick and the identity. |
| `formatValue?` | `(value: number) => string` | Also used for the direct bar label. |
| `height?` | `number` | Defaults to `max(120, items.length * 44)`. |
| `className?` | `string` | |

```tsx
<ChartBar
  items={[
    { key: "stock", label: "Stocks", value: 62000 },
    { key: "etf", label: "ETFs", value: 18500 },
    { key: "other", label: "Other", value: 4200 },
  ]}
  formatValue={formatCurrency}
/>
```

**Used by:** Stocks & ETFs allocation and dividend-income breakdown —
[stock-positions-view.tsx](src/app/(protected)/modules/[slug]/stock-positions-view.tsx).

---

## ChartPie

A donut showing each category's **share of a whole**, read at a glance.

- **Source:** [src/components/chart-pie.tsx](src/components/chart-pie.tsx)
- **Import:** `import { ChartPie } from "@/components/chart-pie";`
- **Client component:** yes (wraps Recharts)
- **Does _not_ take the shared chart display props** — see why below.

| Prop | Type | Notes |
|------|------|-------|
| `items` | `PartToWholeSlice[]` | `{ key, label, value }`, biggest first. **Max 5** — fold first (below). |
| `formatValue?` | `(value: number) => string` | Used in the tooltip. |
| `height?` | `number` | Defaults to `260`. |
| `className?` | `string` | |
| `onSliceClick?` | `(slice) => void` | Raised with the clicked slice. Makes slices clickable; the component decides nothing. |
| `isSliceEnabled?` | `(slice) => boolean` | Which slices `onSliceClick` applies to. Defaults to all. |

```tsx
import { foldToOther } from "@/lib/shared/chart-options";

<ChartPie
  items={foldToOther(slices, 5, (count) => `${count} other vendors`)}
  formatValue={(value) => `$${value.toFixed(2)}`}
/>
```

**Five slices is a hard ceiling, and it comes from the palette rather than from taste.** A pie
is an *all-pairs* form — any slice can end up beside any other — so every pair of colours must
be separable, not just neighbours in the fixed order. Running the dataviz validator over
`CHART_CATEGORICAL_COLORS` with `--pairs all`:

| Slots | Result |
|---|---|
| 4 | PASS |
| 5 | PASS — CVD ΔE 6.1, the 6–8 floor band, legal *only* with direct labels |
| 6 | **FAIL** — normal-vision ΔE 12.9, under the hard floor of 15 |

So six slices are hard to tell apart with full colour vision, never mind without. Use
`foldToOther` from [chart-options.ts](src/lib/shared/chart-options.ts) to pool the tail; it takes
the wording of the folded slice so you can say "23 other vendors" rather than a bare "Other".

**Fixed, not props:** each slice ≥5% carries its percentage *inside* the ring, there is no legend
box, and there is no `ChartToolbar`.

- **Labels are inside the arc** because outside ones (with leader lines, Recharts' default)
  clipped off both edges of a card at phone width. Inside, text cannot overflow the box however
  narrow it gets. Below 5% a slice prints nothing rather than colliding with its neighbours.
- **No legend**, because it duplicated the labels word-for-word and overflowed narrow cards.
- **So the caller must supply the names.** The chart prints only percentages; identity and exact
  values live in a companion list. **Always pair this with one**, showing a colour swatch drawn
  from `CHART_CATEGORICAL_COLORS` in the same index order — see the Expense vendor card. That
  list is also the "table view" that discharges the validator's contrast warning (three palette
  hues fall below 3:1 against paper), which is why it isn't optional.

**Drill-down.** `onSliceClick` + `isSliceEnabled` let a pooled slice open its own contents.
The Expense vendor card does this by re-folding the *remainder* at the next level — same
component, same fold, one page down — so the drill is one operation repeated rather than a
second kind of view, and the pooled value always equals the next level's total (there's a test
pinning that). **A wedge can't take focus**, so put the same action on the companion list's
pooled row as a real `<button>`; that's the keyboard path.

**Used by:** the Expense module's Charts and Analysis → Vendor card —
[expense-charts-view.tsx](src/app/(protected)/modules/[slug]/expense-charts-view.tsx).

**Notes:** each bar is direct-labeled with its value (the required contrast relief) and the
axis tick supplies identity, so there is no legend box.

**It's the one chart that labels every mark by default** (`pointLabels="all"`), and the only
one whose label density isn't capped: a bar has a free end to print on and there are only
ever a handful. Its toolbar therefore offers just None / Every bar — "latest" and
"high & low" are time-series ideas, and categories have no order to have a latest.
It also has a **tooltip** now, which it went without.

---

## ChartXY

Configurable X/Y chart — line / bar / scatter / area — with zoom in/out/reset and optional
point markers. Use when the *user* picks the encoding; use `ChartLine`/`ChartBar` when you
do.

- **Source:** [src/components/chart-xy.tsx](src/components/chart-xy.tsx)
- **Import:** `import { ChartXY, type ChartType } from "@/components/chart-xy";`
- **Client component:** yes (wraps Recharts; memoized)
- **Also accepts** every [shared chart display prop](#shared-chart-display-props).

| Prop | Type | Notes |
|------|------|-------|
| `type` | `"line" \| "bar" \| "scatter" \| "area"` | The encoding drawn **first**. The reader can change it from the toolbar; passing a new `type` resets them to it. |
| `chartTypes?` | `ChartType[]` | Which encodings the toolbar offers. Defaults to line/bar/area — **not** scatter. |
| `onTypeChange?` | `(type: ChartType) => void` | Fires when the reader switches. Only needed by a caller whose *data* depends on the encoding. |
| `data` | `Record<string, number \| string \| null>[]` | Pre-sorted by `xKey` (zoom is a windowed slice). |
| `xKey` | `string` | |
| `series` | `{ key, label, color? }[]` | Legend only appears for >1 series. |
| `showDots?` | `boolean` | Default `false` (line/area). Shared prop; now also reader-toggleable. |
| `formatValue?` | `(value: number) => string` | |
| `formatX?` | `(value: string \| number) => string` | |
| `height?` | `number` | |
| `curve?` | `"monotone" \| "linear"` | Default `"monotone"`. |
| `className?` | `string` | |

```tsx
<ChartXY
  type={chartType}
  data={rows}
  xKey={xKey}
  series={yKeys.map((key) => ({ key, label: key }))}
  displayStorageKey="myhomebase:chart:csv-analytics"
/>
```

**Used by:** the CSV Analysis chart builder —
[csv-analytics-view.tsx](src/app/(protected)/modules/[slug]/csv-analytics-view.tsx) (the
axis/format pickers stay local to that view; **chart type no longer does** — it moved into
the shared gear popover, so it's the same control every switchable chart offers).

**`type` is a starting value, and a changed `type` prop wins over the remembered choice.**
That's what makes a saved CSV chart preset work: the preset names an encoding, and it would
otherwise lose to whatever the reader last picked from the toolbar and silently draw the
wrong chart. Reconciled during render, not in an effect, so no frame draws the old encoding
against the new prop.

**`onTypeChange` exists for one real case:** the CSV builder casts its x column to a number
for scatter and leaves it a category otherwise, so it has to know what the reader picked.
A caller whose data is encoding-independent can ignore it.

**Scatter is opt-in per call site,** not offered by default — it needs a numeric x, and no
component can verify that about its caller's data.

**Its zoom controls ride in the shared `ChartToolbar`** rather than a row of their own, so
the chart has one strip of controls instead of two stacked. They're passed as `children`;
`showToolbar={false}` hides the gear but keeps them. Switching encoding **keeps the zoom
window** — it's the same rows, drawn differently.

**Point labels follow the zoom window,** not the whole dataset — zooming in re-picks the
visible high and low instead of pointing off-screen. Scatter draws none: its marks *are* the
points, with no free end to print on.

**Notes:** single shared y-scale, never dual-axis. Colors come from
`@/components/chart-colors` by series order.

---

## ChartCandle

Candlestick / OHLC — a body from open to close, a wick spanning the period's high and low.
Use it when all four prices matter; use `ChartLine` when the close is the story (it usually
is — a candle chart costs a reader more attention, so it should be a choice, not a default).

- **Source:** [src/components/chart-candle.tsx](src/components/chart-candle.tsx)
- **Import:** `import { ChartCandle, type ChartCandlePoint } from "@/components/chart-candle";`
- **Client component:** yes (wraps Recharts)
- **Also accepts** every [shared chart display prop](#shared-chart-display-props).

| Prop | Type | Notes |
|------|------|-------|
| `data` | `{ x, open, high, low, close }[]` | Oldest first. **Every point needs all four prices** — screen the series with `hasFullBars` first. Values in display units (dollars, not cents). |
| `formatValue?` | `(value: number) => string` | Y-axis ticks, the four tooltip prices, and any point label. |
| `formatX?` | `(value: string \| number) => string` | X-axis ticks. |
| `height?` | `number` | Defaults to 280. |
| `label?` | `string` | Names the series in the tooltip. Defaults to `"Price"`. |
| `className?` | `string` | |

```tsx
{hasFullBars(series.points) && (
  <ChartCandle
    data={series.points.map((point) => ({
      x: point.date,
      open: centsToDollars(point.openCents ?? 0),
      high: centsToDollars(point.highCents ?? 0),
      low: centsToDollars(point.lowCents ?? 0),
      close: centsToDollars(point.closeCents),
    }))}
    formatValue={(value) => `$${value.toFixed(2)}`}
    displayStorageKey="myhomebase:chart:ticker-market-candles"
  />
)}
```

**Used by:** the ticker dialog's Price History card, behind a Line ↔ Candles toggle in the
range row — [ticker-viewer.tsx](src/components/ticker-viewer.tsx).

**Direction is encoded twice, on purpose.** Up is hollow *and* green, down is filled *and*
red — colour alone loses the distinction in greyscale and for a red-green colour-blind
reader, and direction is the entire point of the mark. A bar that closed where it opened is
neither, and draws in the muted axis colour. The hollow/filled key sits under the plot and
is always shown: `Legend` keys *series* by colour, and this is one series whose marks carry
two meanings, so the Recharts legend is the wrong control (`canToggleLegend={false}`).

**It offers no "every point" label mode** (`["none", "last", "extremes"]`) and no point
markers. A year of daily candles has no room for 250 numbers, and a candle has no dot to
toggle.

**Below ~3px per bar the body is dropped and the wick drawn alone** — the OHLC-bar
treatment. A 1px body and a 1px wick are the same mark, so at that density the body is
noise. That's `MIN_BODY_WIDTH`, and it keys off *available width per bar* rather than
`useViewport()`: five years of daily bars is too dense on a desktop too, so the trigger is
density, not screen size.

**The rules live in the lib** —
[src/lib/shared/chart-candle.ts](src/lib/shared/chart-candle.ts) holds `hasFullBars`,
`normalizeCandleBar`, `candleDomain` and `candleGeometry`; the component owns only SVG. Two
of those exist for provider defects worth knowing about: `normalizeCandleBar` takes the max
of all four prices as the high (Yahoo occasionally reports a high fractionally *below* the
close on thin volume, which would draw a wick inside its own body), and `candleDomain` pads
a flat series off the price itself rather than off a zero span.

**Its y-axis spans the wicks, not the closes.** An axis fitted to closes clips the very
extremes the chart exists to show.

---

## ChartToolbar

**A chart's own gear control** — chart type, value labels, point markers, legend, gridlines.
You do not call this: every chart component mounts one, so every chart in the app offers the
same options in the same place. It's registered because it's the contract for what a reader
can change, and because a new chart type must reuse it rather than invent a control strip.

- **Source:** [src/components/chart-toolbar.tsx](src/components/chart-toolbar.tsx)
- **Import:** `import { ChartToolbar, useChartDisplay } from "@/components/chart-toolbar";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `value` / `onChange` | `ChartDisplay` / `(next) => void` | The chart owns the state; this only edits it. |
| `labelModes?` | `readonly PointLabelMode[]` | Which modes to offer. Defaults to all four; `ChartBar` passes `["none", "all"]`. |
| `chartTypes?` | `readonly ChartEncoding[]` | Which encodings to offer. Omit it — or pass one — and no picker appears, which is most charts. |
| `canToggleDots?` / `canToggleLegend?` / `canToggleGrid?` | `boolean` | Hide a toggle that can't apply — a single series has no legend, a bar chart no markers. |
| `pointCount?` / `maxPointLabels?` | `number` | Only used to explain a capped `"all"`. |
| `children?` | `ReactNode` | Extra controls left of the gear — `ChartXY`'s zoom buttons. |
| `showOptions?` | `boolean` | `false` drops the gear but keeps `children`. |
| `className?` | `string` | |

**A gear popover, not a visible control row.** A dashboard stacks several charts, and a
permanent strip of checkboxes above each one competes with the data — and wraps to two lines
on a phone. One icon reads the same at 390px as at 1920px, which is also **how this behaves
narrow**: unchanged, it's already small. Escape and an outside click close it; the listener
is only registered while open.

**Chart type sits first in the panel, above a divider,** because it changes what the options
below it *mean* — a scatter has no line for "point markers" to sit on. It appears only when
the call site passes two or more `chartTypes` **and** `value.chartType` is set; a chart with
one honest encoding shows the panel exactly as it did before. The toolbar never picks the
list itself — see [shared chart display props](#shared-chart-display-props) for why that
has to be the call site's call.

**`useChartDisplay(defaults, storageKey)`** is the other half — it holds the state, seeds it
from the call site's props, persists it per chart, and returns the label cap (halved when
`useIsCompact()`). A chart component calls it; a *view* shouldn't need to.

Stored preferences are read in an effect, not during render, because `localStorage` doesn't
exist on the server — so a chart draws once with the call site's defaults before a stored
choice lands. That's the same trade `DataGrid` makes for its saved view, and the alternative
is a hydration mismatch.

**A toggle never hides data.** A series drawing custom marks (`ChartLine`'s `renderDot`) is
exempt from the markers toggle, because those shapes carry meaning the line doesn't — hiding
them would lose data rather than reduce clutter. The tooltip is deliberately **not**
toggleable for the same reason: it carries the values the labels don't.

---

## Progress3D

A progress bar for work underway. **Every progress bar uses this** — don't hand-roll
another `h-2 w-full rounded-full bg-line` track with a `bg-brass` div inside it.

Reads as a physical thing: the track is a groove cut into the page (a
`paper → paper-raised → paper` gradient with an inset lip shadow), and the fill is a lit
slab sitting in it (an accent gradient with a white sheen on top and the same hard offset
shadow `Button` uses). Both gradients live in `globals.css` as `.progress-3d-track` /
`.progress-3d-fill`; the component supplies the geometry, the clamping and the aria.

- **Source:** [src/components/progress-3d.tsx](src/components/progress-3d.tsx)
- **Import:** `import { Progress3D } from "@/components/progress-3d";`
- **Client component:** no (renders no hooks — usable from a server component)
- **Narrow screens:** unchanged. The bar is always fluid-width; `size` sets thickness only,
  so it needs no `max-lg:` variants.

| Prop | Type | Notes |
|------|------|-------|
| `value` | `number \| undefined` | Work done, same unit as `max`. Clamped into range. **`undefined` goes indeterminate** — a sweeping fill for a job that hasn't counted its total yet. |
| `max?` | `number` | Default `100`. `0` or negative renders an empty track rather than dividing by it. |
| `size?` | `"sm" \| "md" \| "lg"` | Thickness. Default `"md"`. Use `sm` in a toolbar strip. |
| `tone?` | `"accent" \| "positive" \| "negative"` | Default `"accent"` (follows the color theme). The other two are fixed semantic green/red — deliberately not theme tokens, per `design.md`. |
| `label?` | `string` | Rendered above the bar in the stat-tile label style. |
| `showValue?` | `boolean` | Percentage at the label's right. Needs `label` to have a row to sit in. |
| `formatValue?` | `(value: number, max: number) => string` | Replaces the "42%" readout — only the caller knows the unit. |
| `ariaLabel?` | `string` | **Required when there's no `label`** — a nameless progressbar announces only a number. |
| `className?` | `string` | Merged last. |

```tsx
{/* Determinate, with its own label row */}
<Progress3D label="Importing" value={done} max={total} showValue />

{/* Bare bar under a readout the caller already renders */}
<Progress3D value={progress.current} max={progress.total} size="sm" ariaLabel="Refresh progress" />

{/* Indeterminate — total not yet known */}
<Progress3D value={undefined} ariaLabel="Scan progress" />
```

**Used by:** the stock dashboard's refresh strip
[src/app/(protected)/modules/[slug]/stock-refresh-control.tsx](src/app/(protected)/modules/[slug]/stock-refresh-control.tsx),
the expense cleanup runner
[src/app/(protected)/modules/[slug]/expense-rules-view.tsx](src/app/(protected)/modules/[slug]/expense-rules-view.tsx),
and the music scan screen
[src/app/(protected)/modules/[slug]/music-scan-view.tsx](src/app/(protected)/modules/[slug]/music-scan-view.tsx),
which is the indeterminate case — phase one counts files before it can report a percentage.

Also the track inside [`UsageMeter`](#usagemeter), which is the tile (label, figure,
caption) wrapped around one of these.

**Not for:** a *scrubber* you can drag to seek — the music player bar owns its own, because
it's an input, not a readout. And if you want the used/total figures printed above the bar
in a bordered tile, reach for [`UsageMeter`](#usagemeter) rather than assembling it again.

---

## UsageMeter

A stat tile whose number is part of a known total, so it carries a slim filled track
under the figure. Use it for used/total pairs — memory, disk, a quota.

The track is a [`Progress3D`](#progress3d) at `size="sm"`; this component is the tile
around it — the label row, the `used / total` figure, the caption. Reach for it instead of
composing those yourself.

- **Source:** [src/components/usage-meter.tsx](src/components/usage-meter.tsx)
- **Import:** `import { UsageMeter } from "@/components/usage-meter";`
- **Client component:** no (renders no hooks)

| Prop | Type | Notes |
|------|------|-------|
| `label` | `string` | Tile label, in the stat-tile label style. |
| `used` | `number` | The filled portion, same unit as `total`. |
| `total` | `number` | The whole. `0` or negative renders an empty track rather than dividing by it. |
| `formatValue` | `(value: number) => string` | Formats both figures. Pass a function the *client* side owns — see below. |
| `caption?` | `string` | Qualifies the total when the label doesn't, e.g. "Of 32 GB system RAM." |
| `className?` | `string` | Merged last. |

```tsx
<UsageMeter
  label="RAM Used / Total"
  used={memory.usedBytes}
  total={memory.totalBytes}
  caption="6.1 GB free."
  formatValue={formatBytes}
/>
```

**Used by:** the About screen
[src/app/(protected)/admin/about/view.tsx](src/app/(protected)/admin/about/view.tsx) — system
RAM on one row, Process RSS and Process Heap on the next.

**Notes:** the percentage is printed beside the label, so the fill is never the only
channel carrying the value — a meter that's only a bar fails the same contrast test a
chart does. The track is `bg-line`, the fill `bg-brass`, both theme tokens.

**`formatValue` is a function prop, so it can't cross a server→client boundary.** A server
component can't pass it down; the client view imports the formatter itself and applies it
(About imports `formatBytes` from `@/lib/system-info`). The server page passes the raw
numbers.

**Not `ChartBar`.** A meter answers "how full is this one thing"; `ChartBar` compares
several categories and brings Recharts with it. Three used/total pairs are three meters,
not a chart.

---

## JournalViewer

Full-detail sheet for one journal entry — every stored field, plus optional Print / Edit /
Lock / Delete actions. Journal-specific but registered because it's the shared viewer for an
entry (the journal counterpart to `TickerViewer`): the entry screen and any future
print/export view share it.

- **Source:** [src/components/journal-viewer.tsx](src/components/journal-viewer.tsx)
- **Import:** `import { JournalViewer } from "@/components/journal-viewer";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `entry` | `JournalEntry` (type from `@/lib/journal`) | |
| `onPrint?` | `() => void` | Omit to hide Print. |
| `onEdit?` | `() => void` | Omit to hide Edit. Disabled while locked. |
| `onShowLocation?` | `(location: EntryLocation) => void` | Adds a per-location "Map" button. |
| `onShowAllLocations?` | `() => void` | Adds a "Map All Locations" button below the list. **Only rendered when the entry has more than one location** — with one, the per-location "Map" button already does the same job. The caller renders the multi-pin map. |
| `onToggleLock?` | `(nextLocked: boolean) => void` | Omit to hide Lock. |
| `onDelete?` | `() => void` | Omit to hide Delete. Guarded by an inline confirm. |
| `previousHref?` / `previousDate?` | `string` | Adds a Previous button, left of the date/time, linking to the older neighbour. `previousDate` fills the caption below it. Omit both to hide the button. The caller computes the href — this component stays free of routing knowledge. |
| `nextHref?` / `nextDate?` | `string` | Same, for the newer neighbour. |
| `categoryIcons?` / `tagIcons?` | `Record<string, string>` | Name → icon URL for the icons shown at the right of the date/time row. Only names *with* an uploaded icon need an entry; anything missing is skipped. **Plain objects, not a `Map`** — this is a client component, and the page that fetches the icons is a server one. The caller builds the URLs, so the component takes no journal-lib dependency. |
| `categoryHref?` / `tagHref?` | `(name: string) => string \| undefined` | Makes each category/tag clickable — both the header icon and the Misc Info chip link to whatever the caller returns (in the journal, a pre-filtered Entries list). Same arrangement as `previousHref`: the caller owns the URL. Return `undefined` for a name that can't be linked, and that one stays a plain label. Omit the prop and none of them are links. |
| `photosSlot?` | `ReactNode` | Rendered between Content and Misc Info, inside a `no-print` wrapper. A **slot, not photo props** — the viewer stays free of any filesystem or archive types, and the caller supplies whatever card it likes. The journal entry screen passes its "Pictures of this date" card here. Omit it and the viewer is unchanged. |
| `calendarHref?` | `string` | Adds a running-shoe icon immediately right of the date that links to the journal Calendar opened on this entry's date — the caller builds `?anchor=`/`?date=` so the grid lands on the right month with the day selected. Same arrangement as `previousHref`: the caller owns the URL. Omit to hide the icon. |
| `isBusy?` | `boolean` | Disables the actions while the caller works. |
| `className?` | `string` | |

```tsx
<JournalViewer
  entry={entry}
  onPrint={() => window.print()}
  onEdit={() => setEditing(true)}
  onShowLocation={(location) => setMapView({ kind: "one", location })}
  onShowAllLocations={() => setMapView({ kind: "all" })}
  onToggleLock={(nextLocked) => handleToggleLock(nextLocked)}
  onDelete={handleDelete}
  previousHref={previousHref}
  previousDate={neighbors.previous?.date}
  nextHref={nextHref}
  nextDate={neighbors.next?.date}
  categoryIcons={categoryIcons}
  tagIcons={tagIcons}
  categoryHref={(name) => taxonomyFilterHref("category", name)}
  tagHref={(name) => taxonomyFilterHref("tag", name)}
  photosSlot={<JournalPhotosCard date={entry.date} />}
  isBusy={isPending}
/>
```

**Used by:** [/modules/journal/entries/[id]](src/app/(protected)/modules/[slug]/entries/[id]/entry-screen.tsx).

**Notes:** blank fields are hidden, so an entry only shows what it recorded. Edit and Delete
are disabled while `entry.isLocked` because the `updateEntry`/`deleteEntry` use-cases reject
a locked entry. It stays free of any mapping dependency — the caller renders the map.

Each location row is prefixed with a **1-based `#n`** matching the numbered pins the caller's
multi-pin map draws, so the list and the map can be read against each other. The numbering is
list order — positional, not an id — so it's derived here rather than stored.

Carries the `print-sheet` class used by the `@media print` block in `globals.css`.

The date/time is the visually dominant element in the header (`text-xl`, a calendar icon
before the date and a clock icon before the time), with Previous/Next — when supplied —
in their own row above it, left-aligned, with the neighbour-date caption filling the
remaining width. When `calendarHref` is supplied, a running-shoe icon sits immediately
right of the date/time as the "Jump to calendar" control — it deep-links to the Calendar
section opened on that entry's date. Categories, Tags, and the `Entry #/created/updated`
line live inside a
`CollapsibleCard` titled "Misc Info", collapsed by default — secondary metadata the reader
doesn't need on first look, same rationale `CollapsibleCard` uses everywhere else.

**Category/tag icons sit at the right of the date/time row**, after a `flex-1` spacer, so
they read as a glance-level summary of what an entry is *about* without the names competing
with the date for attention (the names stay in Misc Info). Each is 24px with the
category/tag name as its `title` **and** its `alt`, so hovering names it and a screen reader
reads it — an icon-only row would otherwise be unlabelled. A name with no uploaded icon is
skipped rather than given a placeholder: a row of empty squares says less than a shorter
row. Because the header is `flex-wrap`, the icons drop to their own line on a narrow screen
instead of squeezing the date.

---

## PhotoLightbox

A full-screen overlay showing one photo at a time, with keyboard and on-screen navigation
through a set. Reach for this whenever a grid of thumbnails needs a "look at this one
properly" view.

- **Source:** [src/components/photo-lightbox.tsx](src/components/photo-lightbox.tsx)
- **Import:** `import { PhotoLightbox, type LightboxPhoto } from "@/components/photo-lightbox";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `photos` | `LightboxPhoto[]` — `{ src, caption, subcaption? }` | Plain data: URLs the caller already built, not records. `caption` is both the header text and the image's `alt`; `subcaption` is a second, dimmer line (the journal uses it for the folder a photo came from). |
| `index` | `number` | Which photo is shown. **An out-of-range index renders nothing**, so a single state variable can mean "closed". |
| `onIndexChange` | `(index: number) => void` | Raised with the index to move to. The component never wraps past either end — it hides the arrow instead, so the caller decides if wrapping is wanted. |
| `onClose` | `() => void` | Raised by Escape, the close button, and a backdrop click. |
| `className?` | `string` | |

```tsx
{lightbox && (
  <PhotoLightbox
    photos={lightbox.photos}
    index={lightbox.index}
    onIndexChange={(index) => setLightbox({ ...lightbox, index })}
    onClose={() => setLightbox(undefined)}
  />
)}
```

**Used by:** the journal entry's "Pictures of this date" card
([journal-photos-card.tsx](src/app/(protected)/modules/[slug]/entries/[id]/journal-photos-card.tsx)).

**Notes.** Keys are bound on the **document**, not on a focused element: the overlay is
opened by clicking a thumbnail elsewhere, so there is no reliable focus target and arrow
keys have to work without clicking the overlay first. Only Escape / ← / → are
`preventDefault`ed, so other shortcuts still work. Body scroll is locked while it's up —
on a phone a swipe would otherwise scroll the page behind the photo.

The image is `object-contain`, so a portrait photo and a panorama both fit without cropping.
Close and prev/next are 40–48px circles rather than small glyphs, because on a phone they
are the only way out and the backdrop is mostly covered by the image. Carries `no-print`: a
printed page has nothing to click.

Uses a plain `<img>`, not `next/image` — these bytes come from a session-gated route over a
NAS share, which `next/image` can't optimize anyway.

---

## PhotoOfTheDay / PhotoOfTheDayButton

**The photographs for a date, or for a span of dates.** A dialog that lists the archive
folders matching what you asked for, opens each one into a thumbnail grid on demand, and
hands a click off to [`PhotoLightbox`](#photolightbox). `PhotoOfTheDayButton` is the small
picture-glyph control that opens it.

- **Source:** [src/components/photo-of-the-day.tsx](src/components/photo-of-the-day.tsx)
- **Import:** `import { PhotoOfTheDay, PhotoOfTheDayButton } from "@/components/photo-of-the-day";`
- **Client component:** yes

### `PhotoOfTheDay`

| Prop | Type | Notes |
|------|------|-------|
| `date?` | `string` | One day, `YYYY-MM-DD`. Pass this **or** `range`, never both. |
| `range?` | `{ from: string; to: string }` | A span of days, inclusive at both ends. |
| `onFindFolders` | `(query) => Promise<PhotoFoldersOutcome>` | The cheap lookup — folder names and counts. Wired to a server action by the caller. |
| `onListPhotos` | `(query, relativePath, includeAll) => Promise<PhotoContentsOutcome>` | The expensive one; called only when a folder is opened. |
| `photoUrl` | `(relativePath: string) => string` | Builds the URL for a photo's bytes. |
| `onClose` | `() => void` | Escape, the ✕, an overlay click, and the Close button. |
| `autoLookup?` | `boolean` | Default `false`. `true` looks on mount — for a caller whose button press already meant "go and look". |
| `className?` | `string` | Applied to the dialog panel, merged last. |

### `PhotoOfTheDayButton`

| Prop | Type | Notes |
|------|------|-------|
| `hint` | `string` | Native tooltip **and** the accessible name — the glyph has no text. Say which photos it shows. |
| `onOpen` | `() => void` | Fired on press. The handler already calls `stopPropagation`. |
| `className?` | `string` | Merged last, so a caller can resize it. |

```tsx
const [request, setRequest] = useState<{ date: string } | undefined>();

<PhotoOfTheDayButton hint="Photos from 2026-08-27" onOpen={() => setRequest({ date: "2026-08-27" })} />

{request && (
  <PhotoOfTheDay
    date={request.date}
    autoLookup
    photoUrl={(path) => `/api/journal/photos?path=${encodeURIComponent(path)}`}
    onFindFolders={(query) => findPhotoFoldersAction((query as { date: string }).date)}
    onListPhotos={(query, path, all) => listPhotosInFolderAction((query as { date: string }).date, path, all)}
    onClose={() => setRequest(undefined)}
  />
)}
```

**Used by:** the Journal calendar's per-day and per-month photo buttons
[journal-calendar-view.tsx](src/app/(protected)/modules/[slug]/journal-calendar-view.tsx),
and the entry viewer's "Pictures of this date" card
[journal-photos-card.tsx](src/app/(protected)/modules/[slug]/entries/[id]/journal-photos-card.tsx).
Both go through one wiring island,
[journal-photos-host.tsx](src/app/(protected)/modules/[slug]/journal-photos-host.tsx) —
copy that pattern rather than binding the actions again, and note *why* it exists: a
registered component may not import a server action, so the binding has to live in the
route.

**Notes worth knowing before reusing it:**

- **It owns no open/closed state** — guard it with `{isOpen && <PhotoOfTheDay …>}` like
  any [`Modal`](#modal). **Key it by what it shows** (`key={date}`); pointing a mounted
  dialog at a new date would leave the previous scan's folders under the new title.
- **A single date and a range are the same code path.** The domain treats one day as the
  range `date..date`, so the day case cannot drift from the range case.
- **Nothing is scanned until a folder is opened.** The folder list is names and counts
  only, which is what keeps an eight-month range instant to open even though scanning it
  whole would read thousands of JPEG headers over SMB.
- **Responsive:** the dialog is a `Modal` (already responsive); its thumbnail grid is five
  columns wide, three below 1024px and two below 640px, via `max-lg:` / `max-sm:`. The
  button is 24px square and is meant to sit inside a larger tap target — resize it with
  `className` when it stands alone.

## TickerViewer

**Everything about one ticker, in one dialog.** **Three tabs, each a stack of
`CollapsibleCard`s** — not nested tabs:

| Tab | Cards | Source |
|---|---|---|
| **Our data** | Holdings · Transactions · Watchlist & income | what MyHomeBase recorded |
| **Market** | Quote · Price History · Events · Risks · News | the market-data provider |
| **Yahoo Finance Detail** | Market Data · Company Profile · Analysis recommendations · Valuation & Trading · Financials · Key statistics | the provider's reference record |

The grouping is the feature — a reader should never have to guess whether a number came from
their broker export or from Yahoo. The one place the two meet is the **My past performance**
chart inside Transactions, which plots your trades against the market's close either side of
each one, marks dividends, splits and reported quarters on the same line, and lists every
plotted point with a Note column and a per-row News button.

- **Source:** [src/components/ticker-viewer.tsx](src/components/ticker-viewer.tsx)
- **Import:** `import { TickerViewer, type TickerFavoriteControl, type TickerPanelGroup, type TickerPanelState } from "@/components/ticker-viewer";`
- **Client component:** yes
- **Data comes from the lib:** panel shapes are `@/lib/ticker-overview`'s and
  `@/lib/ticker-detail`'s return types; this file renders them and computes nothing beyond
  display formatting.

| Prop | Type | Notes |
|------|------|-------|
| `ticker` | `string` | Header, logo, and the accessible dialog name. |
| `activeGroup` | `TickerPanelGroup` | Controlled — `"own"`, `"market"`, `"yahoo"`. Controlled so the host can start that tab's fetches on entry. |
| `onSelectGroup` | `(group: TickerPanelGroup) => void` | Fired by the tab strip. |
| `onClose` | `() => void` | Passed through to `Modal`. |
| `ownData` | `TickerPanelState<TickerOwnData>` | Feeds all three "Our data" cards. |
| `tradeTimeline` | `TickerPanelState<TickerTradeTimeline>` | The "My past performance" chart inside Transactions. A provider call, so the table renders first and the chart fills in. |
| `quote` / `priceSeries` / `events` / `risk` / `news` | `TickerPanelState<…>` | One per Market card. |
| `detail` | `TickerPanelState<TickerYahooDetail>` | Feeds **all six** Yahoo cards from one fetch. |
| `range` | `TickerHistoryRange` | The chart window currently selected. |
| `onSelectRange` | `(range: TickerHistoryRange) => void` | Fired by the 1M/3M/6M/1Y/5Y buttons. |
| `ranges?` | `readonly TickerHistoryRange[]` | Windows to offer. Defaults to all five. |
| `onRecalculateRisk` | `() => void` | The Risks card's header action. Risk is cached indefinitely, so this is the only thing that refreshes it. |
| `favorite?` | `TickerFavoriteControl` — `{ isFavorite, onToggle, isSaving? }` | The star in the header. **Optional** — omit it and no star renders, so a caller with no favorites store still works. Controlled by the host, which owns the state and the server action; the press feels instant because the host flips its own state before the round trip. `isSaving` disables the star in flight so it can't be double-pressed. |
| `className?` | `string` | Applied to the `Modal` panel, merged last. |

`TickerPanelState<T>` is `{ data?: T; error?: string; isLoading?: boolean }` — one shape for
all four states, so every panel's loading and error treatment is identical.

```tsx
{openTicker && (
  <TickerViewerHost ticker={openTicker} onClose={() => setOpenTicker(undefined)} />
)}
```

**Used by:** Stocks & ETFs — positions, transactions, watchlist, Daily Glance and all three
Chart & Analysis grids, all through the route-local host
[ticker-viewer-host.tsx](src/app/(protected)/modules/[slug]/ticker-viewer-host.tsx). That host
owns the fetching and the lazy-load policy; `TickerViewer` itself fetches nothing. Call sites
render `TickerCell` (also in the host file) for the clickable logo-plus-symbol grid cell.

**Notes:** it does **not** use `Tabs`, which owns its own active-tab state — the group has to
be controlled so the host can start that tab's fetches on entry. The internal strip copies
`Tabs`' styling exactly so it still reads as the same system.

**Sections are cards, not sub-tabs.** Every tab used to hold a second tab strip; that was
replaced because sub-tabs hid sections a reader wanted side by side and gave no clue which
ones had anything in them. Don't reintroduce one.

**Loading is per tab, not per card.** Entering a tab loads everything on it, so scrolling
never meets a card that hasn't started. Two consequences worth knowing: the Yahoo tab is a
**single** request (`quoteSummary` takes a module list, so six sections cost one round-trip),
and Risks reads a cached row rather than recomputing.

**Card open-state.** Our data and Market open all their cards; the Yahoo tab opens only
**Market Data** — six expanded reference tables is a very long page, and the rest are looked
up deliberately. Yahoo coverage varies wildly by symbol, so each section renders only the
fields that came back and says "the provider reports no …" for a whole missing module rather
than drawing a grid of dashes (verified against an ETF: zero dashes on screen).

It opens at `Modal` `size="window"` — the draggable 80% floating variant, with a maximize
button for the full-bleed treatment. Gain/loss is `text-emerald-400` / `text-red-400` per
design.md's semantic-color exception, and zero stays `text-muted` so a flat day doesn't read
as a win.

---

## ViewportProvider / useViewport

Tells a client component whether the app is drawing the **compact** layout (below 1024px)
or the **full** one.

- **Source:** [src/components/viewport-context.tsx](src/components/viewport-context.tsx)
- **Import:** `import { useIsCompact, useViewport } from "@/components/viewport-context";`
- **Client component:** yes. Mounted once in [src/app/layout.tsx](src/app/layout.tsx), so
  `/login` gets it too.

```tsx
const isCompact = useIsCompact();
return isCompact ? <PositionCards rows={rows} /> : <DataGrid rows={rows} />;
```

**Try `max-lg:` first.** This exists for the cases where the small screen needs a
genuinely *different component*, not a restyled one — a 1498px table becoming a card
list. Restyling costs nothing and can't regress desktop; forking costs a second
component to maintain. See `design.md` → *Phone and desktop*.

**Where the value comes from.** Decided on the server so the first paint is already
right, from three signals in `src/lib/viewport` — a layout the reader pinned on the
Account page, then the measured width, then a User-Agent guess in `proxy.ts`. The
guess is what makes the first request work before any JavaScript runs; `ViewportCorrector`
replaces it with the real width on mount, which is what fixes iPads (Safari reports them
as a Mac) and phones in desktop-request mode.

**Related pieces:** `ViewportCorrector` (measures and corrects, renders nothing) and
`ViewportToggle` (the Account-page override). Neither is meant to be used elsewhere.

---

## IconSetProvider / useIconSet

Context supplying the active module icon set to `ModuleIcon` and the card/nav badges.

- **Source:** [src/components/icon-set-context.tsx](src/components/icon-set-context.tsx)
- **Import:** `import { IconSetProvider, useIconSet } from "@/components/icon-set-context";`
- **Client component:** yes

```tsx
// Mounted once, in the root layout, with the server-read `icon_set` setting:
<IconSetProvider value={{ id: iconSetId, colorful }}>{children}</IconSetProvider>

// Anywhere below it:
const { id, colorful } = useIconSet();
```

**Used by:** [src/app/layout.tsx](src/app/layout.tsx) (provider); `ModuleIcon` and
`ModuleCarousel` (consumers).

**Notes:** the default outside a provider is the `"classic"` set, so anything rendered
standalone still shows a valid glyph.

---

## ModuleIcon / ModuleIconPreview

Render a module glyph in the active icon set (`ModuleIcon`) or in an explicitly named set
(`ModuleIconPreview`, for the Admin icon picker that must show every set at once).

- **Source:** [src/components/module-icons.tsx](src/components/module-icons.tsx)
- **Import:** `import { ModuleIcon, ModuleIconPreview } from "@/components/module-icons";`
- **Client component:** yes

```tsx
<ModuleIcon name={module.icon} className="h-6 w-6 text-brass" />
<ModuleIconPreview setId="classic" name="building" className="h-5 w-5" />
```

**Used by:** `ModuleCarousel`, `ModuleRail`, and the icon picker at
[admin/configuration/icons/page.tsx](src/app/(protected)/admin/configuration/icons/page.tsx).

**Notes:** falls back to the hand-drawn "classic" set for any missing glyph. Monochrome
sets inherit `currentColor` from `className`; color sets carry their own fills.

---

## SlotIcon

The icon for one named *place* in the app (a "slot"), honouring any per-slot override an
admin has uploaded.

- **Source:** [src/components/slot-icon.tsx](src/components/slot-icon.tsx)
- **Import:** `import { SlotIcon } from "@/components/slot-icon";`
- **Client component:** yes

```tsx
// The slot definition comes from the registry, so this stays presentation-only.
const QUOTE_SLOT = getIconSlot("homescreen_card_daily_quote");

<SlotIcon slot={QUOTE_SLOT} className="h-4 w-4" />
```

**Used by:** [daily-quote-widget.tsx](src/app/(protected)/daily-quote-widget.tsx) (the
pilot call site), [module-rail.tsx](src/components/module-rail.tsx) (the app mark, via
`fallback`), and the per-slot list in
[admin/configuration/icons/slots-view.tsx](src/app/(protected)/admin/configuration/icons/slots-view.tsx).

**When to reach for this instead of `TreeIcon`.** Use `SlotIcon` where the icon marks a
*location* someone might reasonably want to re-skin — a home-screen card, a nav section,
an admin page. Keep using `TreeIcon` directly for **row actions** (pencil, trash, refresh)
and for **state glyphs** (`star` vs `star-filled`): those are buttons and states, not
places, and letting someone override half of a state pair would break the distinction the
pair exists to carry. It is the same line `ALWAYS_CLASSIC` draws inside `tree-icons.tsx`.

**`fallback` — bespoke default artwork.** One position's original icon is not a glyph from
either table: `chrome_rail_home`, the app mark atop the module rail, is the multi-colour
brass `AppIcon`. A `defaultConcept` can't express that, so `SlotIcon` takes an optional
`fallback` node rendered when no override exists, and `ModuleRail` passes `<AppIcon />`.
Don't use it elsewhere — a glyph worth slotting belongs in `TREE_ICONS`/`MODULE_ICONS`
where every set can draw its own. This is for application identity, which no set should
redraw.

**Two ways a slot reaches the screen.** A *named call site* names its slot directly, as the
Daily Quote card does. A *data-driven nav* can't — `SectionPanel` renders six different navs
from data — so that one takes an `iconNamespace` prop and derives the slot per row with
`sectionSlotId(namespace, node.id)`. If you are adding a nav rather than a card, follow the
second pattern; see `modules.md` → *Icon slots*.

**Notes:** resolution runs *override → the active set's glyph for the slot's default
concept → hand-drawn fallback*. The last two steps are exactly what `TreeIcon`/`ModuleIcon`
already do, so **an un-overridden slot renders identically to the call site it replaced** —
which is what lets call sites convert one at a time. An SVG override is inlined (so it
tints to the theme accent like a built-in glyph); a raster override is an `<img>` and keeps
its own colors. See [src/lib/icons/slots.ts](src/lib/icons/slots.ts) for the registry and
`migrations/0066_create_icon_slot_overrides.md` for the reasoning.

---

## IconOverrideProvider / useIconOverrides

Context supplying the per-slot icon overrides that apply to the *active* icon set.

- **Source:** [src/components/icon-override-context.tsx](src/components/icon-override-context.tsx)
- **Import:** `import { IconOverrideProvider, useIconOverrides } from "@/components/icon-override-context";`
- **Client component:** yes

```tsx
// Mounted once in the root layout, inside IconSetProvider:
<IconOverrideProvider value={iconOverrides}>{children}</IconOverrideProvider>
```

**Used by:** [src/app/layout.tsx](src/app/layout.tsx) (provider); `SlotIcon` (consumer).

**Notes:** the map is read server-side scoped to the selected set, so it only holds
overrides that can actually apply. Empty outside a provider, so a `SlotIcon` rendered
standalone still draws its default glyph.

---

## useCurrentPosition

Reads the device's GPS coordinates from the browser's Geolocation API, on demand.

- **Source:** [src/components/use-current-position.ts](src/components/use-current-position.ts)
- **Import:** `import { useCurrentPosition } from "@/components/use-current-position";`
- **Client component:** yes (it's a hook — the caller must be `"use client"`)

```tsx
const { request, isLocating } = useCurrentPosition();

const located = await request();
if (!located.ok) { setError(located.error); return; }
const { latitude, longitude } = located.position;
```

`request()` never rejects: it resolves to `{ ok: true, position }` or
`{ ok: false, error }`, where `error` is already a sentence fit to show a user. The message
is *returned* rather than only stored in state, because reading the hook's `error` right
after `await request()` would give you the previous render's value. `error` and `isLocating`
are still exposed for views that prefer to render status declaratively.

**Used by:** the Journal new-entry form's *GPS + Weather* button
([journal-entry-form.tsx](src/app/(protected)/modules/[slug]/journal-entry-form.tsx)), which
chains it into `reverseGeocodeAction` and `fetchWeatherAction`.

**Two constraints worth knowing before you reach for this:**

- **It needs HTTPS.** In a non-secure context the browser removes
  `navigator.geolocation` outright, and the hook reports that as unsupported. Plain-HTTP
  LAN access silently has no GPS.
- **Permission is per-origin and sticky.** A denial persists until the user clears it in
  browser settings, so always keep a manual path available — don't make GPS the only way
  to set a location.

Why it's a component and not `src/lib/`: geolocation is a browser global, and nothing under
`src/lib/` may depend on the browser or React. The hook is the adapter; the coordinates it
returns go to `lib` use-cases through server actions.

---

## Unregistered helpers

Small pieces under `src/components/` that support the components above. Reuse them, but
they don't get their own registry section.

| Helper | Source | What it is |
|--------|--------|-----------|
| `CHART_CATEGORICAL_COLORS`, `CHART_STATUS_COLORS`, `CHART_CHROME` | [chart-colors.ts](src/components/chart-colors.ts) | The fixed 8-hue chart palette + grid/axis chrome. All charts read from here. |
| `pointLabelContent` | [chart-point-labels.tsx](src/components/chart-point-labels.tsx) | Builds the `<LabelList content>` renderer every chart uses for value labels, so a labelled point looks identical on a line, a column and a bar. Labels wear the muted **text** token, never the series colour. |
| `hasFullBars`, `normalizeCandleBar`, `candleDomain`, `candleGeometry` | [chart-candle.ts](src/lib/shared/chart-candle.ts) | `ChartCandle`'s rules — which series is complete enough to draw as candles, a bar's direction and consistent extremes, the axis window, and the body/wick geometry. In the lib, so they're tested. |
| `TreeIcon`, `hasTreeIcon`, `useTreeIconIsColorful` | [tree-icons.tsx](src/components/tree-icons.tsx) | Resolves a section-panel icon key (`sliders`, `list`, `chart`, `upload`, `quote`, `grid`, `window`, `palette`, `info`, `history`, `users`, `database`, `shapes`, `shield`) to an SVG **in the reader's chosen icon set** — same `useIconSet()` context `ModuleIcon` reads, so a section panel matches the module rail. Falls back to the hand-drawn glyph in this file for any concept the active set lacks. Also carries the row-action glyphs `pencil`, `trash`, `refresh`, `search`, `flash`, `star`, `star-filled`, `heart` and `heart-filled`, which stay hand-drawn and monochrome in *every* set: they're buttons, not destinations, and colored artwork on an inline delete weakens the destructive read. `star`/`star-filled` are the same silhouette outline and solid, because on a favorite toggle the fill *is* the state — a themed set redrawing one of them would lose that. `heart`/`heart-filled` are the same pair for the home screen's favourite *photo* toggle — a second favourite mark on purpose, because the star means "a symbol I want to reach quickly" and the heart means "a picture I want to keep". `flash` is the one *filled* row action — an outlined bolt at 16px is two zig-zag strokes that read as noise, and the solid shape also says "this acts" rather than "this opens something". `useTreeIconIsColorful(name)` reports whether the active set will draw its own colors, so a caller can drop an accent tint that would otherwise muddy them. Renders `null` for an unknown key — fine in a row where the label carries the meaning, so check `hasTreeIcon` first anywhere the icon is the *only* content or an unknown key is a blank button. |
| `AppIcon` | [app-icon.tsx](src/components/app-icon.tsx) | The app wordmark glyph. Takes raw `SVGProps`. |
| `AdminIcon` | [admin-icon.tsx](src/components/admin-icon.tsx) | The Administration glyph. Takes raw `SVGProps`. |
| `MODULE_ICON_GLYPHS`, `ModuleIconSetId` | [module-icon-sets.generated.ts](src/components/module-icon-sets.generated.ts) | Generated — do not hand-edit. |
| `ComponentName` | [_component-template.tsx](src/components/_component-template.tsx) | The starting point for a new reusable component. |


## MusicPlayerProvider

Owns the app's single `<audio>` element and the state around it. Mount once, in the
protected layout — not inside a page. Don't reach for it to play a one-off sound
effect; it models "the thing the user is listening to".

- **Source:** [src/components/music-player-provider.tsx](src/components/music-player-provider.tsx)
- **Import:** `import { MusicPlayerProvider, useMusicPlayer } from "@/components/music-player-provider";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `children` | `ReactNode` | Wraps the page so playback outlives navigation. |
| `actions` | `MusicQueueActions` | The queue's server actions. **Injected, not imported** — see the note below. |

```tsx
<MusicPlayerProvider actions={musicQueueActions}>
  <main>{children}</main>
  <MusicPlayerBar />
</MusicPlayerProvider>
```

**Used by:** [the protected layout](src/app/(protected)/layout.tsx), which builds the
`actions` object from [music-queue-actions.ts](src/app/(protected)/modules/[slug]/music-queue-actions.ts).

**What `useMusicPlayer()` returns:** the transport (`play`, `toggle`, `next`, `previous`,
`seek`, `setVolume`, `stop`), the queue (`queue`, `currentEntryId`, `repeatMode`,
`isShuffled`, `remainingSeconds`, `isQueueLoading`) and the queue's operations (`enqueue`,
`playEntry`, `shuffleQueue`, `removeFromQueue`, `clearQueue`, `setRepeatMode`).

**Notes:** `useMusicPlayer()` returns `undefined` outside the provider rather than
throwing, so a component can render in isolation. The `<audio>` element is created
imperatively in an effect, not rendered as JSX — nothing should be able to unmount it
by re-rendering, and it needs no DOM position. It lives **above** `children` for one
reason: an `<audio>` element stops when it unmounts, so a player inside the music
module's page would cut out the moment you navigated to another module. Also exports
`trackStreamUrl`, `albumCoverUrl` and `formatPlayerTime` so route paths and `mm:ss`
formatting live in one place.

**Why `actions` is a prop.** The queue lives in the database
([migration 0059](migrations/0059_create_music_play_queue.md)), so the provider has to
call server actions — but a component under `src/components/` importing from `src/app/`
inverts the dependency the layering rests on, and this file would have been the only one
in the registry doing it. So the actions arrive as a prop, exactly as `logoutAction` does
for [`NavMenus`](#navmenus). It also means the provider can be rendered in a test with
a fake and no database. `QueueRow`/`QueueViewModel` are declared **in the component** for
the same reason; the server action's return type is checked against them at the mount site.

**The queue is server state, not component state.** `player.queue` is a rendering copy —
every change goes through an action and the response replaces it. Two consequences worth
knowing: the queue survives a reload (and is restored **paused**, since a page that starts
playing music on load is hostile and blocked anyway), and it is **shared** — there is one
queue for the household, so two people using the app at once change the same list. Queue
entries are addressed by **entry id, not track id**, because the same track may be queued
twice. `stop` (the bar's Close button) deliberately leaves the stored queue alone;
`clearQueue` is what empties it.

## MusicPlayerBar

The persistent "what's playing" strip pinned to the bottom of every authenticated
page — **above the section nav, not over it**. Renders `null` when nothing is playing,
so it costs no space until first use. For the full-size artwork-and-lyrics screen use
the module's player view instead.

- **Source:** [src/components/music-player-bar.tsx](src/components/music-player-bar.tsx)
- **Import:** `import { MusicPlayerBar } from "@/components/music-player-bar";`
- **Client component:** yes

Takes no props — it reads everything from `useMusicPlayer()`.

Carries a **queue button** (a badge with the queued-track count) linking to
`/modules/music-library/queue`, in both the compact and desktop arms.

```tsx
<MusicPlayerBar />
```

**Used by:** [the protected layout](src/app/(protected)/layout.tsx).

**Notes:** one of the few components that genuinely switches on `useIsCompact()`
rather than restyling with `max-lg:`. A desktop transport row (previous/play/next, a
full scrubber, elapsed and total times, volume) does not shrink into 375px — narrow
gets a different arrangement: cover, title, one play/pause button, and the scrubber
reduced to a 2px progress hairline along the top edge. Transport buttons are 44px
touch targets. Uses a plain `<img>` for cover art, not `next/image`: nothing in this
app imports it, and `scripts/publish-nas.mjs` notes `sharp` is never loaded — pulling
it in would add a platform binary to the NAS deploy for no benefit.

**Where it sits.** The bottom edge is shared, so neither bar hard-codes its own offset:
`globals.css` publishes `--tree-nav-height` from `html[data-treenav]` (4rem for the bar,
1.5rem for the puck, `0px` with no nav on the page) and the player's
`.music-player-pinned` reads it as its `bottom`. The player used to sit at `bottom-0` and
covered the section nav — the one control you always want reachable. It now mirrors its
own presence onto `html[data-music-player="compact" | "full"]`, the same seam `SectionPanel`
uses, which is what lets the server-rendered `.app-main` reserve room for a bar whose
presence only the client knows. Adding anything else to that edge means publishing a
height the same way, not adding another `bottom-0`.

## SelectionBar

Multi-select over a list, plus the action bar that appears once something is ticked. Use it
for any "tick several rows, then do one thing with them" flow. If the bulk action is a
single button with no target to choose, this is more machinery than you need — render your
own button.

- **Source:** [src/components/selection-bar.tsx](src/components/selection-bar.tsx)
- **Import:** `import { SelectionBar, useSelection } from "@/components/selection-bar";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `selection` | `SelectionState` | From `useSelection()`. Hold it in the parent so it survives paging. |
| `pageIds` | `readonly number[]` | Ids on the current page, for "select all". |
| `targets` | `readonly SelectionTarget[]` | `{ id, label, detail? }`. Empty renders the picker as a disabled hint. |
| `onSend` | `(targetId: number) => void` | A target was chosen. The caller performs the action. |
| `onCreateAndSend?` | `(name: string) => void` | Omit to hide the create affordance. |
| `isBusy?` | `boolean` | Disables the controls while the caller works. |
| `message?` | `string` | Feedback from the caller — "Added 3 to Favourites", or an error. |
| `itemNoun?` | `string` | Default `"item"`. Singularised automatically. |
| `targetNoun?` | `string` | Default `"list"`. |
| `children?` | `ReactNode` | Extra controls, rendered before the picker. |
| `className?` | `string` | Merged last. |

```tsx
const selection = useSelection();

<SelectionBar
  selection={selection}
  pageIds={rows.map((row) => row.id)}
  targets={playlists.map((p) => ({ id: p.id, label: p.name, detail: String(p.trackCount) }))}
  onSend={(id) => addToPlaylist(id, [...selection.selected])}
  onCreateAndSend={(name) => createThenAdd(name)}
  itemNoun="track"
  targetNoun="playlist"
/>
```

**Used by:** the Music Library's Library section, via
[music-selection.tsx](src/app/(protected)/modules/[slug]/music-selection.tsx) — a thin
wrapper that supplies the playlists and calls the server actions.

**Notes:** the split is the point. This component is **pure presentation** — it imports only
React and `Button`, performs no fetching and calls no server action, so it knows about *ids*
and *targets* rather than tracks and playlists. Anything module-specific belongs in a
wrapper, as `PlaylistSelectionBar` does.

`useSelection` holds **ids, not rows**, so a selection survives paging: tick three, page
forward, tick two more, add all five. It is deliberately *not* URL-backed — a tick is
transient working state, and forty ids in a query string is unreadable (contrast the active
view and chosen group in that module, which *are* in the URL because they are worth
linking).

Positioned `sticky bottom-2`, not `fixed`: the app already has a `fixed` music player bar
owning the bottom of the viewport, and two stacked fixed bars fight. With nothing ticked it
collapses to just the "select all" link, so it costs almost no space while browsing.

---

## Registering a new component

1. Create `src/components/<kebab-name>.tsx` from `_component-template.tsx`.
2. Add a row to the [Index](#index) table.
3. Add a section below using this shape:

~~~markdown
## ComponentName

One-line purpose, and when *not* to use it.

- **Source:** [src/components/component-name.tsx](src/components/component-name.tsx)
- **Import:** `import { ComponentName } from "@/components/component-name";`
- **Client component:** yes/no

| Prop | Type | Notes |
|------|------|-------|
| `propA` | `string` | |
| `propB?` | `boolean` | Default `false`. |

```tsx
<ComponentName propA="value" />
```

**Used by:** [module or route](path).

**Notes:** variants, accessibility, gotchas.
~~~
