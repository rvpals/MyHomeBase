// Tests the fragile native/WASM dependencies from the terminal -- the same use-case as
// Admin -> Code Tester -> Dependency test, with argv instead of a click.
//
// Usage:
//   npm run cli -- check-dependencies                    all of them
//   npm run cli -- check-dependencies tesseract sharp    just those
//
// Ids: sqlite, tesseract, sharp, canvas. Exit code 1 when any check FAILS (a warning
// alone still exits 0), so it can follow install_dependencies_for_nas.bat in a script.
// Touches no app data: SQLite uses an in-memory database and an OS temp file.

import {
  DEPENDENCY_IDS,
  dependencyCheckSchema,
  formatDependencyReport,
  runDependencyChecks,
} from "@/lib/code-test";
import { deps } from "@/lib/wiring";

export async function checkDependenciesCommand(args: string[]): Promise<void> {
  const parsed = dependencyCheckSchema.safeParse({ ids: args });
  if (!parsed.success) {
    console.error(`Unknown dependency. Choose from: ${DEPENDENCY_IDS.join(", ")} (or none for all).`);
    process.exitCode = 1;
    return;
  }

  const report = await runDependencyChecks(
    { ...deps.codeTestDependencies, now: () => performance.now(), clock: () => new Date() },
    parsed.data,
  );
  console.log(formatDependencyReport(report));
  if (report.status === "fail") process.exitCode = 1;
}
