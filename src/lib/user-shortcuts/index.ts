// My Shortcuts — a person's own jump-off points on the home screen.
//
// The barrel every consumer imports from, so `@/lib/user-shortcuts` is the one
// path that appears in a widget or an action. Same shape as
// `src/lib/home-dashboard/index.ts`.

export {
  DEFAULT_SHORTCUT_ICON,
  MAX_SHORTCUTS_PER_USER,
  MAX_SHORTCUT_ICON_BYTES,
  SHORTCUT_ICON_MAX_EDGE,
  type ResolvedShortcut,
  type Shortcut,
  type ShortcutDraft,
  type ShortcutKind,
} from "./types";

export {
  reorderShortcutsSchema,
  shortcutDraftSchema,
  shortcutIconSchema,
  shortcutNameSchema,
  shortcutUrlSchema,
  type ReorderShortcutsInput,
  type ShortcutDraftInput,
  type ShortcutDraftParsed,
} from "./schema";

export type { UserShortcutsRepository } from "./ports";

export {
  addShortcut,
  canAddShortcut,
  clearShortcutIcon,
  editShortcut,
  moveShortcut,
  removeShortcut,
  reorderShortcuts,
  resolveShortcut,
  resolveShortcuts,
  setShortcutIcon,
  type ShortcutResult,
} from "./user-shortcuts";

export { SqliteUserShortcutsRepository } from "./repository";
