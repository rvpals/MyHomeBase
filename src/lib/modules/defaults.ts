import type { ModuleSeed } from "./types";

// Mirrors the seed INSERTs in migrations/0005_seed_stock_etfs_module.sql,
// as amended by migrations/0108_rename_stock_etfs_to_investments.sql (which renamed
// the slug to `investments` and retitled the module),
// migrations/0012_seed_journal_module.sql, migrations/0020_seed_csv_analysis_module.sql,
// migrations/0030_seed_expense_module.sql, and
// migrations/0048_seed_attendance_module.sql,
// migrations/0053_seed_music_library_module.sql, as amended by
// migrations/0050_journal_and_roster_module_icons.sql (which repointed the Journal
// and Attendance icons off the shared `book` glyph) and
// migrations/0055_music_library_music_icon.sql (which moved Music Library off the
// borrowed `heart` onto a real music glyph), and
// migrations/0075_seed_games_module.sql, and
// migrations/0084_seed_picture_gallery_module.sql, as amended by
// migrations/0085_picture_gallery_photo_icon.sql (which moved Picture Gallery off
// the borrowed `heart` onto a real photo glyph), and
// migrations/0098_seed_tools_module.sql, and
// migrations/0119_seed_household_module.sql, and
// migrations/0143_rename_attendance_to_classroom.sql (which renamed the Attendance
// module to Classroom, folding Attendance into it as a section group), and
// migrations/0156_seed_clips_module.sql, and
// migrations/0160_seed_documents_module.sql.
// "Reset to Default" restores the table to exactly this list — keep both in sync.
export const DEFAULT_MODULES: ModuleSeed[] = [
  {
    slug: "investments",
    shortName: "Investments",
    longName: "Investments",
    description: "Manage stock, ETF and fund investments.",
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
    // Was Attendance until migration 0143, which made Attendance a section group
    // inside Classroom and added a second group for Exam. Keeps sequence 6 and the
    // `roster` glyph — there is no `classroom` module icon, and `roster` is already
    // "a class register".
    slug: "classroom",
    shortName: "Classroom",
    longName: "Classroom",
    description: "Attendance registers and exams.",
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
  {
    slug: "games",
    shortName: "Games",
    longName: "Games & Puzzles",
    description: "Play a quick game and keep a high-score board.",
    sequence: 8,
    isVisible: true,
    icon: "game",
  },
  {
    slug: "picture-gallery",
    shortName: "Picture Gallery",
    longName: "My Picture Gallery",
    description: "Browse the photo archive and the pictures you have kept.",
    sequence: 9,
    isVisible: true,
    icon: "photo",
  },
  {
    slug: "tools",
    shortName: "Tools",
    longName: "Tools & Utilities",
    description: "This module list all the utilities and tools",
    sequence: 10,
    isVisible: true,
    icon: "tool",
  },
  {
    slug: "household",
    shortName: "Household",
    longName: "Household",
    description: "Recipes, receipts and the HSA — the household's paperwork.",
    sequence: 11,
    isVisible: true,
    icon: "household",
  },
  {
    // `folder` rather than a `clip` glyph: adding a name to MODULE_ICON_NAMES means
    // drawing it in all twelve generated icon sets, which is its own job with its own
    // migration — the same way Music Library and Picture Gallery each borrowed a glyph
    // until 0055 and 0085 gave them real ones. See migrations/0156_seed_clips_module.md.
    slug: "clips",
    shortName: "Clips",
    longName: "Clips",
    description: "Rich-text notes with tags and pasted images, linkable to a journal entry.",
    sequence: 12,
    isVisible: true,
    icon: "folder",
  },
  {
    // `folder` again, for the reason the entry above records — a `document` glyph
    // would have to be drawn in all twelve generated icon sets, which is its own
    // migration. See migrations/0160_seed_documents_module.md.
    slug: "documents",
    shortName: "Documents",
    longName: "Document Library",
    description: "Filed documents with categories, tags and their attachment files.",
    sequence: 13,
    isVisible: true,
    icon: "folder",
  },
];
