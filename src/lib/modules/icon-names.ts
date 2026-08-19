export const MODULE_ICON_NAMES = [
  "building",
  "home",
  "briefcase",
  "wallet",
  "chart",
  "folder",
  "shield",
  "heart",
  "book",
  "tool",
  // A bound journal with a quill, and a class register — distinct from `book`
  // (a generic book) and from each other, so Journal and Attendance no longer
  // share one glyph.
  "journal",
  "roster",
  // A beamed pair of eighth notes. Added so Music Library stops borrowing
  // `heart` — see migrations/0055_music_library_music_icon.md.
  "music",
] as const;

export type ModuleIconName = (typeof MODULE_ICON_NAMES)[number];
