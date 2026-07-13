import type { Module } from "./types";

// Mirrors the seed INSERTs in migrations/0001_create_modules.sql and
// migrations/0005_seed_stock_etfs_module.sql.
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
  {
    slug: "stock-etfs",
    shortName: "Stocks & ETFs",
    longName: "Stock & ETFs etc",
    description: "Manage stock and ETF investments.",
    sequence: 2,
    isVisible: true,
    icon: "chart",
  },
];
