# Design System — Read Before Styling Any UI

This is the contract for how MyHomeBase looks. It applies to every page, view, and
component you build or touch. It doesn't replace `components.md` (the reusable-component
registry) — read that too. This file is about the *visual language* those components
express: colors, type, and the "3D switch" button treatment.

## The token system, not literal colors

Never hardcode a hex value or a literal Tailwind color for anything structural
(backgrounds, borders, text, accents). Everything goes through the 9 CSS custom
properties defined in `src/lib/settings/themes.ts` and exposed as Tailwind utilities via
`@theme inline` in `src/app/globals.css`:

| Token | Tailwind utility | Role |
|---|---|---|
| `paper` | `bg-paper` | Page background (darkest surface) |
| `paperRaised` | `bg-paper-raised` | Card/panel/input background (one step up from `paper`) |
| `ink` | `text-ink` | Primary text |
| `line` | `border-line` / `bg-line` | Borders, dividers, hairlines |
| `muted` | `text-muted` | Secondary text |
| `mutedInverse` | `text-muted-inverse` | Reserved tertiary text slot (currently unused by any component — available if a third text weight is ever needed) |
| `brass` | `bg-brass` / `text-brass` | Accent — icons, active states, primary fills |
| `brassDark` | `text-brass-dark` / `var(--brass-dark)` | Accent shadow/hover shade, and the text color on `brassSoft` chips |
| `brassSoft` | `bg-brass-soft` | Low-emphasis tinted chip/badge background |

Any of these can be swapped at runtime (Admin → Configuration → Color Themes), so a
component that reaches for a literal color instead of a token will look right in one
theme and wrong in the others. The shipped themes are **Signal Deck** (default),
**Ember Ledger**, **Aurora Deck**, **BMS** (Bristol Myers Squibb brand purple on charcoal
gray), **Midnight Slate** (blue-slate with an ice-blue accent) and **Copper Vault**
(near-black with a copper accent) — all dark — plus two light themes, **Daybreak** (rose
on warm paper) and **Sea Glass** (deep teal on cool off-white). Adding another theme is
just another entry in `COLOR_THEMES` (`src/lib/settings/themes.ts`) — no component
changes needed, as long as it reuses an existing `FontKey` (a new font also needs wiring
in `src/app/layout.tsx`).

**Design for both light and dark.** Because light themes exist, don't assume a dark page.
Structural styling must go through the tokens above (they invert correctly), and any
raw shadow/overlay you add must read acceptably on a light *and* a dark surface — prefer
a soft, low-opacity black (`rgba(0,0,0,0.2–0.45)`) over a heavy one. In Daybreak,
`paperRaised` (pure white) is *lighter* than `paper`, the inverse of the dark themes;
the token roles still hold (raised = one step toward the surface), so token-based code
needs no branching.

