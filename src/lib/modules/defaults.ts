import type { ModuleSeed } from "./types";

// Mirrors the seed INSERTs in migrations/0005_seed_stock_etfs_module.sql,
// migrations/0012_seed_journal_module.sql, migrations/0020_seed_csv_analysis_module.sql,
// migrations/0030_seed_expense_module.sql, and
// migrations/0048_seed_attendance_module.sql.
// "Reset to Default" restores the table to exactly this list — keep both in sync.
export const DEFAULT_MODULES: ModuleSeed[] = [
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
  {
    slug: "attendance",
    shortName: "Attendance",
    longName: "Class Attendance",
    description: "Take daily attendance for a class.",
    sequence: 6,
    isVisible: true,
    // MODULE_ICON_NAMES has no `users` glyph; `book` is the closest fit for a
    // class register. Changing it later is an admin edit, not a migration.
    icon: "book",
  },
];
