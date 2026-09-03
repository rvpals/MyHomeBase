import type { TableReferenceGroup, TableReferenceRow } from "./types";

/**
 * What each table is for, grouped by its module.
 *
 * Hand-written prose keyed off the three-letter prefix convention in
 * `coding-guide.md`. It is deliberately static rather than read from the
 * database: SQLite has nowhere to put a table comment, and the migration logs
 * that do explain each table aren't shipped to the browser.
 *
 * Keep in step with the migrations — a new table wants a line here. Anything
 * missed still shows up in the card under "Unclassified", so the reference can
 * fall behind but can never silently hide a table.
 */

/** Group headings use the module's short name, matching the nav rail. */
const GROUPS: TableReferenceGroup[] = [
  {
    prefix: "sys_",
    module: "Platform",
    summary: "Application chrome, accounts and settings — not a feature module.",
    tables: [
      ["sys_modules", "The module registry behind the nav rail and home carousel — slug, names, description, sequence, visibility, icon and carousel image."],
      ["sys_app_settings", "Application-wide key/value settings shared by every user (application name, colour theme, icon set, startup message, home widgets)."],
      ["sys_module_settings", "Per-module settings shared by all users, one row per module and key — the Stocks auto-refresh interval, the music scan extensions, and so on."],
      ["sys_user_preferences", "Per-user preferences, one row per user and key — favourite module, whether to open it at startup."],
      ["sys_users", "User accounts: username, full name, password hash, role, disabled flag, Google email and avatar."],
      ["sys_sessions", "Active login sessions — the opaque cookie id, its user and its expiry. Deleted on logout."],
      ["sys_user_module_access", "Join table granting one user access to one module."],
      ["sys_auth_events", "Append-only audit trail of every login, failed attempt and logout. Unreviewed failures raise the home-screen security warning."],
      ["sys_color_themes", "Colour themes as data — the nine colour tokens and three font keys per theme, built-ins included."],
      ["sys_daily_quotes", "The pool of quotes the home-screen daily-quote widget draws from."],
      ["sys_dashboard_texture", "Single row holding the home dashboard's background image and its opacity, tiling mode and blur."],
      ["sys_module_texture", "The same background-image treatment, one row per module, keyed by module slug."],
      ["sys_fav_photo", "Starred photographs for the home screen's random-photo card, keyed by path relative to the photo root."],
      ["sys_deployments", "One row per go-live on the NAS: when it shipped, the build metadata carried over from the build log, and the captured build output."],
      ["sys_scheduled_runs", "Last-run bookkeeping for background jobs, one row per job — when it last ran, its status and a rendered detail line."],
      ["sys_schema_migrations", "The migration tracker: one row per applied .sql file. Written by the migration runner — don't edit it by hand."],
    ],
  },
  {
    prefix: "stk_",
    module: "Stocks & ETFs",
    summary: "Brokerage accounts, holdings and the computed risk caches.",
    tables: [
      ["stk_investment_accounts", "The brokerage accounts a position or transaction belongs to, with initial and latest value."],
      ["stk_stock_positions", "Current holdings, keyed by account and ticker — quantity, prices, value, cost basis and unrealised gain/loss."],
      ["stk_stock_transactions", "Individual buy, sell and dividend transactions, deduplicated so re-importing a broker CSV is a safe no-op."],
      ["stk_daily_snapshots", "One row per calendar day of whole-portfolio value and gain/loss, split by stock, ETF and other."],
      ["stk_account_performance_records", "The manual performance history of one account — its total value on a given date."],
      ["stk_stock_watch_lists", "Named watch lists."],
      ["stk_stock_watch_list_items", "The tickers on a watch list, with hypothetical shares, the price when added and an optional reminder."],
      ["stk_ticker_favorites", "One row per starred ticker, read back as a newest-first jump list on the dashboard."],
      ["stk_ticker_logos", "Cached ticker logos. A row with no image is a deliberate negative cache — \"looked, none exists\"."],
      ["stk_ticker_profiles", "Cached sector and industry per ticker, plus a manual sector override that wins over the fetched value."],
      ["stk_ticker_risk_cache", "Computed risk figures for one ticker's Risks card — volatility, 52-week range, market correlation, annualised return."],
      ["stk_stock_volatility_cache", "Portfolio-wide volatility, one row per held ticker. Rebuilt wholesale by the analytics recompute."],
      ["stk_stock_correlation_cache", "Single row caching the latest portfolio correlation matrix as JSON."],
      ["stk_stock_sharpe_cache", "Single row caching the last Sharpe-ratio run — its inputs and its full results."],
    ],
  },
  {
    prefix: "csv_",
    module: "CSV Analysis",
    summary: "Two catalogue tables, plus one physical table per imported dataset created at runtime.",
    tables: [
      ["csv_analytics_entries", "The catalogue of imported datasets — display name, the physical table it owns, its column definitions and primary key."],
      ["csv_chart_presets", "Saved chart configurations for one dataset. Removed with the dataset."],
      ["csv_import_mappings", "The most recently used column mapping per import type, offered as the starting point next time."],
      ["csv_named_mappings", "Named, reusable column-mapping presets a user saves and picks by name."],
    ],
    note: "Any other csv_ table is imported data itself: one is created per dataset, named csv_ plus a slug of the name you gave it. Dropping one loses that dataset's rows.",
  },
  {
    prefix: "jrn_",
    module: "Journal",
    summary: "Entries and the taxonomy they hang off.",
    tables: [
      ["jrn_entries", "One journal entry — date, time, title, content, place and the weather at the time. Several per day are allowed."],
      ["jrn_categories", "The managed category list, keyed by name, each with a description and an icon."],
      ["jrn_tags", "The managed tag list. Tags can also be created inline while writing an entry."],
      ["jrn_entry_categories", "Join table pairing an entry with a category."],
      ["jrn_entry_tags", "Join table pairing an entry with a tag."],
      ["jrn_entry_locations", "GPS coordinates attached to an entry, with an optional readable place name."],
      ["jrn_saved_filters", "Named, reusable filters for the entry browser. The condition tree is JSON, compiled to a WHERE clause in code."],
      ["jrn_prefill_templates", "Named sets of starting values for a new entry, each field either a literal or \"now\"."],
      ["jrn_recycled_entries", "Recycle bin for deleted journal entries (0079). entry_id remembers the id it had, so a restore can go back where it was."],
      ["jrn_recycled_entry_categories", "Categories of a recycled entry, keyed on the bin row so a restore is lossless."],
      ["jrn_recycled_entry_tags", "Tags of a recycled entry, keyed on the bin row."],
      ["jrn_recycled_entry_locations", "GPS locations of a recycled entry, keyed on the bin row."],
    ],
  },
  {
    prefix: "exp_",
    module: "Expense",
    summary: "Card transactions and the rules that tidy them after an import.",
    tables: [
      ["exp_transactions", "One card transaction — dates, account, raw description, category, amount, vendor and reconciliation status."],
      ["exp_creditcard_accounts", "The credit-card accounts a transaction belongs to, with credit line, statement close day and card image."],
      ["exp_categories", "The editable spending-category list, keyed by the name a transaction references."],
      ["exp_vendors", "The editable vendor list — an optional description and icon for a vendor name the rollup already groups on."],
      ["exp_post_import_rules", "The condition half of the post-import cleanup: a pattern to match a description against, with a priority."],
      ["exp_post_import_rule_actions", "The assignment half: the fields a matching rule sets. One condition, many assignments."],
    ],
  },
  {
    prefix: "att_",
    module: "Attendance",
    summary: "Roster, classes and saved sessions. Records snapshot names as they were, so later edits don't rewrite history.",
    tables: [
      ["att_students", "The student roster — names, school identifier, email and a note."],
      ["att_classes", "The classes attendance is taken for."],
      ["att_class_enrollments", "Join table recording which students are in which class."],
      ["att_attendance_records", "One saved attendance session — the class, the date, who recorded it and a session label."],
      ["att_attendance_entries", "One student's present/absent status within one session."],
      ["att_student_actions", "The configurable catalogue of per-student marks, such as Late or Extra Credit. Retired ones stay for history."],
      ["att_attendance_entry_actions", "Records that a student got a particular mark in a particular session."],
    ],
  },
  {
    prefix: "mus_",
    module: "Music Library",
    summary: "The scanned catalogue, playlists and player state.",
    tables: [
      ["mus_tracks", "The scanned catalogue, one row per file — tags, duration, format, and the running play count."],
      ["mus_albums", "Albums grouped by the scanner, with cover art and a maintained track count."],
      ["mus_scan_runs", "One row per library scan — status, progress counters and the last error. This is what the scan progress display reads."],
      ["mus_track_lyrics", "Cached lyrics per track. A \"not found\" row is a negative cache, so a miss isn't refetched every play."],
      ["mus_playlists", "User playlists."],
      ["mus_playlist_tracks", "The tracks in a playlist, in order."],
      ["mus_magic_list", "Saved magic-list recipes — a target duration plus the filter criteria to fill it."],
      ["mus_magic_list_tracks", "The generated result of a magic list. Rewritten each time the list is regenerated."],
      ["mus_play_events", "Append-only play history, one row per play — the raw log behind play counts and \"recently played\"."],
      ["mus_play_queue", "The current play queue, in order."],
      ["mus_play_queue_state", "Single row holding transport state — the current entry, repeat mode and whether shuffle is on."],
    ],
  },
  {
    prefix: "gam_",
    module: "Games",
    summary: "",
    tables: [
      ["gam_scores", "The shared high-score board, one row per completed game. The list of games is code, not data."],
    ],
  },
  {
    prefix: "ico_",
    module: "Icon customisation",
    summary: "Platform-wide, not a feature module.",
    tables: [
      ["ico_slot_overrides", "Custom icons per slot and icon set, held either as inline SVG or a raster image. No row means the set's default glyph renders."],
    ],
  },
];