**Exception — semantic red/green stays literal.** Gain/loss (stocks up/down) and
error/success text use fixed Tailwind colors (`text-red-400`, `text-emerald-400`, and
`Button`'s `danger` variant), not theme tokens. Red should mean "down/error" and green
should mean "up/success" the same way in every theme — that's a semantic color, not a
brand accent. Use shades in the 300–400 range (not 600–700): they're tuned for the dark
themes, and a 600–700 shade would read as low-contrast mud there. (Known trade-off: on
the Daybreak light theme these 300–400 shades run a little light; acceptable for now —
don't branch per-theme to fix it unless asked.)

## Type

Fonts are also theme-driven — each of the 3 themes pairs a display face, a body face,
and a mono face (wired in `src/app/layout.tsx`, all loaded via `next/font/google`, and
selected by the CSS vars `--font-display` / `--font-body` / `--font-mono-code`).

- Headings, module names, page titles → `font-display` (`font-display` Tailwind class).
- Body copy, labels, buttons → `font-body` (Tailwind default `font-sans`, already applied to `<body>`).
- Reference codes, ledger-style numbers, tags (e.g. the sidebar's per-module "REI" code) → `font-mono` (Tailwind `font-mono`).

Don't reach for a font family outside this trio. If a new theme is added, give it its
own display/body/mono choice in `themes.ts` rather than hardcoding a font anywhere in
`src/app` or `src/components`.

## The signature: buttons are switches, cards are calm

The defining visual idea of this app is that **buttons are physical** — a hard-edged
offset shadow that collapses when pressed, like a switch — while **cards and surfaces
stay quiet** (a border, maybe a soft glow on hover; never the offset-shadow treatment).
Don't blur this line by giving a card a hard shadow or a button a soft one.

- **Any clickable action styled as a standalone button** (form submit, page-level CTA,
  a discrete "Add/Save/Cancel/Remove" action) → use `Button` (`@/components/button`).
  Don't hand-roll a `bg-brass ...` button; if `Button`'s variants don't fit, extend
  `Button`, don't create a parallel implementation.
- **Inline row-level actions inside a table** (an "Edit"/"Delete" text link inside a
  `DataGrid` row) stay as plain underlined text links, not `Button` — a pill button
  inside every table row is visually loud and out of place. Use `text-brass-dark
  hover:underline` for a neutral row action, `text-red-400 hover:underline` for a
  destructive one.
- **Cards** (`ModuleCard` and any future card) use `border border-line` plus a subtle
  accent treatment on hover (a soft ring/lift). Keep any hover shadow soft and low-opacity
  so it reads on both light and dark surfaces (`ModuleCard` pairs a `ring` with a gentle
  `rgba(0,0,0,0.35)` lift).
- **Icon badge** — the standard "identity" mark for a card or feature tile is a solid
  rounded-square accent tile with the glyph knocked out of it: `rounded-xl bg-brass
  text-paper` with the icon in `text-paper`. This reads correctly in every theme for free
  — `paper` is the darkest surface in the dark themes (dark glyph on a bright accent) and
  the lightest in Daybreak (near-white glyph on the rose accent). Don't hardcode a white
  or black glyph; use `text-paper`. See `ModuleCard`.

## Icon sets are user-selectable

Module icons (the glyphs on the home cards and in the sidebar) are driven by a
user-chosen **icon set**, the same way colors are driven by a theme — picked at Admin →
Configuration → Icons, persisted as the `icon_set` setting, and registered in
`ICON_SETS` (`src/lib/settings/icon-sets.ts`). The active set is read server-side in the
root layout and supplied through `IconSetProvider`; `ModuleIcon` consumes it, so call
sites never name a set — they just render `<ModuleIcon name="building" />` and get the
current set's glyph.

- **Glyph data is baked, not fetched.** The SVG bodies live in
  `src/components/module-icon-sets.generated.ts`, generated from the `@iconify-json/*`
  devDependencies by `scripts/gen-icon-glyphs.mjs` (`npm run gen:icons`) — no runtime icon
  dependency. To add a set: add an entry to `ICON_SETS`, add its source + candidate map to
  the generator, run `npm run gen:icons`, done.
- **Monochrome vs. colorful.** A set is either theme-tinted (monochrome — inherits
  `currentColor`, sits in the solid-accent icon badge) or `colorful: true` (full-color
  artwork that carries its own fills). Colorful sets **can't** take the accent tint, so
  `ModuleCard` swaps the accent badge for a neutral `bg-paper` tile behind them. Honor
  the `colorful` flag from `useIconSet()` anywhere you place a module icon on a tile.
- **"classic"** is the original hand-drawn set (`module-icons.tsx`) and the fallback for
  any concept a generated set happens to lack — never let a module icon render nothing.
- This setting covers *module* icons only. Admin chrome (the `TreeNav` gear/grid/etc.
  icons and `AdminIcon`) stays on the hand-drawn monochrome glyphs regardless of set.

## Printing (and "Save as PDF")

Printable screens opt in through two classes, defined in the `@media print` block
in `src/app/globals.css` — don't hand-roll print CSS per view:

- **`print-sheet`** on the element that should be printed. The rule hides
  everything on the page and then reveals that element's subtree, so it doesn't
  depend on how the surrounding app chrome is structured. The sheet prints as
  **black on white** regardless of the active theme (every theme but Daybreak is
  dark, so inheriting the tokens would waste ink and read poorly).
- **`no-print`** on anything inside the sheet that shouldn't appear on paper —
  action buttons, nav links, inline controls.

The caller triggers printing itself (`window.print()`), so a reusable component
takes an `onPrint` callback rather than reaching for the browser API. See
`JournalEntryCard` and `/modules/[slug]/entries/[id]`.

## Building a new module's UI

When scaffolding a new module's `view.tsx`:

1. Read `components.md` first and reuse what's there (`CollapsibleCard`, `DataGrid`,
   `Tabs`, `ChartLine`/`ChartBar`, `Button`, etc.) — most module UIs are composed
   entirely from existing components plus a form.
2. Form inputs: `rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink
   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass` — copy this
   exact className (see any `*-view.tsx` for a live example) rather than inventing a new
   input style.
3. Form submit/cancel actions: `Button` (`variant="primary"` for submit, `"secondary"`
   for cancel, `"danger"` for destructive).
4. Stat tiles / summary numbers: `rounded-xl border border-line p-4` container, label in
   `text-xs font-medium uppercase tracking-wide text-muted`, value in `font-display
   text-xl text-ink` — keep to this container/label/value structure.
5. Don't introduce a new shadow style, a new font, or a new literal color. If none of
   the existing patterns fit, that's a signal to stop and ask whether it's a new
   reusable component (per `components.md`'s process), not a one-off style.
