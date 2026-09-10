# 0085 — Give Picture Gallery a real photo icon

Adds a `photo` concept to `MODULE_ICON_NAMES` and repoints the Picture Gallery module at
it, replacing the borrowed `heart` glyph that `0084` seeded.

| Field | Value |
|---|---|
| Slug | `picture-gallery` |
| Icon | `heart` → `photo` |

**Why this is a migration and not just a code change.** The icon lives in the
`sys_modules.icon` column, so an existing database keeps saying `heart` no matter what
`DEFAULT_MODULES` says. `0084` recorded the `heart` choice as an explicit placeholder and
named a real photo glyph as the follow-up — this is that follow-up. It is the same shape
as `0055`, which moved Music Library off the same borrowed `heart`.

**Scoped by slug *and* by the old value**, following the pattern `0050` set and `0055`
repeated: if a reader has already picked a different icon for this module in
Admin → Configuration, that choice is theirs and the `AND icon = 'heart'` guard leaves it
alone.

## What adding a concept cost

A missing module glyph is a hard failure in `scripts/gen-icon-glyphs.mjs`
(`process.exit(1)`) — the app bar has no fallback artwork — so a new concept has to be
covered everywhere before it can ship:

- **`classic`** (hand-drawn, `src/components/module-icons.tsx`) — a landscape frame with
  a filled sun and a two-peak mountain horizon. The horizon is the load-bearing part: an
  empty rectangle with a dot in it reads as UI chrome (a window, a card) at the 16px the
  app bar draws, whereas a rectangle with a skyline inside it reads as a *picture*. The
  sun is filled for the same reason `music`'s noteheads are — a hairline circle that
  small either vanishes or reads as a stray tick.
- **All 12 generated sets** — every one had a genuine photo/image glyph, so nothing fell
  through to the keyword net and nothing needed a compromise. Resolved names:

  | Set | Glyph |
  |---|---|
  | lucide | `image` |
  | tabler | `photo` |
  | material-symbols | `photo` |
  | mingcute | `pic-fill` |
  | phosphor-duotone | `image-duotone` |
  | solar-line-duotone | `gallery-line-duotone` |
  | solar-bold-duotone | `gallery-bold-duotone` |
  | hugeicons | `image-02` |
  | streamline-color | `picture-landscape` |
  | flat-color | `picture` |
  | fluent-flat | `framed-picture` |
  | fluent-3d | `framed-picture` |

Both generated files were rebuilt with `npm run gen:icons`; the tables now carry
12 sets × 15 module concepts.

## Where the new icon shows up

Everywhere the module identifies itself, which is the point of the change: the module
rail down the left, the section panel's module header, the home-screen carousel card, the
app bar, and the module list in Admin → Configuration → Modules. It is also now offered
as a choice for *any* module there, since `MODULE_ICON_NAMES` is the shared palette.

This does **not** touch the module's two icon *slots*
(`gallery_section_main`, `gallery_section_favorites`) or the Random Photo card's
`homescreen_card_random_photo` slot. Those are tree-icon concepts on a separate registry
and are unaffected.

## Rollback

```sql
UPDATE sys_modules SET icon = 'heart' WHERE slug = 'picture-gallery' AND icon = 'photo';
```

Note that rolling back the *data* without also reverting the code leaves `photo` in
`MODULE_ICON_NAMES`, which is harmless — it simply becomes an offered icon nothing uses.
