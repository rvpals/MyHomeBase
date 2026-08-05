// Shared plumbing for the /verify gates that need a database.
//
// Every gate here works on a *copy* of the development database, never the file
// itself. Two separate incidents motivated that: a migration once ran against the
// repo's fallback `data/myhomebase.db` instead of the real dev database, and a
// browser smoke test writes rows (it registers an account) that have no business
// landing in real data.
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

/** Working directory for throwaway database copies. Gitignored. */
export const VERIFY_DIRECTORY = path.join(process.cwd(), ".verify");

/**
 * Credentials for the account the browser smoke test signs in as. These are
 * deliberately hardcoded and deliberately not secret: the account only ever
 * exists inside a throwaway copy of the database, so there is nothing to leak
 * and nothing for the user to configure.
 */
export const SMOKE_TEST_USERNAME = "verify-smoke-user";
export const SMOKE_TEST_PASSWORD = "verify-smoke-password";

/**
 * Resolves the development database that gates copy from, and refuses to guess.
 *
 * `src/lib/wiring.ts` and `scripts/migrate.ts` both silently fall back to
 * `./data/myhomebase.db` when MYHOMEBASE_DB is unset. That fallback is what let a
 * migration hit the wrong database, so here an unset variable is a hard failure
 * with an explanation rather than a default.
 */
export function resolveSourceDatabasePath(): string {
  const configuredPath = process.env.MYHOMEBASE_DB;

  if (!configuredPath) {
    throw new Error(
      "MYHOMEBASE_DB is not set, so the source database is unknown.\n" +
        "Run this through an npm script (they pass --env-file-if-exists=.env) rather than directly,\n" +
        "or set MYHOMEBASE_DB to the development database path.",
    );
  }

  const absolutePath = path.resolve(configuredPath);
  const repositoryFallbackDirectory = path.join(process.cwd(), "data");

  if (absolutePath.startsWith(repositoryFallbackDirectory)) {
    throw new Error(
      `MYHOMEBASE_DB resolves to ${absolutePath}, which is inside the repository's data/ folder.\n` +
        "That is the fallback database, not the real development one. Point MYHOMEBASE_DB at the\n" +
        "development database (see .env) before running a verification gate.",
    );
  }

  if (!existsSync(absolutePath)) {
    throw new Error(`Source database does not exist: ${absolutePath}`);
  }

  return absolutePath;
}

/**
 * Copies the source database to a fresh file under `.verify/` and returns its path.
 *
 * SQLite in WAL mode keeps recent commits in a sidecar `-wal` file, so copying only
 * the `.db` would silently lose them. Any stale copy is removed first — a gate that
 * ran against leftovers from a previous run would be worse than no gate.
 */
export function copyDatabaseForVerification(copyFileName: string): string {
  const sourcePath = resolveSourceDatabasePath();
  mkdirSync(VERIFY_DIRECTORY, { recursive: true });

  const destinationPath = path.join(VERIFY_DIRECTORY, copyFileName);
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${destinationPath}${suffix}`, { force: true });
  }

  copyFileSync(sourcePath, destinationPath);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(`${sourcePath}${suffix}`)) {
      copyFileSync(`${sourcePath}${suffix}`, `${destinationPath}${suffix}`);
    }
  }

  console.log(`Source database:      ${sourcePath}`);
  console.log(`Verification copy:    ${destinationPath}`);
  return destinationPath;
}

/**
 * Runs the real migration script against `databasePath`.
 *
 * Spawned rather than imported because `scripts/migrate.ts` resolves its target
 * database at module load and applies migrations as an import side effect — there
 * is no way to redirect it after the fact.
 */
export function runMigrationsAgainst(databasePath: string): number {
  // Passed as one shell string rather than command + args: with `shell: true`, Node
  // deprecates the args form (DEP0190) because it concatenates without escaping.
  const result = spawnSync("npx tsx scripts/migrate.ts", {
    env: { ...process.env, MYHOMEBASE_DB: databasePath },
    stdio: "inherit",
    shell: true,
  });

  return result.status ?? 1;
}
