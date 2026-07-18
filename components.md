# Components Registry

The single source of truth for reusable UI components. **Before building any UI element,
read this file first.** If a registered component fits, import it and use it — do not
rebuild it, and do not create a second component that does the same thing under a
different name.

## How this works

1. **Reuse first.** Search this registry before writing a new presentational component.
2. **Ask before creating a new reusable one.** When about to build something that looks
   reusable (a card, modal, table, form field, badge…) and nothing here fits, ask in one
   line: *"This looks reusable — should we make it a shared component? If so, give it a
   name."* Then wait for the name.
3. **On a name, create and register.** Put it at `src/components/<kebab-name>.tsx` with a
   `PascalCase` export, then add a row to the table below. Start from
   `src/components/_component-template.tsx`, not from scratch.
4. **One-offs stay local.** Page-specific UI that won't be reused lives in the route's
   `view.tsx` and is *not* registered. Don't ask about obviously trivial local markup.
5. **The table is the index, not the full docs.** Full prop documentation lives in each
   component's own file (typed props + JSDoc). Keep rows short so this file doesn't rot.

## Rules for every registered component

- Pure presentation: **props in, events out.** No data fetching, no business logic, no
  `lib` imports beyond types. Data arrives as props from the page that fetched it.
- Accepts a `className` passthrough and forwards unknown props where sensible, so callers
  can extend it without forking it.
- Follows the conventions of the components already listed here (styling approach,
  prop-naming, variant patterns).

## Registered components

| Name | Import | Purpose | Key props | Notes |
|------|--------|---------|-----------|-------|
| `CollapsibleCard` | `@/components/collapsible-card` | Card with a header that expands/collapses its body | `title`, `defaultOpen?`, `children`, `className?` | Client component. Used for the "Module Settings [Module Name]" section on the Module Configuration screen. |
| `ModuleCard` | `@/components/module-card` | Card linking to a module's route | `name`, `description?`, `href`, `code`, `icon`, `className?` | Used on the home screen grid. `code` is a short reference tag (e.g. "REI") shown on the card's tab; `icon` is a key rendered via `ModuleIcon`. |
| `Sidebar` | `@/components/sidebar` | Collapsible left-hand nav listing module links | `links` (each with `slug`, `name`, `href`, `code`, `icon`, `hint?`), `appName`, `currentUser` (`{ id, fullName, avatarMimeType?, updatedAt? }`), `showAdmin`, `logoutAction`, `className?` | Client component; persists collapsed state to `localStorage`. Shows icon-only when collapsed. Always includes a "Home" link (`/`) above the module list; the "Administration" link only renders when `showAdmin` is true. Footer row is an `Avatar` + `currentUser.fullName` linking to `/account`, plus a separate "Log out" button wired to the `logoutAction` server action prop. `hint` is shown as the link's hover tooltip. Rendered in `src/app/(protected)/layout.tsx`. |
| `TreeNav` | `@/components/tree-nav` | Hierarchical parent/child nav tree with hover hints | `nodes` (each with `id`, `label`, `href?`, `hint?`, `icon?`, `children?`), `collapsible?`, `className?` | Client component; owns its own width (`w-64`/`w-16`) when `collapsible`, persists collapsed state to `localStorage`. Collapsed view flattens the tree into one icon-only row per node. A node without `href` is a group heading only (expand/collapse, not navigable, when expanded). `icon` is a key rendered via `TreeIcon` (`src/components/tree-icons.tsx`). Used by the Administration section (`src/app/(protected)/admin`). |
| `DataGrid` | `@/components/data-grid` | Generic tabular grid for admin-style lists | `columns` (each with `key`, `header`, `render(row)`, `className?`), `rows`, `getRowKey`, `emptyMessage?`, `className?` | Not client/server-specific — plain function component. Each column's `render` decides the cell content, including per-row action buttons. Used by the User Management screen (`src/app/(protected)/admin/user-management`); generic enough for any future admin table. |
| `Avatar` | `@/components/avatar` | A user's profile picture, or an initials-circle fallback | `userId`, `avatarMimeType?`, `fallbackText`, `size?` (`"sm" \| "md"`), `version?`, `className?` | Not client/server-specific. Renders `<img src="/api/users/{userId}/avatar">` when `avatarMimeType` is set (that route is the only place avatar bytes are read/served), else the initial of `fallbackText`. Pass `version` (e.g. the user's `updatedAt`) as a cache-busting query param when the image may have just changed. Used in the `Sidebar` footer, the `/account` self-service page, and the User Management grid. |
| `Tabs` | `@/components/tabs` | Tabbed panel — one active tab's content shown at a time | `items` (each with `key`, `label`, `content`), `defaultActiveKey?`, `className?` | Client component; owns its own active-tab state. `content` is any `ReactNode` supplied by the caller. Used by the Property Lookup result view in the Real Estate module (`src/app/(protected)/modules/[slug]/property-watch-view.tsx`). |
| `ChartLine` | `@/components/chart-line` | Time-series line chart (one or more series) | `data`, `series` (each with `key`, `label`, `color?`), `xKey`, `formatValue?`, `formatX?`, `height?`, `className?` | Client component wrapping Recharts. Follows the dataviz skill: fixed 8-hue categorical palette (`@/components/chart-colors`, unregistered helper — not its own row), 2px lines, no legend for a single series, hairline gridlines. Used for account performance history and position price history in the Stocks & ETFs module. |
| `ChartBar` | `@/components/chart-bar` | Horizontal bar chart for part-to-whole / magnitude comparisons across a few categories | `items` (each with `key`, `label`, `value`, `color?`), `formatValue?`, `height?`, `className?` | Client component wrapping Recharts. Per the dataviz skill, part-to-whole with a handful of categories defaults to a categorical bar, not a pie — each bar is direct-labeled with its value (the required relief for any categorical slot under 3:1 contrast) and the category's own axis tick supplies identity, so no legend box. Used for stock/ETF/other allocation and dividend-income breakdown in the Stocks & ETFs module. |

## Entry template (copy a row when registering)

```
| `ComponentName` | `@/components/component-name` | one-line purpose | `propA`, `propB?` | variants / accessibility notes |
```

> Note: imports use the `@/` path alias (`@/* -> src/*`, configured in `tsconfig.json`).
