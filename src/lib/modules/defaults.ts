import type { Module } from "./types";

// Mirrors the seed INSERTs in migrations/0005_seed_stock_etfs_module.sql,
// migrations/0012_seed_journal_module.sql, migrations/0020_seed_csv_analysis_module.sql,
// and migrations/0030_seed_expense_module.sql.
// "Reset to Default" restores the table to exactly this list — keep both in sync.
export const DEFAULT_MODULES: Omit<Module, "id">[] = [
  {
    slug: "stock-etfs",
    shortName: "Stocks & ETFs",
    longName: "Stock & ETFs etc",
    description: "Manage stock and ETF investments.",
    sequence: 2,
    isVisible: true,
    icon: "chart",
  },
  {
    slug: "journal",
    shortName: "Journal",
    longName: "My Journal",
    description: "A place to keep a journal with daily recordings.",
    sequence: 3,
    isVisible: true,
    icon: "book",
  },
  {
    slug: "csv-analysis",
    shortName: "CSV Analysis",
    longName: "CSV Data Analysis",
    description: "Import a CSV file for analytics.",
    sequence: 4,
    isVisible: true,
    icon: "folder",
  },
  {
    slug: "expense",
    shortName: "Expense",
    longName: "Expense Tracker",
    description: "Track credit-card spending by category.",
    sequence: 5,
    isVisible: true,
    icon: "wallet",
  },
];
