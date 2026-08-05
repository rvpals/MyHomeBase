// Rehearses every pending migration against a throwaway copy of the development
// database, so a migration that fails does so on a copy and not on real data.
//
// `coding-guide.md` asks for exactly this rehearsal before any create-copy-drop
// rebuild. This makes it a gate rather than a thing to remember.
import { copyDatabaseForVerification, runMigrationsAgainst } from "./verify-db";

function main(): void {
  console.log("Migration dry-run\n");

  const copyPath = copyDatabaseForVerification("migration-dry-run.db");
  console.log("");

  const exitCode = runMigrationsAgainst(copyPath);

  if (exitCode !== 0) {
    console.error("\nMigration dry-run FAILED. The development database was not touched.");
    process.exit(exitCode);
  }

  console.log("\nMigration dry-run passed. The development database was not touched.");
}

try {
  main();
} catch (error) {
  // Surfaced rather than swallowed: the usual cause is a misconfigured
  // MYHOMEBASE_DB, and the message explains how to fix it.
  console.error(`\nMigration dry-run could not start.\n${(error as Error).message}`);
  process.exit(1);
}
