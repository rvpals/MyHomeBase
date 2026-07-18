// Command router: argv -> command. Peer of src/app — same use-cases, different I/O.
// Register commands here as they're added; each command is a thin adapter that
// parses args, validates with the module's zod schema, calls a lib use-case, and prints.
import { addPropertyCommand } from "./add-property";
import { computeAnalyticsCommand } from "./compute-analytics";
import { createUserCommand } from "./create-user";
import { deletePropertyCommand } from "./delete-property";
import { listPropertiesCommand } from "./list-properties";
import { listWatchlistCommand } from "./list-watchlist";
import { lookupPropertyCommand } from "./lookup-property";
import { refreshPositionsCommand } from "./refresh-positions";
import { refreshWatchlistCommand } from "./refresh-watchlist";
import { removeFromWatchlistCommand } from "./remove-from-watchlist";
import { watchPropertyCommand } from "./watch-property";
import { watchlistHistoryCommand } from "./watchlist-history";

type Command = (args: string[]) => Promise<void> | void;

const commands: Record<string, Command> = {
  "create-user": createUserCommand,
  "list-properties": listPropertiesCommand,
  "add-property": addPropertyCommand,
  "delete-property": deletePropertyCommand,
  "lookup-property": lookupPropertyCommand,
  "watch-property": watchPropertyCommand,
  "list-watchlist": listWatchlistCommand,
  "watchlist-history": watchlistHistoryCommand,
  "refresh-watchlist": refreshWatchlistCommand,
  "remove-from-watchlist": removeFromWatchlistCommand,
  "refresh-positions": refreshPositionsCommand,
  "compute-analytics": computeAnalyticsCommand,
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
