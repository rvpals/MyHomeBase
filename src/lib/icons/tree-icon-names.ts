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
  // A notebook with a plus in the page — Journal's New Entry section. Deliberately not
  // `plus` (which says "add" without saying what) and not `quote` (Report's).
  "new-journal",
  "stock-quote",
  "grid",
  "window",
  "palette",
  "info",
  "history",
  "users",
  "database",
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
] as const;

/** One concept `TreeIcon` can draw. */
export type TreeIconConcept = (typeof TREE_ICON_NAMES)[number];
