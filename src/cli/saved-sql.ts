// The SQL Explorer's saved statements from the terminal — the same use-cases the
// "Saved SQL" card drives.
//
//   npm run cli -- saved-sql list
//   npm run cli -- saved-sql show "Recent positions"
//   npm run cli -- saved-sql save "Recent positions" "Bought this year" "investments,debugging" "SELECT * FROM inv_stock_positions"
//   npm run cli -- saved-sql delete 3
//
// `save` exists so a statement worked out in an editor can be put in front of
// the household without retyping it into a dialog, which is the point of the
// saved list being a library use-case rather than a screen.
//
// Note what is deliberately absent: there is no `run`. Loading a saved
// statement never executes it here either — use `browse-sqlite` or the web
// screen's Execute to run SQL, so a stored DELETE cannot fire from a command
// whose name sounds like a read.

import {
  deleteSavedQuery,
  listSavedQueries,
  saveQuery,
  type SavedQuery,
} from "@/lib/sql-explorer";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";

const USAGE = `Usage:
  saved-sql list
  saved-sql show <name>
  saved-sql save <name> <description> <tags> <sql>
  saved-sql delete <id>

Tags are one comma-separated argument, e.g. "investments,debugging".
Saving under an existing name replaces it.`;

function printSummary(query: SavedQuery): void {
  const tags = query.tags.length === 0 ? "" : `  [${query.tags.join(", ")}]`;
  console.log(`[${query.id}] ${query.name}${tags}`);
  if (query.description !== "") console.log(`      ${query.description}`);
}

export async function savedSqlCommand(args: string[]): Promise<void> {
  const [action, ...rest] = args;

  // Wrapped like every other write command: the schema throws on a blank name
  // or an empty statement, and that should print as a message with an exit code
  // rather than a stack trace.
  try {
    switch (action) {
      case undefined:
      case "list": {
        const queries = listSavedQueries(deps.savedQueryRepo);
        if (queries.length === 0) {
          console.log("Nothing saved yet.");
          return;
        }
        for (const query of queries) printSummary(query);
        return;
      }

      case "show": {
        const name = rest[0];
        if (!name) {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }
        // Matched case-insensitively, the way the save dialog warns about a
        // name collision — the reader typing this has a list in front of them,
        // not the exact stored spelling.
        const query = listSavedQueries(deps.savedQueryRepo).find(
          (row) => row.name.toLowerCase() === name.toLowerCase(),
        );
        if (!query) {
          console.error(`No saved query called "${name}".`);
          process.exitCode = 1;
          return;
        }
        printSummary(query);
        console.log(query.sqlStatement);
        return;
      }

      case "save": {
        const [name, description, tags, ...sqlParts] = rest;
        // The statement is joined rather than taken as one argument so an
        // unquoted multi-word SQL string still arrives whole.
        const saved = saveQuery(deps.savedQueryRepo, {
          name: name ?? "",
          description: description ?? "",
          tags: tags ?? "",
          sqlStatement: sqlParts.join(" "),
        });
        console.log(`Saved [${saved.id}] ${saved.name}`);
        return;
      }

      case "delete": {
        const id = rest[0];
        if (!id) {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }
        // Throws when nothing had that id, so a stale id reports as an error
        // rather than as a successful no-op.
        deleteSavedQuery(deps.savedQueryRepo, id);
        console.log(`Deleted saved query ${id}.`);
        return;
      }

      default:
        console.error(USAGE);
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}
