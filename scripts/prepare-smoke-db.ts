// Builds the database the browser smoke test runs against: a migrated copy of the
// development database plus one admin account to sign in as.
//
// A copy rather than the real thing because the smoke test writes — it exercises the
// create-account flow, which inserts a user. Migrated because the copy has to match
// the schema the current code expects; if a pending migration hasn't been applied to
// the dev database yet, the app would 500 on pages the smoke test is meant to check.
import {
  SMOKE_TEST_PASSWORD,
  SMOKE_TEST_USERNAME,
  copyDatabaseForVerification,
  runMigrationsAgainst,
} from "./verify-db";

/** Deterministic so playwright.config.ts can point the dev server at it without a manifest. */
export const SMOKE_DATABASE_FILE_NAME = "smoke.db";

async function main(): Promise<void> {
  console.log("Preparing smoke-test database\n");

  const copyPath = copyDatabaseForVerification(SMOKE_DATABASE_FILE_NAME);
  console.log("");

  const migrationExitCode = runMigrationsAgainst(copyPath);
  if (migrationExitCode !== 0) {
    throw new Error("Migrations failed against the smoke-test database copy.");
  }

  // Imported dynamically, after the environment variable is redirected: the
  // composition root resolves its database path at module load, so a static import
  // would have already connected to the development database.
  process.env.MYHOMEBASE_DB = copyPath;
  const { deps } = await import("../src/lib/wiring");
  const { createUser, setUserPassword, setUserRole, setUserModuleAccess } = await import(
    "../src/lib/user"
  );
  const { listModules } = await import("../src/lib/modules");

  const existingUser = deps.userRepo.findCredentialsByUsername(SMOKE_TEST_USERNAME);
  let userId: number;

  if (existingUser) {
    // The copy already carries an account with this name. Reset it to a known
    // state rather than failing — the alternative is a gate that breaks once and
    // stays broken.
    userId = existingUser.id;
    setUserPassword(userId, { password: SMOKE_TEST_PASSWORD }, deps.userRepo);
    // Acting on itself is only rejected for a demotion, and this is a promotion.
    setUserRole(userId, userId, "admin", deps.userRepo);
  } else {
    const created = createUser(
      {
        username: SMOKE_TEST_USERNAME,
        fullName: "Verify Smoke User",
        description: "Created by npm run verify:prepare-db. Exists only in .verify/smoke.db.",
        password: SMOKE_TEST_PASSWORD,
        role: "admin",
      },
      deps.userRepo,
    );
    userId = created.id;
  }

  // Granted explicitly for every module rather than relying on the admin role to
  // imply access, because the module and section pages check module access directly.
  const allModules = listModules(deps.moduleRepo);
  setUserModuleAccess(
    userId,
    allModules.map((appModule) => appModule.id),
    deps.userRepo,
  );

  console.log(
    `\nSmoke-test account ready: ${SMOKE_TEST_USERNAME} (admin, ${allModules.length} module(s) granted).`,
  );
}

main().catch((error: unknown) => {
  console.error(`\nCould not prepare the smoke-test database.\n${(error as Error).message}`);
  process.exit(1);
});
