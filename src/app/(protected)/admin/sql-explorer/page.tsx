import {
  groupTablesByModule,
  listSavedQueries,
  listSchemaObjectGroups,
  listTables,
} from "@/lib/sql-explorer";
import { listModules } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { SqlExplorerView } from "./view";

export default function SqlExplorerPage() {
  const tables = listTables(deps.sqlExplorerRepo);
  // Hidden modules included: this is an admin screen, and a hidden module's
  // tables still exist and still need somewhere to be listed.
  const modules = listModules(deps.moduleRepo, { includeHidden: true });

  return (
    <SqlExplorerView
      tables={tables}
      schemaGroups={listSchemaObjectGroups(deps.sqlExplorerRepo)}
      savedQueries={listSavedQueries(deps.savedQueryRepo)}
      moduleGroups={groupTablesByModule(
        tables.map((table) => table.name),
        modules,
      )}
    />
  );
}
