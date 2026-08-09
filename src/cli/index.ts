// Command router: argv -> command. Peer of src/app — same use-cases, different I/O.
// Register commands here as they're added; each command is a thin adapter that
// parses args, validates with the module's zod schema, calls a lib use-case, and prints.
import { computeAnalyticsCommand } from "./compute-analytics";
import { createCsvAnalyticsEntryCommand } from "./create-csv-analytics-entry";
import { createUserCommand } from "./create-user";
import { deleteCsvAnalyticsEntryCommand } from "./delete-csv-analytics-entry";
import { expenseTopSpendersCommand } from "./expense-top-spenders";
import { explainRuleCommand } from "./explain-rule";
import { importJournalCsvCommand } from "./import-journal-csv";
import { listCsvAnalyticsCommand } from "./list-csv-analytics";
import { listUsersCommand } from "./list-users";
import { refreshPositionsCommand } from "./refresh-positions";
import { setStartupMessageCommand } from "./set-startup-message";
import { tickerOverviewCommand } from "./ticker-overview";

type Command = (args: string[]) => Promise<void> | void;

const commands: Record<string, Command> = {
  "create-user": createUserCommand,
  "list-users": listUsersCommand,
  "refresh-positions": refreshPositionsCommand,
  "compute-analytics": computeAnalyticsCommand,
  "list-csv-analytics": listCsvAnalyticsCommand,
  "create-csv-analytics-entry": createCsvAnalyticsEntryCommand,
  "delete-csv-analytics-entry": deleteCsvAnalyticsEntryCommand,
  "import-journal-csv": importJournalCsvCommand,
  "expense-top-spenders": expenseTopSpendersCommand,
  "explain-rule": explainRuleCommand,
  "ticker-overview": tickerOverviewCommand,
  "set-startup-message": setStartupMessageCommand,
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
