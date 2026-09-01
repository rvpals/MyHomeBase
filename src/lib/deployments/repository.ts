import type Database from "better-sqlite3";
import type { DeploymentRepository, NewDeploymentRow } from "./ports";
import type { Deployment } from "./types";

interface DeploymentRow {
  id: number;
  deployed_at: string;
  built_at: string | null;
  build_id: string | null;
  app_version: string | null;
  built_on_host: string | null;
  node_abi: number | null;
  package_size_bytes: number | null;
  migrated: number;
  build_output: string | null;
}

function toDeployment(row: DeploymentRow): Deployment {
  return {
    id: row.id,
    deployedAt: row.deployed_at,
    builtAt: row.built_at,
    buildId: row.build_id,
    appVersion: row.app_version,
    builtOnHost: row.built_on_host,
    nodeAbi: row.node_abi,
    packageSizeBytes: row.package_size_bytes,
    // SQLite has no boolean; the CHECK on the column keeps this 0 or 1.
    migrated: row.migrated === 1,
    buildOutput: row.build_output,
  };
}

// See migrations/0078_create_deployments.md. Two callers on two machines: the About screen
// reads through `list`, and `scripts/record-deployment.ts` writes through `record` on the
// deployment target as a new build comes up.
export class SqliteDeploymentRepository implements DeploymentRepository {
  constructor(private db: Database.Database) {}

  list(): Deployment[] {
    // `id DESC` breaks ties: two deployments in the same second (a failed start that the
    // every-minute task retried) would otherwise come back in an arbitrary order that
    // could change between reads.
    const rows = this.db
      .prepare("SELECT * FROM sys_deployments ORDER BY deployed_at DESC, id DESC")
      .all() as DeploymentRow[];
    return rows.map(toDeployment);
  }

  record(row: NewDeploymentRow): number {
    const result = this.db
      .prepare(
        `INSERT INTO sys_deployments
           (deployed_at, built_at, build_id, app_version, built_on_host,
            node_abi, package_size_bytes, migrated, build_output)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.deployedAt,
        row.builtAt,
        row.buildId,
        row.appVersion,
        row.builtOnHost,
        row.nodeAbi,
        row.packageSizeBytes,
        row.migrated ? 1 : 0,
        row.buildOutput,
      );
    return Number(result.lastInsertRowid);
  }

  delete(id: number): boolean {
    const result = this.db.prepare("DELETE FROM sys_deployments WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
