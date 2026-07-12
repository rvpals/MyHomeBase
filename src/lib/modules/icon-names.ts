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
] as const;

export type ModuleIconName = (typeof MODULE_ICON_NAMES)[number];
