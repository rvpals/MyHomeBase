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
  the hard offset shadow that marks a `Button`. A card that needs to read as genuinely
  *thick* opts into `.card-embossed`, which gets there with a lit top edge and a shadowed
  underside rather than an offset — depth without joining the button vocabulary.
- **A progress bar's fill is the one non-button that takes the hard offset shadow.** It's
  not a surface and not clickable — it's a slab sitting in a groove, the same material a
  `Button` is made of, so it borrows the same 3px offset in the same direction and reads as
  part of the same world. That's [`Progress3D`](components.md#progress3d), and it's the
  whole licence: don't extend the reasoning to a card or a panel.
- **No surface takes the button treatment.** The old left `Sidebar` was the one exception —
  a raised slab with `Button`'s hard offset shadow rotated to point right. It was retired
  with the move to edge-based navigation, and the exception went with it. The nav
  surfaces are quiet: a hairline border and a soft low-opacity shadow, nothing more.
  Don't give a panel a hard shadow without asking.

### The elevation classes — reuse these, don't hand-roll a shadow

The lifts above are named classes in `globals.css`, not arbitrary values at the call site.
Reach for one of these before writing a new `shadow-[...]`:

| Class | For | Shape |
|---|---|---|
| `.nav-raised-top` | A bar pinned at the **top**, casting down over content | inset 1px highlight + soft wide cast, downward |
| `.nav-raised-bottom` | A bar pinned at the **bottom** — the compact section trigger | the same, cast **upward** |
| `.card-raised` | A card's resting lift — `CollapsibleCard` | inset highlight + hairline ring + tight cast |
| `.card-raised-hover` | The same card's `:hover` | the cast grows and softens |
| `.card-embossed` | An **opt-in bevel** for a card that should read as a thick slab — pair with `.card-raised-hover` | lit top edge + shadowed underside + ring + two-stop cast |
| `.paper-texture` | A card that should read as a **physical sheet** — the journal's New Journal card | translucent fibre grid + diagonal sheen, no tint of its own |
| `.progress-3d-track` / `.progress-3d-fill` | The pair behind [`Progress3D`](components.md#progress3d) — **every progress bar** | a groove cut into the page (surface gradient + inset lip) holding a lit slab (accent gradient + `Button`'s hard offset shadow) |
| `[data-dashboard-texture]` | The home dashboard's **admin-uploaded** background picture | a `fixed` `::before` behind the cards; opacity + blur from the stored settings |
| `[data-module-texture]` | A **module's own** uploaded background picture (Music Library today) | the same mechanism, keyed per module; set by that module's shell |

Two things they encode that are easy to get wrong:

- **A cast shadow falls away from the light**, so a bottom-pinned bar's must point *up*, at
  the content it overlaps — not down off the screen. That's the only difference between the
  two `nav-raised-*` classes, and it's why they're a pair rather than one class.
- **The ring goes outside the border, not instead of it.** `border-line` is deliberately
  low-contrast in every theme (Daybreak's is `#E7E2E4` on white), so definition comes from
  stacking a soft dark ring around it. Replacing the token with a literal would kill the
  theme inversion.

`.paper-texture` is the one surface treatment that isn't a shadow, and it follows the same
rule for the same reason: it is woven from **translucent black and white only**, never a
grey. It layers over whatever `bg-paper-raised` the theme supplies, so it darkens and
lightens that color instead of replacing it — grain on the dark themes, laid off-white on
Daybreak and Sea Glass. Applied via `CollapsibleCard`'s `className` (which merges last), so
no component changed to get it. Use it sparingly and only where "a sheet of paper" is the
point — a form you write into. It is texture, not hierarchy: if you want a card to stand
out, that's `.card-raised`, not this.

All alphas stay inside the safe range above (white ≤ 0.12, black ≤ 0.45), so every one of
these reads on Daybreak as well as on the dark themes. Hover **grows the shadow rather than
translating the element** — a card whose whole header is a toggle must not move out from
under the pointer mid-click.

#### The one sanctioned exception: an uploaded background picture

Two rules implement it — `[data-dashboard-texture]` for the home dashboard and
`[data-module-texture]` for a module that wants its own (the Music Library today) — but
it is **one** exception, not two: same mechanism, same constraints, different subject.

Both put an **uploaded picture** behind a screen, and neither can obey the rule above: a
photograph has its own colors and can't adapt to Daybreak versus BMS the way a
black-and-white weave does. This is a deliberate, opt-in exception rather than a
precedent — it exists because the picture *is* the point, chosen by the person looking at
it.

What keeps it from wrecking a theme:

- It renders **only when someone uploads one**. The default state is no layer at all, not
  a layer at opacity 0 — an always-on `fixed` pseudo-element would cost a compositing
  layer on every scroll for nothing. (Who may upload follows the *screen*: the dashboard's
  is admin-only because it lives in Administration; a module's follows that module's own
  configuration screen.)
- Opacity defaults to **0.10** and is capped at 1 with a blur up to 40px, so the picture
  tints the theme's `--paper` showing through underneath rather than replacing it. That is
  the same *intent* as `.paper-texture`, by the only means available to an image whose
  colors we don't control.
- It sits **behind the cards** (`z-index: -1`), which keep their `bg-paper-raised`. Text
  legibility never depends on the picture, which is why both upload screens preview a real
  card on top of it rather than the picture alone.
- A module's layer wraps the **section content only**, not the rail or the section panel,
  so the module's own navigation chrome stays on flat theme surfaces at any opacity.

Don't extend this to another surface without the same justification. A texture behind
*content* is a legibility risk that a card's own background is what mitigates.

### Layout utilities

The same rule — a named class in `globals.css`, not an arbitrary value at the call site —
covers the responsive and safe-area idioms. Full reasoning under "Phone and desktop".

| Class | For |
|---|---|
| `.card-grid` | A variable-length row of roomy cards; columns size themselves, capped at 24rem |
| `.tile-grid` | The same for small fixed-ratio tiles, capped at 7rem |
| `.music-player-pinned` | The music player's bar, pinned above whatever the section nav occupies |
| `--module-rail-width` | Tier 1's width (64px). Read it — never hardcode the number |
| `--section-panel-width` | Tier 2's width (240px), `0px` when the panel is closed |
| `--section-trigger-height` | What the compact section trigger occupies on the bottom edge |
| `.shell-rail` / `.shell-panel` | Tier 1 and tier 2 as fixed columns, insets included |
| `.shell-trigger` | The compact section trigger pinned to the bottom edge |

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
- **The setting covers module icons *and* section-panel icons.** `TreeIcon` reads the
  same `useIconSet()` context, so a module's section bar matches its toolbar — including
  going full-color together. Two deliberate exceptions stay hand-drawn in every set:
  the row-action glyphs (`pencil`, `trash`, `refresh`), because they're buttons rather than
  destinations and color on an inline delete weakens the destructive read; and `AdminIcon`.
  Where a nav icon carries the brass accent, drop it for a colorful set —
  `useTreeIconIsColorful(name)` answers that.
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

## Page width

Every full-page screen — module, Administration, or the home grid — is laid out in **one**
container: `PAGE_CONTAINER` from
[`src/app/(protected)/page-container.ts`](src/app/(protected)/page-container.ts)
(`mx-auto w-full max-w-[160rem]`). Don't invent a per-screen `max-w-*`. Screens used to pick
their own (`3xl` for most modules, `4xl` for the admin forms, `6xl` for the wide ones), which
left most of a large display as empty margin either side of the content. The 160rem cap sits
past a 2560px monitor on purpose so it doesn't bind on one; it's there only to stop a table
spanning a 3440px ultrawide.

`.app-main` owns the page's side gutter as `--app-gutter` rather than `px-8 max-lg:px-4`,
so a bar inside it can cancel exactly that much and run edge to edge.
Don't put the padding utilities back on it.

## Navigation: the two-tier shell

**This is the target design for every module.** Read this section before adding any
navigation element, and before building a new module's shell.

Navigation is **two tiers plus a utility header**. Tier 1 answers *which module*, tier 2
answers *which section of it*, and the header says where you currently are. The tiers are
separate surfaces because they answer separate questions and change at different rates —
the module list is the same on every screen in the app, the section list changes every time
you switch module.

| Tier | Desktop (`full`) | Compact | Component |
|---|---|---|---|
| 1 — modules | 64px icon rail, fixed left | dropdown in the app bar | `ModuleRail` |
| 2 — sections | 240px panel, collapsible | bottom trigger + sheet | `SectionPanel` |
| 3 — utility | slim top bar: breadcrumb, actions, profile | same bar, breadcrumb truncates | `AppHeader` |

`TwoTierShell` composes all three and owns the state. A module shell hands it `links`,
`sections` and `module` — it does **not** place the tiers itself.

### Every page behind the login gets a shell

There is no global bar any more. Navigation arrives *only* because a page's own shell
renders it, so **a page that renders no shell has no navigation at all** — no module
switcher, no Administration link, no way to log out. When you add a route under
`(protected)`, wrap it or it is a dead end.

Pages outside any module use `HomeShell` (`src/app/(protected)/home-shell.tsx`) — the
home screen and the account screen do. It passes **`sections={[]}`**, which
`TwoTierShell` reads as *no tier 2*: the rail and header render, the panel doesn't, and
`.app-main` reserves the rail's width alone. That's the supported way to have a page
with no sections; don't reach for it just to hide a panel you were too lazy to populate.

### The fixed dimensions are contracts, not suggestions

**64px and 240px are published as `--module-rail-width` and `--section-panel-width`** in
`globals.css`. Read them; never re-measure and never hardcode `64px` at a call site. They
are the same seam `--music-player-height` already is, and for the same reason: `.app-main` is
owned by a *server* layout that cannot see the client state driving the panel's collapse,
so the client mirrors its presence onto `<html data-sectionpanel>` and CSS does the padding.

**Anything that needs the layout to reserve space publishes a variable and mirrors an
attribute onto `<html>`.** Don't write a new `fixed inset-x-0` of your own — that is how
one bar quietly ends up on top of another. Compose with what's published.

### Tier 1 — the module rail

64px, icon-only, named by `title` tooltip. Active state is **a tint *and* an accent edge
bar** (`absolute left-0 w-0.5 bg-brass`), not a tint alone: at 64px wide with no label a
tint is easy to miss against the rail's own `paper-raised` surface.

Icon-only is a deliberate trade — it costs discoverability on touch, where there is no
hover, and buys the content the full width. The panel header repeats the module name in
words, which is what keeps the rail honest: the glyph is never the only thing naming where
you are.

### Tier 2 — the section panel

240px, and **open or closed — there is no middle state.** `«` in the panel header closes
it; `»` in the header brings it back. Deliberately *not* the three-state
full/rail/strip model the old `TreeNav` used: a 64px icon rail for sections next to a 64px
icon rail for modules is two ambiguous glyph columns side by side, which is worse than
either extreme.

Nested groups render as an accordion **on desktop only**. On compact the sheet flattens
every leaf into one list and drops group headings —
a phone has no room for a second level, and a dropped heading costs nothing when every
child is still one tap away.

### Tier 3 — the utility header

Breadcrumb (`[Module] › [Section]`, optionally a third crumb for a record), global actions,
profile. The breadcrumb is the *only* thing naming the current section in words on desktop
when the panel is closed, so it is never decorative — don't drop it to make room.

### What compact does differently

The compact fork is a genuinely *different component*, not a restyle, which is why it reads
`useIsCompact()` rather than `max-lg:` — see "Fork a component only when restyling
genuinely can't do it" below. A 64px rail and a 240px panel side by side is 304px of chrome
on a 390px phone.

- **Modules** move into the app bar as a dropdown — the module switcher *is* the title.
- **Sections** move to a bottom trigger row naming the current section, which opens a
  **sheet** over a scrim. The trigger keeps answering "where am I?" while closed.
- **Touch targets grow.** Sheet rows are `py-2.5` (~44px) against the desktop panel's
  `py-1.5`. A pointer doesn't need the slack; a thumb does.
- **The bottom edge still stacks.** The trigger publishes its height the same way the
  music player reads (`--section-trigger-height`), and the player rides *above* it. Nothing
  claims `bottom-0` outright.

### There is no second navigation system

`TreeNav`, `AppChrome`, `SectionLayout`, the per-module `*-nav.tsx` files and `Puck` were
the previous shell. **They have all been deleted** — every module and Administration render
`TwoTierShell`, and nothing minimises to a puck any more. If you find a reference to any of
them in a comment, it is stale; fix it rather than reviving the pattern.

What survived, because both are still needed and neither belongs to one tier:
[`ModuleMenu`](components.md#navmenus) (compact's module switcher) and
[`UserMenu`](components.md#navmenus) (the profile menu), both in
`src/components/nav-menus.tsx`.

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
already uses. (`TwoTierShell` is the exception that proves the rule — it forks on
`useIsCompact()` rather than `lg:`, because the layout can be *pinned*: a 1400px window can
legitimately be compact, and a media query would still lay it out side by side.)

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
  seams already do it — `.app-main`, `.shell-rail`, `.shell-panel`, `.shell-trigger`
  and `.music-player-pinned`. **Compose with those rather than adding a new
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

## Adding a UI element to the shell

Read this whenever a change adds or moves a *navigation or chrome* element, as opposed to
content inside a page. The two-tier shell only stays coherent if new controls land in the
tier that matches what they do.

**First: which tier does it belong to?**

| The control… | Goes in | Not |
|---|---|---|
| switches which **module** you're in | tier 1, the rail | the header |
| switches which **section** of the current module | tier 2, the panel | the header, or a bar of its own |
| acts on the **whole app** (search, notifications, profile, layout switch) | tier 3, the header | the rail |
| acts on the **current page only** (save, add, filter, refresh) | the page body | any tier — chrome is for navigation |

That last row is the one most often got wrong. A "Refresh prices" button belongs on the
Stocks page, not in the header, however global it feels — the header is for things that
mean the same thing on every screen in the app.

**Then, the rules that keep it from breaking the layout:**

1. **Never write a new `fixed inset-x-0` / `fixed bottom-0`.** Compose with the published
   variables (`--module-rail-width`, `--section-panel-width`,
   `--section-trigger-height`, `--music-player-height`). Anything that needs the page to reserve space publishes its
   own height and mirrors its presence onto `<html data-*>`, because `.app-main` belongs to
   a server layout that can't see client state.
2. **Say how it behaves at both sizes before you build it.** 64px + 240px is 304px of
   chrome — on a 390px phone that is most of the screen. Every tier has a compact form; a
   new element needs one too, and "it shrinks" is not an answer if the honest answer is "it
   moves into the sheet".
3. **Pad screen edges with `env(safe-area-inset-*)`.** Free on desktop (`0px`), essential
   installed — the app paints under the Dynamic Island and the home indicator. See
   "Installed as a PWA".
4. **Stay under `z-40`.** The shell's surfaces sit at `z-30`–`z-40`; `Modal` owns `z-50` so
   its overlay still covers them. A new element above `z-40` will cover a dialog.
5. **Theme tokens only** — `bg-paper-raised`, `border-line`, `text-brass-dark`. Check it
   against a light theme (Daybreak) before calling it done: `paperRaised` is *lighter* than
   `paper` there, the inverse of the dark themes, and a rail-plus-panel design loses the
   surface separation the dark themes give it for free.
6. **Reuse the shell's components** rather than a parallel implementation. If none of
   `ModuleRail` / `SectionPanel` / `AppHeader` fits, that's the signal to stop and ask
   whether it's a new registered component — per `components.md`'s process — not to add a
   fourth surface.
