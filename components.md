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
| [`CollapsibleCard`](#collapsiblecard) | A titled section that expands/collapses | [src/components/collapsible-card.tsx](src/components/collapsible-card.tsx) | yes |
| [`Tabs`](#tabs) | One-of-N panels in the same space | [src/components/tabs.tsx](src/components/tabs.tsx) | yes |
| [`ModuleCarousel`](#modulecarousel) | The home screen's module picker (coverflow) | [src/components/module-carousel.tsx](src/components/module-carousel.tsx) | yes |
| [`AppChrome`](#appchrome) | The app's nav shell — top bar + compact module tabs | [src/components/app-chrome.tsx](src/components/app-chrome.tsx) | yes |
| [`ViewportSwitch`](#viewportswitch) | The global compact/full switch | [src/components/viewport-switch.tsx](src/components/viewport-switch.tsx) | yes |
| [`TreeNav`](#treenav) | Hierarchical parent/child nav tree | [src/components/tree-nav.tsx](src/components/tree-nav.tsx) | yes |
| [`Avatar`](#avatar) | A user's picture, or initials fallback | [src/components/avatar.tsx](src/components/avatar.tsx) | no |
| [`TickerLogo`](#tickerlogo) | A stock/ETF logo, or a monogram fallback | [src/components/ticker-logo.tsx](src/components/ticker-logo.tsx) | yes |
| [`FileDropzone`](#filedropzone) | Drag-and-drop file picker | [src/components/file-dropzone.tsx](src/components/file-dropzone.tsx) | yes |
| [`CsvMappingTable`](#csvmappingtable) | Map a CSV's columns to target fields | [src/components/csv-mapping-table.tsx](src/components/csv-mapping-table.tsx) | yes |
| [`IconSelect`](#iconselect) | A dropdown whose options carry an image | [src/components/icon-select.tsx](src/components/icon-select.tsx) | yes |
| [`ChartLine`](#chartline) | Time-series line chart | [src/components/chart-line.tsx](src/components/chart-line.tsx) | yes |
| [`ChartBar`](#chartbar) | Category comparison / part-to-whole | [src/components/chart-bar.tsx](src/components/chart-bar.tsx) | yes |
| [`ChartXY`](#chartxy) | User-configurable line/bar/scatter/area + zoom | [src/components/chart-xy.tsx](src/components/chart-xy.tsx) | yes |
| [`ChartToolbar`](#chartoolbar) | A chart's gear control — **not called directly** | [src/components/chart-toolbar.tsx](src/components/chart-toolbar.tsx) | yes |
| [`JournalEntryCard`](#journalentrycard) | Full detail sheet for one journal entry | [src/components/journal-entry-card.tsx](src/components/journal-entry-card.tsx) | yes |
| [`TickerViewer`](#tickerviewer) | Full record dialog for one ticker — 3 tabs of cards | [src/components/ticker-viewer.tsx](src/components/ticker-viewer.tsx) | yes |
| [`IconSetProvider`](#iconsetprovider--useiconset) / `useIconSet` | Active module icon set (context) | [src/components/icon-set-context.tsx](src/components/icon-set-context.tsx) | yes |
| [`ViewportProvider`](#viewportprovider--useviewport) / `useViewport` | Compact vs full layout (context) | [src/components/viewport-context.tsx](src/components/viewport-context.tsx) | yes |
| [`ModuleIcon`](#moduleicon--moduleiconpreview) / `ModuleIconPreview` | Render a module glyph | [src/components/module-icons.tsx](src/components/module-icons.tsx) | yes |

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

## CollapsibleCard

A titled card whose body expands/collapses. The standard wrapper for a secondary section
(a form, a settings block, a detail panel) that shouldn't dominate the page.

- **Source:** [src/components/collapsible-card.tsx](src/components/collapsible-card.tsx)
- **Import:** `import { CollapsibleCard } from "@/components/collapsible-card";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `title` | `string` | Always-visible header text. **Plain text, not HTML** — write `&` not `&amp;`. |
| `defaultOpen?` | `boolean` | Default `false`. Ignored when `open` is supplied. |
| `open?` | `boolean` | Supply with `onOpenChange` for controlled use; omit both to let the card own its state. |
| `onOpenChange?` | `(open: boolean) => void` | Called with the state being moved to. |
| `headerAction?` | `ReactNode` | Rendered on the title line, left of the chevron, **always visible**. Clicking it does not toggle the card. |
| `children` | `ReactNode` | Body. |
| `className?` | `string` | |

```tsx
<CollapsibleCard title="Add an entry" defaultOpen>
  <JournalEntryForm onSubmit={handleCreate} />
</CollapsibleCard>
```

Controlled, with an action that stays reachable while collapsed:

```tsx
<CollapsibleCard
  title="Refresh & snapshot"
  open={isOpen}
  onOpenChange={setIsOpen}
  headerAction={<Button size="sm" onClick={handleRun}>Refresh All</Button>}
>
  <RunProgress />
</CollapsibleCard>
```

**Used by:** Module Configuration
[admin/configuration/modules/page.tsx](src/app/(protected)/admin/configuration/modules/page.tsx),
MyJournal, CSV Analysis, SQL Explorer, Stocks & ETFs, User Management, and the About
screen's "Application & System Info" card
[admin/about/view.tsx](src/app/(protected)/admin/about/view.tsx). The controlled +
`headerAction` combination is the Stocks dashboard's refresh card
[stock-refresh-panel.tsx](src/app/(protected)/modules/[slug]/stock-refresh-panel.tsx).

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
[admin/about/view.tsx](src/app/(protected)/admin/about/view.tsx).

---

## ModuleCarousel

**The home screen's module picker.** A coverflow of large module graphics: the selected
module centred and full size, its neighbours scaled down and dimmed either side. The
**title sits above the graphic and the description below it**, and the centred graphic is
the launch target.

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
It replaced a grid of `ModuleCard`s, which was deleted with its last caller.

**Rotating.** Prev/next buttons, ← / → while the carousel has focus, clicking a neighbour,
tapping a dot, or swiping. It **wraps** — with only a handful of modules a dead arrow at
either end reads as a bug. It does **not** auto-advance: nav that moves on its own steals
focus and slides the click target out from under the cursor.

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
  `flat-color` in Admin → Configuration → Icons and it renders as real artwork rather than
  a blown-up line icon.

**Notes:** the tile behind a *glyph* is a solid-accent square for monochrome icon sets and
a neutral `bg-paper` one for colorful sets (`useIconSet().colorful`, the same rule the
sidebar badge uses). An uploaded image always gets the neutral tile and `object-cover` —
tinting somebody's artwork would be wrong.

---

## AppChrome

**The app's navigation shell.** A top bar always, plus a bottom module bar on the compact
layout. Mounted once by `(protected)/layout.tsx`; you should not need a second instance.

- **Source:** [src/components/app-chrome.tsx](src/components/app-chrome.tsx)
- **Import:** `import { AppChrome } from "@/components/app-chrome";`
- **Client component:** yes (persists its minimise state to `localStorage`)

| Prop | Type | Notes |
|------|------|-------|
| `links` | `AppChromeLink[]` — `{ slug, name, href, code, icon, hint? }` | One per module. |
| `appName` | `string` | Wordmark; hidden below `lg` to leave room. |
| `currentUser` | `{ id, fullName, avatarMimeType?, updatedAt? }` | The avatar, linking to `/account`. |
| `showAdmin` | `boolean` | Gates the Administration button. |
| `logoutAction` | `() => Promise<void>` | Server action behind the log-out button. |
| `viewportPinned` | `boolean` | Passed to `ViewportSwitch` so it can show the pin. |
| `className?` | `string` | |

**It replaced `Sidebar`.** A 240px slab down the left is a desktop pattern that cost a
phone 62% of its screen and, being `fixed` above the content, swallowed taps meant for the
page underneath. Navigation moved to the edges so every layout gets the full width.

**Where the modules live is the only thing that differs by layout.** On `full` they sit in
the top bar beside everything else; on `compact` there is no room, so they move to a bottom
bar — **icons only**, and within thumb reach rather than in the corner hardest to hit
one-handed. Everything else (app name, view switch, admin, account, log out) is identical.

**Both bars minimise** to a small floating puck — top-left for the bar, bottom-right for
the tabs — and the state is remembered.

**How the shell reacts to it.** `(protected)/layout.tsx` is a *server* component and this
state is client-side, so they meet through attributes rather than props: `AppChrome`
mirrors onto `<html data-appbar>` / `<html data-moduletabs>`, and `globals.css` pads
`.app-main` accordingly. A script in the root layout applies the stored values **before
first paint** — without it every page renders padded for both bars and then shoves when the
mount effect reads `localStorage`. That script mutates `<html>`, which is why the root
layout sets `suppressHydrationWarning`.

The bottom bar's allowance is keyed to `html[data-viewport="compact"]`, **not** a media
query — the layout can be pinned, so a 1440px window can legitimately be in compact, and a
`max-width` rule would render the bar with no room reserved for it.

---

## ViewportSwitch

**The one control that drives the whole UI's layout**, in the top bar. `full` is the
original desktop treatment; `compact` swaps in the components customised for a narrow
screen (`DataGridCompact`, the bottom module bar, tighter carousel artwork).

- **Source:** [src/components/viewport-switch.tsx](src/components/viewport-switch.tsx)
- **Client component:** yes

Choosing **pins** the layout, so `ViewportCorrector` stops second-guessing it and the choice
sticks across devices and sessions. Right-click unpins and goes back to matching the screen.
The Account page describes the current state but has no control of its own — two controls
for one setting only invite them to disagree.

---

## TreeNav

Hierarchical parent/child nav with hover hints. Use for a section with grouped
sub-pages (like Administration), not for the top-level module list.

- **Source:** [src/components/tree-nav.tsx](src/components/tree-nav.tsx)
- **Import:** `import { TreeNav, type TreeNode } from "@/components/tree-nav";`
- **Client component:** yes (persists its state to `localStorage`)

| Prop | Type | Notes |
|------|------|-------|
| `nodes` | `TreeNode[]` — `{ id, label, href?, hint?, icon?, children? }` | A node **without** `href` is a group heading (expand/collapse only). `icon` is a key rendered via `TreeIcon` — currently `sliders`, `list`, `chart`, `upload`, `quote`, `grid`, `window`, `palette`, `info`, `history`, `users`, `database`, `shapes`. |
| `collapsible?` | `boolean` | Default `false`. When true it owns its width and shows the two collapse controls — three states, see below. |
| `storageKey?` | `string` | Where the state is remembered. Defaults to `"myhomebase:tree-nav-collapsed"`. **Pass a distinct key for every collapsible tree** — two trees sharing the default collapse together. |
| `className?` | `string` | |

```tsx
const nodes: TreeNode[] = [
  {
    id: "configuration",
    label: "Configuration",
    icon: "sliders",
    children: [
      { id: "modules", label: "Modules", href: "/admin/configuration/modules", icon: "grid" },
      { id: "icons", label: "Icons", href: "/admin/configuration/icons", icon: "shapes" },
    ],
  },
];

<TreeNav nodes={nodes} collapsible />
```

**Used by:** Administration — [admin/admin-shell.tsx](src/app/(protected)/admin/admin-shell.tsx),
node list in [admin/nav.ts](src/app/(protected)/admin/nav.ts); the Expense module's six
sections — [expense-nav.tsx](src/app/(protected)/modules/[slug]/expense-nav.tsx); and the
Stocks & ETFs module's eight — [stock-nav.tsx](src/app/(protected)/modules/[slug]/stock-nav.tsx).
All three are `collapsible`, each with its own `storageKey`.

**Collapsing — three states, two controls.** `full` (`w-64`, icon + label, the tree
nested) → `rail` (`w-16`, icons only, flattened to one row per node) → `strip` (`w-3`,
just the accent edge). The model the retired `Sidebar` used, down to the
controls: the `&rsaquo;` chevron — the same one the node rows and `CollapsibleCard` use,
rotated 180° when expanded — moves between `full` and `rail`, a `&laquo;` button drops to
`strip`, and clicking the strip returns to `rail`. **Two controls rather than one cycling
through three**, because a single control can only go one way and overshooting would mean
going all the way round.

In `strip` the tree isn't merely narrowed — it isn't rendered at all, replaced by the
clickable edge. A hidden tree you can still Tab into is worse than no tree.

Because a collapsible tree sets its own width at every breakpoint, don't put a width on its
wrapper — that pins the rail open (see
[expense-section.tsx](src/app/(protected)/modules/[slug]/expense-section.tsx)).

**Migrating the stored value.** The `storageKey` used to hold a boolean (`"true"` =
collapsed) and now holds the state name. `TreeNav` reads the legacy boolean and maps it to
`rail`/`full`, so an existing preference survives — don't drop that branch.

**Nav overlap:** `AppChrome`'s bars are `fixed` at `z-40`. Keep other stacked elements
below that, and dialogs at `Modal`'s `z-50`, or an overlay won't cover them.

**Note:** the active node is matched on `pathname`, so each node needs a real route —
a query parameter or client-side state won't highlight. Keep the node list and any
labels in a **plain** module (not the `"use client"` nav file) if server components
read them too; exports of a client module reach the server as unusable references.
See [expense-sections.ts](src/app/(protected)/modules/[slug]/expense-sections.ts) and
[stock-sections.ts](src/app/(protected)/modules/[slug]/stock-sections.ts).

---

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

**Used by:** the `AppChrome` top bar, [/account](src/app/(protected)/account/view.tsx), and the
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
and the "My past performance" chart in
[ticker-viewer.tsx](src/components/ticker-viewer.tsx) *(the `renderDot` example)*.

---

## ChartBar

Horizontal bars for part-to-whole or magnitude comparison across a handful of categories.
**Use this instead of a pie chart** (per the dataviz skill).

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
| `type` | `"line" \| "bar" \| "scatter" \| "area"` | |
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
axis/type/format pickers stay local to that view).

**Its zoom controls ride in the shared `ChartToolbar`** rather than a row of their own, so
the chart has one strip of controls instead of two stacked. They're passed as `children`;
`showToolbar={false}` hides the gear but keeps them.

**Point labels follow the zoom window,** not the whole dataset — zooming in re-picks the
visible high and low instead of pointing off-screen. Scatter draws none: its marks *are* the
points, with no free end to print on.

**Notes:** single shared y-scale, never dual-axis. Colors come from
`@/components/chart-colors` by series order.

---

## ChartToolbar

**A chart's own gear control** — value labels, point markers, legend, gridlines. You do not
call this: all three chart components mount one, so every chart in the app offers the same
options in the same place. It's registered because it's the contract for what a reader can
change, and because a fourth chart type must reuse it rather than invent a control strip.

- **Source:** [src/components/chart-toolbar.tsx](src/components/chart-toolbar.tsx)
- **Import:** `import { ChartToolbar, useChartDisplay } from "@/components/chart-toolbar";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `value` / `onChange` | `ChartDisplay` / `(next) => void` | The chart owns the state; this only edits it. |
| `labelModes?` | `readonly PointLabelMode[]` | Which modes to offer. Defaults to all four; `ChartBar` passes `["none", "all"]`. |
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

## JournalEntryCard

Full-detail sheet for one journal entry — every stored field, plus optional Print / Edit /
Lock / Delete actions. Journal-specific but registered because the entry screen and any
future print/export view share it.

- **Source:** [src/components/journal-entry-card.tsx](src/components/journal-entry-card.tsx)
- **Import:** `import { JournalEntryCard } from "@/components/journal-entry-card";`
- **Client component:** yes

| Prop | Type | Notes |
|------|------|-------|
| `entry` | `JournalEntry` (type from `@/lib/journal`) | |
| `onPrint?` | `() => void` | Omit to hide Print. |
| `onEdit?` | `() => void` | Omit to hide Edit. Disabled while locked. |
| `onShowLocation?` | `(location: EntryLocation) => void` | Adds a per-location "Map" button. |
| `onToggleLock?` | `(nextLocked: boolean) => void` | Omit to hide Lock. |
| `onDelete?` | `() => void` | Omit to hide Delete. Guarded by an inline confirm. |
| `isBusy?` | `boolean` | Disables the actions while the caller works. |
| `className?` | `string` | |

```tsx
<JournalEntryCard
  entry={entry}
  onPrint={() => window.print()}
  onEdit={() => setEditing(true)}
  onShowLocation={(location) => setMapLocation(location)}
  onToggleLock={(nextLocked) => handleToggleLock(nextLocked)}
  onDelete={handleDelete}
  isBusy={isPending}
/>
```

**Used by:** [/modules/journal/entries/[id]](src/app/(protected)/modules/[slug]/entries/[id]/entry-screen.tsx).

**Notes:** blank fields are hidden, so an entry only shows what it recorded. Edit and Delete
are disabled while `entry.isLocked` because the `updateEntry`/`deleteEntry` use-cases reject
a locked entry. It stays free of any mapping dependency — the caller renders the map.
Carries the `print-sheet` class used by the `@media print` block in `globals.css`.

---

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
- **Import:** `import { TickerViewer, type TickerPanelGroup, type TickerPanelState } from "@/components/ticker-viewer";`
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

**Used by:** `ModuleCarousel`, `AppChrome`, and the icon picker at
[admin/configuration/icons/page.tsx](src/app/(protected)/admin/configuration/icons/page.tsx).

**Notes:** falls back to the hand-drawn "classic" set for any missing glyph. Monochrome
sets inherit `currentColor` from `className`; color sets carry their own fills.

---

## Unregistered helpers

Small pieces under `src/components/` that support the components above. Reuse them, but
they don't get their own registry section.

| Helper | Source | What it is |
|--------|--------|-----------|
| `CHART_CATEGORICAL_COLORS`, `CHART_STATUS_COLORS`, `CHART_CHROME` | [chart-colors.ts](src/components/chart-colors.ts) | The fixed 8-hue chart palette + grid/axis chrome. All charts read from here. |
| `pointLabelContent` | [chart-point-labels.tsx](src/components/chart-point-labels.tsx) | Builds the `<LabelList content>` renderer every chart uses for value labels, so a labelled point looks identical on a line, a column and a bar. Labels wear the muted **text** token, never the series colour. |
| `TreeIcon` | [tree-icons.tsx](src/components/tree-icons.tsx) | Resolves a `TreeNav` icon key (`sliders`, `quote`, `grid`, `window`, `palette`, `info`, `history`, `users`, `database`, `shapes`) to an SVG. Renders `null` for an unknown key. |
| `AppIcon` | [app-icon.tsx](src/components/app-icon.tsx) | The app wordmark glyph. Takes raw `SVGProps`. |
| `AdminIcon` | [admin-icon.tsx](src/components/admin-icon.tsx) | The Administration glyph. Takes raw `SVGProps`. |
| `MODULE_ICON_GLYPHS`, `ModuleIconSetId` | [module-icon-sets.generated.ts](src/components/module-icon-sets.generated.ts) | Generated — do not hand-edit. |
| `ComponentName` | [_component-template.tsx](src/components/_component-template.tsx) | The starting point for a new reusable component. |

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
