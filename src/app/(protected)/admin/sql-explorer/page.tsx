import { listTables } from "@/lib/sql-explorer";
import { deps } from "@/lib/wiring";
import { SqlExplorerView } from "./view";

export default function SqlExplorerPage() {
  return <SqlExplorerView tables={listTables(deps.sqlExplorerRepo)} />;
}
