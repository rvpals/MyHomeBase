// The glyph menu a student action can be drawn with.
//
// Deliberately its own small registry rather than a module icon
// (`MODULE_ICON_NAMES`) or a tree icon concept. `modules.md` records the cost of
// adding to either: a hand-drawn glyph for the `classic` set *plus* a named
// candidate for all 12 generated sets in `scripts/gen-icon-glyphs.mjs`, or the
// generator fails. That price is right for a module's identity glyph and wrong
// here, where the whole point is that a teacher picks an icon at runtime — and
// where a tortoise and a `$+` are concepts no general icon set carries anyway.
//
// These are drawn by `AttendanceActionIcon`
// (src/components/attendance-action-icon.tsx), monochrome, outside the reader's
// icon-set choice.
//
// A stored key this list doesn't know draws nothing rather than throwing: a
// catalog row can outlive a glyph, the same forgiveness `resolveAttendanceSettings`
// applies to a stale class id.
export const ATTENDANCE_ACTION_ICONS = [
  /** A tortoise — slow to arrive. The seeded `Late` action. */
  "turtle",
  /** A dollar sign with a plus — credit earned. The seeded `Extra Credit` action. */
  "dollar-plus",
  "clock",
  "star",
  "medal",
  "warning",
  "check",
  "note",
  "hand",
  "heart",
] as const;

export type AttendanceActionIcon = (typeof ATTENDANCE_ACTION_ICONS)[number];
