# 0055 — Give Music Library a real music icon

Adds a `music` concept to `MODULE_ICON_NAMES` and repoints the Music Library module at
it, replacing the borrowed `heart` glyph that `0053` seeded.

| Field | Value |
|---|---|
| Slug | `music-library` |
| Icon | `heart` → `music` |

**Why this is a migration and not just a code change.** The icon lives in the
`sys_modules.icon` column, so an existing database keeps saying `heart` no matter what
`DEFAULT_MODULES` says. `0053` recorded the `heart` choice as an explicit compromise and
called a real music glyph "a clean follow-up" — this is that follow-up.

**Scoped by slug *and* by the old value**, following the pattern `0050` set when it moved
Journal and Attendance off the shared `book` glyph: if a reader has already picked a
different icon for this module in Admin → Configuration, that choice is theirs and the
`AND icon = 'heart'` guard leaves it alone.

## What adding a concept cost

A missing module glyph is a hard failure in `scripts/gen-icon-glyphs.mjs`
(`process.exit(1)`) — the app bar has no fallback artwork — so a new concept has to be
covered everywhere before it can ship:

- **`classic`** (hand-drawn, `src/components/module-icons.tsx`) — a beamed pair of eighth
  notes. Filled noteheads and a solid beam, because at the 16px the app bar renders a
  single note's stem is one hairline that reads as a stray tick.
- **All 12 generated sets** — each had a genuine music glyph, so nothing fell through to
  the keyword net:

  | Set | Glyph |
  |---|---|
  | lucide | `music` |
  | tabler | `music` |
  | material-symbols | `music-note` |
  | mingcute | `music-2-fill` |
  | phosphor-duotone | `music-notes-duotone` |
  | solar-line-duotone | `music-notes-line-duotone` |
  | solar-bold-duotone | `music-notes-bold-duotone` |
  | hugeicons | `music-note-01` |
  | streamline-color | `music-note-2` |
  | flat-color | `music` |
  | fluent-flat | `musical-notes` |
  | fluent-3d | `musical-notes` |

Re-run `npm run gen:icons` after touching the candidate map;
`src/components/module-icon-sets.generated.ts` is generated and must not be hand-edited.

`music` is a general concept, not a Music-Library-private one — like `journal` and
`roster` before it, it now appears in the icon picker for any module.

Also mirrored in `src/lib/modules/defaults.ts`. That duplication is not redundancy to be
tidied away: the seed builds a fresh database, and `DEFAULT_MODULES` is what admin
"Reset to Default" restores from.
