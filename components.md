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
| `CollapsibleCard` | `@/components/collapsible-card` | Card with a header that expands/collapses its body | `title`, `defaultOpen?`, `children`, `className?` | *Example row — create the file when this component is actually built.* |
| `ModuleCard` | `@/components/module-card` | Card linking to a module's route | `name`, `description?`, `href`, `code`, `icon`, `className?` | Used on the home screen grid. `code` is a short reference tag (e.g. "REI") shown on the card's tab; `icon` is a key rendered via `ModuleIcon`. |
| `Sidebar` | `@/components/sidebar` | Collapsible left-hand nav listing module links | `links` (each with `slug`, `name`, `href`, `code`, `icon`, `hint?`), `appName`, `className?` | Client component; persists collapsed state to `localStorage`. Shows icon-only when collapsed. Always includes a "Home" link (`/`) above the module list. `hint` is shown as the link's hover tooltip. Rendered in `src/app/layout.tsx`. |
| `TreeNav` | `@/components/tree-nav` | Hierarchical parent/child nav tree with hover hints | `nodes` (each with `id`, `label`, `href?`, `hint?`, `children?`), `className?` | Client component. A node without `href` is a group heading only (expand/collapse, not navigable). Used by the Administration section (`src/app/admin`). |

## Entry template (copy a row when registering)

```
| `ComponentName` | `@/components/component-name` | one-line purpose | `propA`, `propB?` | variants / accessibility notes |
```

> Note: imports use the `@/` path alias (`@/* -> src/*`, configured in `tsconfig.json`).
