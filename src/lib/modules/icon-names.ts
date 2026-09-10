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
  // A gamepad. Added with the Games module rather than after it: every installed
  // icon package has a real controller glyph, so no set needed a placeholder the
  // way Music Library did (0053 borrowed `heart` until 0055).
  // See migrations/0075_seed_games_module.md.
  "game",
  // A photograph: a frame with a horizon and a sun. Added so Picture Gallery stops
  // borrowing `heart` — the same placeholder Music Library wore between 0053 and
  // 0055. See migrations/0085_picture_gallery_photo_icon.md.
  "photo",
] as const;

export type ModuleIconName = (typeof MODULE_ICON_NAMES)[number];