/** Descriptions keyed by table name, flattened from the groups above. */
const DESCRIPTION_BY_TABLE = new Map<string, string>(
  GROUPS.flatMap((group) => group.tables.map(([name, description]): [string, string] => [name, description])),
);

/** The purpose of one table, or undefined when the reference doesn't cover it. */
export function describeTable(tableName: string): string | undefined {
  return DESCRIPTION_BY_TABLE.get(tableName);
}

/**
 * The reference grouped for display, limited to tables that actually exist.
 *
 * `existingTableNames` is what the database reports. A documented table that
 * isn't there is dropped (a module may never have been used); a real table the
 * reference doesn't know about is collected into a trailing "Unclassified"
 * group so it still appears.
 */
export function buildTableReference(existingTableNames: string[]): TableReferenceGroup[] {
  const existing = new Set(existingTableNames);

  const groups = GROUPS.map((group) => ({
    ...group,
    tables: group.tables.filter(([name]) => existing.has(name)),
  })).filter((group) => group.tables.length > 0);

  const unclassified: TableReferenceRow[] = existingTableNames
    .filter((name) => !DESCRIPTION_BY_TABLE.has(name))
    .slice()
    .sort()
    .map((name) => [name, describeUnclassified(name)]);

  if (unclassified.length > 0) {
    groups.push({
      prefix: "",
      module: "Unclassified",
      summary:
        "Not in the reference — a dataset created at runtime, or a table added since this list was last updated.",
      tables: unclassified,
    });
  }

  return groups;
}

function describeUnclassified(tableName: string): string {
  if (tableName.startsWith("csv_")) {
    return "An imported CSV dataset. Its columns and primary key are described by its row in csv_analytics_entries.";
  }
  return "No description recorded.";
}
