// The icon names TreeIcon can actually render, mirrored for tests.
//
// `TREE_ICONS` lives in a .tsx file that imports React, and nothing under src/lib may
// import react -- so a test in this folder cannot read it directly without breaking the
// library boundary. Mirrored here instead, with the boundary check in browse.test.ts
// guarding what actually matters: that no view names an icon the component cannot draw.
//
// If tree-icons.tsx gains or loses a concept, update this list.
export const TREE_ICON_NAMES_FOR_TEST = [
  "note",
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
  "stock-quote",
  "grid",
  "window",
  "palette",
  "info",
  "history",
  "users",
  "database",
  "shapes",
] as const;
