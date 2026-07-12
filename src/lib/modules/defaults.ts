import type { Module } from "./types";

// Mirrors the seed INSERT in migrations/0001_create_modules.sql.
// "Reset to Default" restores the table to exactly this list — keep both in sync.
export const DEFAULT_MODULES: Omit<Module, "id">[] = [
  {
    slug: "real-estate-investment",
    shortName: "Real Estate",
    longName: "Real Estate Investment",
    sequence: 1,
    isVisible: true,
    icon: "building",
  },
];
