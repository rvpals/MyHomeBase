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
- Reference codes, ledger-style numbers, tags (e.g. a module's "REI" code) → `font-mono` (Tailwind `font-mono`).

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
- **Cards** (`CollapsibleCard` and any future card) use `border border-line` plus a subtle
  accent treatment on hover (a soft ring/lift). Keep any hover shadow soft and low-opacity
  so it reads on both light and dark surfaces — a gentle `rgba(0,0,0,0.35)` lift, never
  the hard offset shadow that marks a `Button`.
- **No surface takes the button treatment.** The old left `Sidebar` was the one exception —
  a raised slab with `Button`'s hard offset shadow rotated to point right. It was retired
  with the move to `AppChrome`, and the exception went with it. The nav bars are quiet
  surfaces: a hairline border and a soft low-opacity shadow, nothing more. Don't give a
  panel a hard shadow without asking.

### The four elevation classes — reuse these, don't hand-roll a shadow

The lifts above are named classes in `globals.css`, not arbitrary values at the call site.
Reach for one of these before writing a new `shadow-[...]`:

| Class | For | Shape |
|---|---|---|
| `.nav-raised-top` | A bar pinned at the **top**, casting down over content — app bar, section bar | inset 1px highlight + soft wide cast, downward |
| `.nav-raised-bottom` | A bar pinned at the **bottom** — the compact module tabs | the same, cast **upward** |
| `.card-raised` | A card's resting lift — `CollapsibleCard` | inset highlight + hairline ring + tight cast |
| `.card-raised-hover` | The same card's `:hover` | the cast grows and softens |

Two things they encode that are easy to get wrong:

- **A cast shadow falls away from the light**, so a bottom-pinned bar's must point *up*, at
  the content it overlaps — not down off the screen. That's the only difference between the
  two `nav-raised-*` classes, and it's why they're a pair rather than one class.
- **The ring goes outside the border, not instead of it.** `border-line` is deliberately
  low-contrast in every theme (Daybreak's is `#E7E2E4` on white), so definition comes from
  stacking a soft dark ring around it. Replacing the token with a literal would kill the
  theme inversion.

All alphas stay inside the safe range above (white ≤ 0.12, black ≤ 0.45), so every one of
these reads on Daybreak as well as on the dark themes. Hover **grows the shadow rather than
translating the element** — a card whose whole header is a toggle must not move out from
under the pointer mid-click.

### Layout utilities

The same rule — a named class in `globals.css`, not an arbitrary value at the call site —
covers the responsive and safe-area idioms. Full reasoning under "Phone and desktop".

| Class | For |
|---|---|
| `.card-grid` | A variable-length row of roomy cards; columns size themselves, capped at 24rem |
| `.tile-grid` | The same for small fixed-ratio tiles, capped at 7rem |
| `.music-player-pinned` | The music player's bar, pinned above whatever the section nav occupies |
| `.app-bar` / `.app-bar-puck` | The top app bar's height and its minimised puck's offset, both including the top inset |
| `.tree-nav-sticky` / `.tree-nav-puck` | The section bar pinned to the bottom edge, and its puck |
| `--tree-nav-height` | How much of the bottom edge the section nav occupies — read it, don't re-measure it |
- **Icon badge** — the standard "identity" mark for a card or feature tile is a solid
  rounded-square accent tile with the glyph knocked out of it: `rounded-xl bg-brass
  text-paper` with the icon in `text-paper`. This reads correctly in every theme for free
  — `paper` is the darkest surface in the dark themes (dark glyph on a bright accent) and
  the lightest in Daybreak (near-white glyph on the rose accent). Don't hardcode a white
  or black glyph; use `text-paper`. See `ModuleCarousel`.

## Icon sets are user-selectable

Module icons (the graphics on the home carousel and the glyphs in the nav bars) are driven by a
user-chosen **icon set**, the same way colors are driven by a theme — picked at Admin →
Configuration → Icons, persisted as the `icon_set` setting, and registered in
`ICON_SETS` (`src/lib/settings/icon-sets.ts`). The active set is read server-side in the
root layout and supplied through `IconSetProvider`; `ModuleIcon` consumes it, so call
sites never name a set — they just render `<ModuleIcon name="building" />` and get the
current set's glyph.

- **Glyph data is baked, not fetched.** The SVG bodies live in
  `src/components/module-icon-sets.generated.ts` (the 13 module concepts) and
  `src/components/tree-icon-sets.generated.ts` (the tree-nav section concepts), both
  generated from the `@iconify-json/*` devDependencies by `scripts/gen-icon-glyphs.mjs`
  (`npm run gen:icons`) — no runtime icon dependency. To add a set: add an entry to
  `ICON_SETS`, add its source + candidate maps (`CAND` and `TREE_CAND`) to the generator,
  run `npm run gen:icons`, done. **Name candidates explicitly and look at the result** —
  the generator's keyword fallback is a safety net, not a plan; left to itself it picks
  things like `school-bus-side` for a classroom.
- **Monochrome vs. colorful.** A set is either theme-tinted (monochrome — inherits
  `currentColor`, sits in the solid-accent icon badge) or `colorful: true` (full-color
  artwork that carries its own fills). Colorful sets **can't** take the accent tint, so
  `ModuleCarousel` swaps the accent tile for a neutral `bg-paper` one behind them. Honor
  the `colorful` flag from `useIconSet()` anywhere you place a module icon on a tile.
  **The set choice matters most on the home carousel**, where the glyph is rendered at
  ~200px: a monochrome set reads as a large flat symbol, while `fluent-3d` or `flat-color`
  reads as artwork.
- **"classic"** is the original hand-drawn set (`module-icons.tsx`) and the fallback for
  any concept a generated set happens to lack — never let a module icon render nothing.
- **The setting covers module icons *and* `TreeNav` section icons.** `TreeIcon` reads the
  same `useIconSet()` context, so a module's section bar matches its toolbar — including
  going full-color together. Two deliberate exceptions stay hand-drawn in every set:
  the row-action glyphs (`pencil`, `trash`, `refresh`), because they're buttons rather than
  destinations and color on an inline delete weakens the destructive read; and `AdminIcon`.
  Where a nav icon carries the brass accent, drop it for a colorful set —
  `useTreeIconIsColorful(name)` answers that, and `TreeNav`'s `AccentTreeIcon` is the
  worked example.
- **No set covers every concept, and that's designed for.** `TreeIcon` falls back to its
  hand-drawn glyph per *concept* (not per set), so a gap costs one icon rather than the
  whole nav — `flat-color` has no paperclip, for instance.

## Installed-app surfaces (manifest, icons, launch screens)

The app is installable to a phone's home screen, which adds three surfaces that live
*outside* the React tree and therefore outside the theme system.

- **The manifest** (`src/app/manifest.ts`) is generated per-request, so `name`,
  `theme_color` and `background_color` follow the current application name and color
  theme. Its `id` is the fixed string `"/"` and **must never change** — the browser
  otherwise derives the app's identity from `start_url`, and changing that URL later
  would register a *second* installed app rather than updating the existing one.
- **Home-screen shortcuts** (long-press the icon) are built from the visible modules,
  not a hardcoded list, so renaming or hiding a module in admin carries through.
  Android shows at most four and reads them only at install time — an existing install
  keeps its old shortcuts until it's reinstalled, so don't expect a shortcut change to
  reach a phone that already has the app.
- **iOS launch images** are the 24 PNGs in `public/splash/`, generated by
  `scripts/gen-splash.mjs` (`npm run gen:splash`) and emitted as raw
  `<link rel="apple-touch-startup-image">` tags in the root layout — Next has no
  metadata API for them. Sizing logic lives in `src/lib/pwa`.
  **These are static files and cannot follow the active color theme**: they bake in the
  default theme's background, so someone running a different theme sees the default
  theme's background for the moment the app launches. Re-run `npm run gen:splash` after
  changing the default theme's background or the app icon.

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
`JournalViewer` and `/modules/[slug]/entries/[id]`.

## Page width and the nav bars

Every full-page screen — module, Administration, or the home grid — is laid out in **one**
container: `PAGE_CONTAINER` from
[`src/app/(protected)/page-container.ts`](src/app/(protected)/page-container.ts)
(`mx-auto w-full max-w-[160rem]`). Don't invent a per-screen `max-w-*`. Screens used to pick
their own (`3xl` for most modules, `4xl` for the admin forms, `6xl` for the wide ones), which
left most of a large display as empty margin either side of the content. The 160rem cap sits
past a 2560px monitor on purpose so it doesn't bind on one; it's there only to stop a table
spanning a 3440px ultrawide.

**Navigation lives on the edges, not down the side.** `AppChrome` renders a `fixed` top bar
at `z-40`, at every screen size, so a page gets the full width regardless. The `(protected)`
layout pads `.app-main` for it via an `html[data-appbar]` rule in `globals.css` rather than
a prop, since the layout is a server component and the minimise state is client-side.

**Modules collapse into a menu on compact rather than a second bar.** There used to be a
bottom bar just for module icons; it's gone. On `compact`, the top bar's module list becomes
a single button that opens the same links as a dropdown — the bottom edge is worth more to
the module's own section switcher (below) than to a row of icons that's read once per visit.

**There's a second bar: the section tree — and it lives on the bottom edge, at every size.**
A module's `TreeNav` is a row of chips, pinned to the bottom of the viewport whenever it's in
its bar form (`full` state on desktop, and always on compact), because the switcher is
chrome, not content, and shouldn't scroll away three screens down. Be clear-eyed about what
pinning buys: it costs the same row either way. It doesn't reclaim space, it makes the row
*useful all the time*. If a screen genuinely needs the height back, one `−` minimises the
bar to a puck. On desktop, `rail`/`strip` are still a side column, not a bar — only the
`full` state pins to the bottom.

**The bottom edge is shared, so it stacks — nothing claims `bottom-0` outright.** The
section nav is the anchor there, and the music player rides *above* it: the nav is the
primary way round a module, so a transient bar must not cover it. Neither one hard-codes
the other's height. `globals.css` publishes `--tree-nav-height` from
`html[data-treenav]` (4rem bar, 1.5rem puck, `0px` when the page has no nav) and the
player's `.music-player-pinned` uses it as its `bottom`. A bar that needs the layout to
reserve space also mirrors its own presence onto `<html>` — `data-treenav`,
`data-music-player` — because `.app-main` is owned by a server layout that cannot see
client state. **Adding a third thing to that edge means publishing a height the same
way**, not writing another `fixed inset-x-0 bottom-0`.

**The nav changes orientation with its state**, which is the part that catches people: it's
a bar in `full` and a column in `rail`/`strip`. A shell can't decide its own direction from
the viewport alone — it has to listen to `onStateChange` and stack whenever the nav is a
bar. Details and the pieces that have to line up:
[`components.md` → TreeNav](components.md#treenav).

**Two bars, two pucks, two corners.** Both fixed bars minimise the same way — to a
[`Puck`](components.md#puck), a 44px circle you press to get it back. Each needs its own
corner (top-left for the toolbar, bottom-left for the section bar): sharing one would stack
them invisibly and only the top one could ever be pressed.

`.app-main` owns the page's side gutter as `--app-gutter` rather than `px-8 max-lg:px-4`,
so a bar inside it can cancel exactly that much and run edge to edge (`.tree-nav-bleed`).
Don't put the padding utilities back on it.

- Anything else that needs to sit above page content must stay under `z-40`, and any dialog
  must stay at `z-50` (`Modal`) so its overlay still covers the bars.
- **A whole-record viewer is a floating window, not a wide panel.** `Modal`'s
  `size="window"` gives it 80% of the viewport, rounded and centred, draggable by its
  header, with a maximize button that swaps to full-bleed and back — the right treatment
  when the content is a screen in its own right (several tables, a chart, a news column),
  as in `TickerViewer`. Leaving a margin of dimmed page on every side is the point: it says
  "this is on top of where you were", where edge-to-edge says "you have gone somewhere",
  and the reader can drag it aside to check the page underneath instead of closing it.
  `size="full"` is still there for the maximized state and for anything that genuinely
  wants every pixel. Don't reach for either on a form — a `sm`/`md` panel reads as "answer
  this and get back".

## Phone and desktop

**Every screen has to work at both.** There is one boundary — **1024px** — and two
names for what sits either side of it:

| | |
|---|---|
| `compact` | below 1024px — a phone, a tablet in portrait, a half-width window |
| `full` | 1024px and up |

**What the boundary decides — and what it doesn't.** It decides the *layout shape*:
sidebar or stacked, table or card list, bar or rail. It deliberately does **not** decide
how many of a *repeated* thing fit in a row — see "Collections size themselves" below —
and it can't express the device insets a phone has and a monitor doesn't — see "Installed
as a PWA". Those are separate axes, and neither correlates with width.

They're named after the *layout*, not the device, deliberately. An iPad in portrait is
810px and wants the compact layout whatever it calls itself; so does a browser window
dragged to half a 27" monitor. Calling it "phone" would make both read as bugs.

1024 is not a new number: it's `lg`, the breakpoint every side-by-side layout here
already uses. (The module section shells are the exception that proves the rule — they fork
on `useIsCompact()` *and* the nav's state rather than on `lg:`, because the layout can be
pinned and because a `full` nav is a bar at any width. See `SectionLayout`.)

### Reach for CSS first — `max-lg:`, not `lg:`

Tailwind is mobile-first, so `lg:flex-row` means "≥1024px". Restyling a screen that way
means rewriting the classes desktop depends on. Use the **max-width** variants instead,
which only apply *below* the boundary:

```tsx
// every existing class keeps its meaning at desktop width
<div className="flex gap-6 lg:items-start max-lg:flex-col max-lg:gap-3">
```

Nothing above 1024px can change, because `max-lg:` doesn't exist up there. That property
is the whole point: it makes "I didn't break the desktop" provable rather than hopeful.
This covers the large majority of the work — stacking, spacing, hiding chrome, growing
tap targets.

### Fork a component only when restyling genuinely can't do it

Some things aren't a narrower version of themselves. A 1498px table isn't a table on a
390px screen, it's a card list. For those, read the layout on the server:

```tsx
const isCompact = useIsCompact();          // client
// or, in a server component:
const viewport = resolveViewport({ cookieValue: cookieStore.get(VIEWPORT_COOKIE)?.value });
```

Prefer forking a **shared component** over forking a page — a compact mode inside
`DataGrid` fixes every grid in the app at once, where forking Positions fixes one screen.

**How the value is decided** (`src/lib/viewport`, three signals, strictly ordered):

1. **A layout the reader pinned** on the Account page — never overruled.
2. **The measured width**, applied by `ViewportCorrector` on mount.
3. **The User-Agent**, guessed in `proxy.ts` — the only thing available before any
   JavaScript runs, so it decides the first paint and is then corrected.

Signal 3 is wrong more often than it looks: iPadOS Safari reports itself as a Mac, and
"Request Desktop Website" sends a desktop string from a phone. That's why 2 exists, and
why 1 has to exist as an escape hatch.

### Don't render both and hide one

```tsx
<DesktopThing className="max-lg:hidden" />   {/* tempting */}
<CompactThing className="lg:hidden" />
```

Fine for small static markup. **Not** for grids or charts: both trees mount, so Recharts
measures a zero-width hidden container and any data the hidden one loads is fetched
twice. Pick one with `useIsCompact()` instead.

### Collections size themselves — don't count columns per breakpoint

A row of *the same thing repeated* — cards, tiles — is not a layout-shape question, so
the boundary is the wrong tool for it. `grid-cols-2 max-lg:grid-cols-1` gives a collection
exactly two states, which means a 402px phone and an 810px iPad portrait get identical
treatment despite `compact` spanning a **3.2× range** of widths. The result is cards
stretched far too wide, or a part-card cut off at the edge.

Let the browser count instead. Two utilities in `globals.css`:

| | |
|---|---|
| `.card-grid` | roomy cards — columns are `minmax(18rem, 24rem)` |
| `.tile-grid` | small fixed-ratio tiles — columns are `minmax(5rem, 7rem)` |

```tsx
<div className="card-grid gap-4">   {/* not grid grid-cols-2 max-lg:grid-cols-1 */}
```

Both use `repeat(auto-fit, minmax(min, max))` with `justify-content: start`, so the
column count follows the space actually available and a card never grows past its cap —
one card on a wide screen stays card-sized instead of inflating into a panel. **Gap stays
a Tailwind class at the call site**; the utility owns columns only.

Two honest caveats:

- **These change wide screens too**, so they step outside the `max-lg:`-only guarantee
  below. That's the deliberate trade: continuous sizing is the point, and it can't be had
  from a variant that doesn't exist above 1024px.
- **Not for everything in a grid.** A fixed set of 2–3 stat tiles, or full-width list
  rows, wants an explicit column count — `auto-fit` would strand them at a cap that
  doesn't suit. Reach for these when the collection is *variable-length*.

### Installed as a PWA

This app is installed to the home screen, not just visited. `src/app/layout.tsx` sets
`viewport-fit=cover` and `apple-mobile-web-app-status-bar-style: black-translucent`, so
the app paints **under** the notch / Dynamic Island and the home indicator. That's what
standalone is supposed to look like — and it means reserving that space is *our* job, not
the browser's. There is no URL bar to fall back on: installed, our bars are the only
chrome, so a control hidden under the Island is simply unreachable.

**Insets are a separate axis from width.** A landscape iPhone is ~874px — squarely
`compact` — and needs a ~59px *side* inset that no width rule predicts. So:

- **Anything pinned to a screen edge pads by `env(safe-area-inset-*)`.** `env()` is `0px`
  on any device without insets, so this is free on desktop and Android. The existing
  seams already do it — `.app-main`, `.app-bar`, `.tree-nav-sticky`, the pucks, and
  `.music-player-pinned`. **Compose with those rather than adding a new
  `fixed inset-x-0 bottom-0` of your own**, which is how one bar quietly ends up under
  the home indicator — or on top of another bar (see below).
- **Prefer `dvh` over `vh`** for full-height areas. In a Safari *tab* the collapsing URL
  bar makes `100vh` overflow; installed it doesn't. `dvh` is right in both.
- **Touch-only.** A `hover:` state is dead weight on a phone and can stick after a tap on
  iOS. Pair it with a real `active:`/`aria-pressed` state rather than relying on hover to
  communicate anything.

**None of this is caught by `/verify`.** Playwright's WebKit doesn't emulate safe-area
insets, so a regression here is invisible to CI — checking means a real device or the
Xcode simulator.

## Building a new module's UI

When scaffolding a new module's `view.tsx`:

1. Read `components.md` first and reuse what's there (`CollapsibleCard`, `DataGrid`,
   `Tabs`, `ChartLine`/`ChartBar`, `Button`, etc.) — most module UIs are composed
   entirely from existing components plus a form.
   Wrap the page itself in `PAGE_CONTAINER` (above), not a hand-picked width.
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
