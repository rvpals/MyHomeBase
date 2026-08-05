import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke tests for /verify. These are not a general end-to-end suite — they
 * answer one question: does every page still render for a signed-in user, without a
 * server error and without a console error.
 */

// Deliberately not 3000. The dev server this config boots must be a *fresh* one with
// a cleared .next cache; attaching to whatever is already on the usual dev port would
// quietly defeat that and re-create the stale-cache confusion this gate exists to end.
const SMOKE_TEST_PORT = 3100;

/** Written by `npm run verify:prepare-db`. A copy — never the development database. */
const SMOKE_DATABASE_PATH = path.join(process.cwd(), ".verify", "smoke.db");

export const AUTHENTICATED_STATE_PATH = path.join(process.cwd(), "e2e", ".auth", "state.json");

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown.ts",
  // One worker against one dev server and one SQLite file. Parallel workers would
  // contend on both and turn compile-on-demand slowness into flaky timeouts.
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  // No retries: a retry that passes would hide exactly the intermittent breakage
  // this gate is supposed to report.
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  // Must exceed navigationTimeout below, or a slow first compile is reported as a test
  // timeout with no useful detail instead of as a navigation failure.
  timeout: 150_000,

  use: {
    // localhost, not 127.0.0.1: Next's dev server treats 127.0.0.1 as a cross-origin
    // host and blocks its own HMR endpoint, which breaks client hydration — and an
    // unhydrated form submits natively instead of running its React handler.
    baseURL: `http://localhost:${SMOKE_TEST_PORT}`,
    // Generous because the first visit to each route compiles it from a cleared cache.
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: AUTHENTICATED_STATE_PATH },
    },
  ],

  webServer: {
    command: `npm run dev -- --port ${SMOKE_TEST_PORT}`,
    url: `http://localhost:${SMOKE_TEST_PORT}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { MYHOMEBASE_DB: SMOKE_DATABASE_PATH },
  },
});
