import type { ModuleSeed } from "./types";

// Mirrors the seed INSERTs in migrations/0005_seed_stock_etfs_module.sql,
// migrations/0012_seed_journal_module.sql, migrations/0020_seed_csv_analysis_module.sql,
// migrations/0030_seed_expense_module.sql, and
// migrations/0048_seed_attendance_module.sql,
// migrations/0053_seed_music_library_module.sql, as amended by
// migrations/0050_journal_and_roster_module_icons.sql (which repointed the Journal
// and Attendance icons off the shared `book` glyph) and
// migrations/0055_music_library_music_icon.sql (which moved Music Library off the
// borrowed `heart` onto a real music glyph).
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
    icon: "journal",
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
    icon: "roster",
  },
  {
    slug: "music-library",
    shortName: "Music Library",
    longName: "My Music Library",
    description: "Browse and stream your music collection.",
    sequence: 7,
    isVisible: true,
    icon: "music",
  },
];
