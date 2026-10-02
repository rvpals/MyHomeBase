// The public surface of the menu item registry. Import from here, never from a file
// inside this folder.

export {
  clearMenuItemOverride,
  listMenuItemModules,
  listMenuItems,
  listMenuItemsForModule,
  overriddenTitles,
  resolveMenuItem,
  setMenuItemOverride,
} from "./menu-items";
export type { MenuItemOverrideRepository, MenuItemSeed, MenuItemSource } from "./ports";
export { SqliteMenuItemOverrideRepository } from "./repository";
export {
  MAX_MENU_ITEM_HINT_LENGTH,
  MAX_MENU_ITEM_TITLE_LENGTH,
  menuItemOverrideSchema,
  type MenuItemOverrideInput,
} from "./schema";
export type { MenuItem, MenuItemKind, MenuItemOverride } from "./types";
