# 0182 — A card tint for a Code Library snippet

Adds `cod_snippets.card_color`.

## Decisions

- **A key, never a hex.** The column stores `'rose'`; the tint is mixed from the
  running theme's tokens at render. A stored hex would be the same pink card on
  all eight built-in themes, two of which are light, and on every theme an admin
  creates at runtime. `clp_clips.card_color` (migration `0157`) records the same
  decision, and `deriveCodeTokens` makes it again for the syntax colours.
- **The keys are permanent**, like an icon slot id — they are written into every
  coloured snippet's row, so renaming one blanks those cards back to the default
  surface.
- **The palette is shared, not redeclared.** `TINT_COLORS` in
  `src/lib/shared/tint.ts` is already the six keys Clips uses. Six tints is a
  palette, not a module feature, and two modules drifting to different colour
  names would be a nuisance with no upside.
- **Blank, never `NULL`.** No reader should have to handle two kinds of "no
  tint".

## A note on the CSS

The tint classes are `.clip-tint` / `.clip-tint-<key>` in `globals.css`. The rules
themselves are generic — they mix `--clip-tint-hue` into `--paper-raised` and
`--line` — and only the *name* says "clip", from when Clips was the only caller.
The Code Library reuses them rather than duplicating six near-identical rules.

Renaming them to something module-neutral would be the tidier answer and is a
safe mechanical change, but it touches a shipped module's markup for no visible
benefit, so it is left for whenever that file is next worked on properly.
