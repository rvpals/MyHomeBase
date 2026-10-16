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
  // A house with a chimney — the Household module. Deliberately not `home`, which
  // names the *home screen* concept: the same artwork on "the dashboard" and on
  // "this module" is exactly the collision the slot registry exists to prevent.
  // Named in all eleven icon sets up front (a missing module concept is fatal in
  // gen-icon-glyphs.mjs), so unlike Music Library and Picture Gallery this one
  // needs no follow-up migration. See migrations/0119_seed_household_module.md.
  "household",
  // A schoolhouse — the Classroom module. Deliberately a *building*, not the cap or
  // board you might reach for first: `roster` (a class register) already carries the
  // "this is a class" idea in this same list, and the tree registry's `classroom` is a
  // presentation board that renders two rows below the module header in the same nav.
  // A building is the one shape neither of those can be confused with.
  //
  // Note this name also exists in TREE_ICON_NAMES as a different drawing. That is legal
  // and `photo`/`chart`/`shield`/`heart` already do it, but see modules.md -> Icons: the
  // two registries are separate and a name in one resolves nothing in the other.
  //
  // Named in all twelve generated sets up front (a missing module concept is fatal in
  // gen-icon-glyphs.mjs), so unlike Music Library and Picture Gallery this one needs no
  // follow-up migration. Three sets have no schoolhouse and take the nearest civic
  // building or academic cap instead -- recorded at their entries in the candidate map.
  "classroom",
] as const;

export type ModuleIconName = (typeof MODULE_ICON_NAMES)[number];
