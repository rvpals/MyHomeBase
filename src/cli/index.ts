// Command router: argv -> command. Peer of src/app — same use-cases, different I/O.
// Register commands here as they're added; each command is a thin adapter that
// parses args, validates with the module's zod schema, calls a lib use-case, and prints.
import { attendanceReportCommand } from "./attendance-report";
import { colorThemesCommand } from "./color-themes";
import { computeAnalyticsCommand } from "./compute-analytics";
import { createCsvAnalyticsEntryCommand } from "./create-csv-analytics-entry";
import { createUserCommand } from "./create-user";
import { csvBulkEditCommand } from "./csv-bulk-edit";
import { csvViewsCommand } from "./csv-views";
import { deleteCsvAnalyticsEntryCommand } from "./delete-csv-analytics-entry";
import { deploymentsCommand } from "./deployments";
import { expenseTopSpendersCommand } from "./expense-top-spenders";
import { explainRuleCommand } from "./explain-rule";
import { expenseCreateRuleCommand } from "./expense-create-rule";
import { exportPortfolioCommand } from "./export-portfolio";
import { consultTickerCommand } from "./consult-ticker";
import { normalizeIconOverridesCommand } from "./normalize-icon-overrides";
import { resizeCarouselImagesCommand } from "./resize-carousel-images";
import { gameScoresCommand } from "./game-scores";
import { favPhotosCommand } from "./fav-photos";
import { favoriteQuotesCommand } from "./favorite-quotes";
import { importJournalCsvCommand } from "./import-journal-csv";
import { importJournalIcsCommand } from "./import-journal-ics";
import { journalCalendarCommand } from "./journal-calendar";
import { journalLocationsCommand } from "./journal-locations";
import { journalTemplatesCommand } from "./journal-templates";
import { listCsvAnalyticsCommand } from "./list-csv-analytics";
import { listScheduledJobsCommand } from "./list-scheduled-jobs";
import { listUsersCommand } from "./list-users";
import { magicPlaylistCommand } from "./magic-playlist";
import { marketIndexesCommand } from "./market-indexes";
import { photoMagicCommand } from "./photo-magic";
import { playQueueCommand } from "./play-queue";
import { musicLibraryCommand, scanMusicCommand } from "./scan-music";
import { refreshPositionsCommand } from "./refresh-positions";
import { runScheduledRefreshCommand } from "./run-scheduled-refresh";
import { setStartupMessageCommand } from "./set-startup-message";
import { browseCsvCommand } from "./browse-csv";
import { browseSqliteCommand } from "./browse-sqlite";
import { takeAttendanceCommand } from "./take-attendance";
import { taxLotsCommand } from "./tax-lots";
import { simulateTickerCommand } from "./simulate-ticker";
import { tickerOverviewCommand } from "./ticker-overview";
import { calculatorCommand } from "./calculator";
import { scratchpadCommand } from "./scratchpad";
import { userPreferencesCommand } from "./user-preferences";

type Command = (args: string[]) => Promise<void> | void;

const commands: Record<string, Command> = {
  "create-user": createUserCommand,
  "list-users": listUsersCommand,
  "refresh-positions": refreshPositionsCommand,
  "run-scheduled-refresh": runScheduledRefreshCommand,
  "list-scheduled-jobs": listScheduledJobsCommand,
  "compute-analytics": computeAnalyticsCommand,
  "list-csv-analytics": listCsvAnalyticsCommand,
  "create-csv-analytics-entry": createCsvAnalyticsEntryCommand,
  "delete-csv-analytics-entry": deleteCsvAnalyticsEntryCommand,
  "csv-views": csvViewsCommand,
  "csv-bulk-edit": csvBulkEditCommand,
  "import-journal-csv": importJournalCsvCommand,
  "import-journal-ics": importJournalIcsCommand,
  "journal-calendar": journalCalendarCommand,
  "journal-locations": journalLocationsCommand,
  "journal-templates": journalTemplatesCommand,
  "expense-top-spenders": expenseTopSpendersCommand,
  "export-portfolio": exportPortfolioCommand,
  "consult-ticker": consultTickerCommand,
  "explain-rule": explainRuleCommand,
  "expense-create-rule": expenseCreateRuleCommand,
  "normalize-icon-overrides": normalizeIconOverridesCommand,
  "resize-carousel-images": resizeCarouselImagesCommand,
  "ticker-overview": tickerOverviewCommand,
  "simulate-ticker": simulateTickerCommand,
  "market-indexes": marketIndexesCommand,
  "favorite-quotes": favoriteQuotesCommand,
  "color-themes": colorThemesCommand,
  "fav-photos": favPhotosCommand,
  "game-scores": gameScoresCommand,
  "set-startup-message": setStartupMessageCommand,
  deployments: deploymentsCommand,
  "user-preferences": userPreferencesCommand,
  calculator: calculatorCommand,
  scratchpad: scratchpadCommand,
  "take-attendance": takeAttendanceCommand,
  "attendance-report": attendanceReportCommand,
  "scan-music": scanMusicCommand,
  "music-library": musicLibraryCommand,
  "magic-playlist": magicPlaylistCommand,
  "photo-magic": photoMagicCommand,
  "play-queue": playQueueCommand,
  "tax-lots": taxLotsCommand,
  "browse-sqlite": browseSqliteCommand,
  "browse-csv": browseCsvCommand,
};

async function main(argv: string[]) {
  const [name, ...args] = argv;
  const command = name ? commands[name] : undefined;

  if (!command) {
    console.error(`Unknown command: ${name ?? "(none)"}`);
    console.error(`Available commands: ${Object.keys(commands).join(", ") || "(none registered)"}`);
    process.exitCode = 1;
    return;
  }

  await command(args);
}

main(process.argv.slice(2));
