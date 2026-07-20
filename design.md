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
**Ember Ledger**, **Aurora Deck**, and **BMS** (Bristol Myers Squibb brand purple on
charcoal gray) — all dark. There is no light theme; don't design against a light
background. Adding another theme is just another entry in `COLOR_THEMES`
(`src/lib/settings/themes.ts`) — no component changes needed.

**Exception — semantic red/green stays literal.** Gain/loss (stocks up/down) and
error/success text use fixed Tailwind colors (`text-red-400`, `text-emerald-400`, and
`Button`'s `danger` variant), not theme tokens. Red should mean "down/error" and green
should mean "up/success" the same way in every theme — that's a semantic color, not a
brand accent. Use shades in the 300–400 range (not 600–700) since every background here
is dark; a 600–700 shade tuned for a light page will read as low-contrast mud.

## Type

Fonts are also theme-driven — each of the 3 themes pairs a display face, a body face,
and a mono face (wired in `src/app/layout.tsx`, all loaded via `next/font/google`, and
selected by the CSS vars `--font-display` / `--font-body` / `--font-mono-code`).

- Headings, module names, page titles → `font-display` (`font-display` Tailwind class).
- Body copy, labels, buttons → `font-body` (Tailwind default `font-sans`, already applied to `<body>`).
- Reference codes, ledger-style numbers, tags (e.g. the module card's "REI" tab) → `font-mono` (Tailwind `font-mono`).

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
  accent treatment on hover (a soft ring/lift), never a blurred drop shadow — a blurred
  black shadow was tuned for a light "paper" background and is invisible on a dark one.

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
   text-xl text-ink` — see `real-estate-view.tsx`'s summary row.
5. Don't introduce a new shadow style, a new font, or a new literal color. If none of
   the existing patterns fit, that's a signal to stop and ask whether it's a new
   reusable component (per `components.md`'s process), not a one-off style.
