/**
 * Every concept `TreeIcon` can draw, as a value rather than only a type.
 *
 * **Why this exists as a list and not just `keyof typeof TREE_ICONS`.** The glyph table
 * lives in `src/components/tree-icons.tsx`, which imports React — so nothing under
 * `src/lib/` may import it (ARCHITECTURE.md). The icon-slot registry and its test both
 * need to *iterate* these names to prove that every slot's `defaultConcept` is a concept
 * some glyph table actually has, and a type can't be iterated.
 *
 * Before this file, the test kept its own hand-copied list with a comment asking whoever
 * touched the glyph table to update it. That drifted exactly once and cost a red gate:
 * `new-journal` was added with Journal's New Entry section and the copy wasn't updated,
 * so a registered slot pointed at a concept the test believed didn't exist.
 *
 * **The list and the table are now kept honest by the compiler, not by a comment.**
 * `tree-icons.tsx` declares `TREE_ICONS` as `satisfies Record<TreeIconName, ...>`, so a
 * glyph added there without a name here fails typecheck, and a name here with no glyph
 * fails too. Mirrors `MODULE_ICON_NAMES` in `src/lib/modules/icon-names.ts`, which the
 * module side has always done this way — and which is why the module side never drifted.
 *
 * Order follows the glyph table, which groups by where the concepts came from.
 */
export const TREE_ICON_NAMES = [
  // The original nav and row-action set.
  "flash",
  "note",
  "calendar",
  "clipboard",
  "clip",
  "shield",
  "refresh",
  "pencil",
  "trash",
  "sliders",
  "gear",
  "classroom",
  "list",
  "newspaper",
  "plus",
  "chart",
  "upload",
  "quote",
  // A quill pen — Journal's New Entry section. Deliberately not `plus` (which says
  // "add" without saying what) and not `quote`, a book *with* a quill (Report's).
  // The key stays `new-journal` though the drawing is now a pen: it is a
  // `defaultConcept` in slots.ts and renaming it would strand that reference.
  "new-journal",
  "stock-quote",
  "grid",
  "window",
  "palette",
  "info",
  "history",
  "users",
  "database",
  // A document with a table ruled into it — Tools' CSV File Browser. Deliberately
  // not `database` (the SQLite browser's, and the two sections sit adjacent in the
  // same panel) and not `list` (rows of anything, which loses "this is a file").
  "csv-file",
  "shapes",
  "search",
  "magic",
  // Two sparkles — "ask a language model about this". Next to the favourite star in
  // the ticker viewer, so it is deliberately not a star of its own.
  "ai-spark",
  "player",
  // Favourites, filled and unfilled, for the two things that can be kept.
  "star",
  "star-filled",
  "heart",
  "heart-filled",
  // Picture Gallery.
  "photo-stack",
  "photo",
  "photo-folder",
  "album",
  // The seven Arcade game cards.
  "game-2048",
  "game-arrows",
  "game-tetris",
  "game-sudoku",
  "game-blackjack",
  "game-minesweeper",
  "game-mahjong",
  // Journal's Location Manager. A map pin — the mark for a single saved place.
  // Deliberately not `flash`/`plus`: this says *where*, not *do something*.
  "pin",
  // Journal's Location Map — a folded paper map, i.e. several places at once.
  // Distinct from `pin` on purpose: the two sit adjacent in the same panel, and
  // one place vs many is exactly the difference the reader is picking between.
  "map",
  // The "launch module" button on the home screen's cards — opens the module the card's
  // numbers belong to, at its landing page. A button, so it is in `ALWAYS_CLASSIC` and
  // no icon slot points at it.
  "rocket",
] as const;

/** One concept `TreeIcon` can draw. */
export type TreeIconConcept = (typeof TREE_ICON_NAMES)[number];
