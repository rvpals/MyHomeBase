// Command router: argv -> command. Peer of src/app — same use-cases, different I/O.
// Register commands here as they're added; each command is a thin adapter that
// parses args, validates with the module's zod schema, calls a lib use-case, and prints.
import { attendanceReportCommand } from "./attendance-report";
import { computeAnalyticsCommand } from "./compute-analytics";
import { createCsvAnalyticsEntryCommand } from "./create-csv-analytics-entry";
import { createUserCommand } from "./create-user";
import { deleteCsvAnalyticsEntryCommand } from "./delete-csv-analytics-entry";
import { expenseTopSpendersCommand } from "./expense-top-spenders";
import { explainRuleCommand } from "./explain-rule";
import { favoriteQuotesCommand } from "./favorite-quotes";
import { importJournalCsvCommand } from "./import-journal-csv";
import { journalCalendarCommand } from "./journal-calendar";
import { journalTemplatesCommand } from "./journal-templates";
import { listCsvAnalyticsCommand } from "./list-csv-analytics";
import { listUsersCommand } from "./list-users";
import { magicPlaylistCommand } from "./magic-playlist";
import { playQueueCommand } from "./play-queue";
import { musicLibraryCommand, scanMusicCommand } from "./scan-music";
import { refreshPositionsCommand } from "./refresh-positions";
import { runScheduledRefreshCommand } from "./run-scheduled-refresh";
import { setStartupMessageCommand } from "./set-startup-message";
import { takeAttendanceCommand } from "./take-attendance";
import { tickerOverviewCommand } from "./ticker-overview";
import { userPreferencesCommand } from "./user-preferences";

type Command = (args: string[]) => Promise<void> | void;

const commands: Record<string, Command> = {
  "create-user": createUserCommand,
  "list-users": listUsersCommand,
  "refresh-positions": refreshPositionsCommand,
  "run-scheduled-refresh": runScheduledRefreshCommand,
  "compute-analytics": computeAnalyticsCommand,
  "list-csv-analytics": listCsvAnalyticsCommand,
  "create-csv-analytics-entry": createCsvAnalyticsEntryCommand,
  "delete-csv-analytics-entry": deleteCsvAnalyticsEntryCommand,
  "import-journal-csv": importJournalCsvCommand,
  "journal-calendar": journalCalendarCommand,
  "journal-templates": journalTemplatesCommand,
  "expense-top-spenders": expenseTopSpendersCommand,
  "explain-rule": explainRuleCommand,
  "ticker-overview": tickerOverviewCommand,
  "favorite-quotes": favoriteQuotesCommand,
  "set-startup-message": setStartupMessageCommand,
  "user-preferences": userPreferencesCommand,
  "take-attendance": takeAttendanceCommand,
  "attendance-report": attendanceReportCommand,
  "scan-music": scanMusicCommand,
  "music-library": musicLibraryCommand,
  "magic-playlist": magicPlaylistCommand,
  "play-queue": playQueueCommand,
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
