import { test, expect, type Page } from "@playwright/test";

/**
 * Route sweep. For every page a signed-in admin can reach, assert three things:
 * the document didn't come back 4xx/5xx, React didn't log an error, and the Next.js
 * dev error overlay isn't showing.
 *
 * The route list is deliberately part hardcoded, part crawled. Admin pages are a
 * fixed set, so they're listed. Module pages and their sections are driven by rows in
 * `sys_modules` and by each module's own section registry, so they're discovered from
 * the navigation at runtime — a hardcoded list would silently stop covering a module
 * the day someone adds one.
 */

/** Fixed pages outside the module system. Several of these have regressed before. */
const CORE_ROUTES = ["/", "/account"] as const;

const ADMIN_ROUTES = [
  "/admin",
  "/admin/about",
  "/admin/user-management",
  "/admin/security",
  "/admin/sql-explorer",
  "/admin/daily-quote",
  "/admin/daily-quote/add",
  "/admin/daily-quote/import",
  "/admin/configuration/application",
  "/admin/configuration/modules",
  "/admin/configuration/themes",
  "/admin/configuration/icons",
  "/admin/configuration/texture",
] as const;

/**
 * Console noise that must not fail the sweep.
 *
 * A missing subresource is allowed only for 404 — optional per-row images (avatars,
 * category icons, ticker logos) legitimately 404 when unset. A 5xx subresource is a
 * real server fault and is left to fail.
 */
/**
 * Headings the Next.js dev error overlay draws. Matching on the wording rather than on
 * overlay internals keeps this working across Next versions, at the cost of tripping if
 * a real page ever renders one of these phrases as visible copy.
 */
const ERROR_OVERLAY_HEADINGS =
  /Unhandled Runtime Error|Runtime Error|Build Error|Failed to compile|Server Error/;

const IGNORED_CONSOLE_PATTERNS = [
  /Failed to load resource: the server responded with a status of 404/,
  /Download the React DevTools/,
] as const;

interface PageProblems {
  consoleErrors: string[];
}

/**
 * Starts recording console and uncaught-page errors for the rest of this page's life.
 * Returns the collector so a test can assert on it after navigating.
 */
function recordPageProblems(page: Page): PageProblems {
  const problems: PageProblems = { consoleErrors: [] };

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) return;
    problems.consoleErrors.push(text);
  });

  // An uncaught exception in a client component doesn't always reach console.error,
  // so it's captured separately.
  page.on("pageerror", (error) => {
    problems.consoleErrors.push(`Uncaught: ${error.message}`);
  });

  return problems;
}

/**
 * Navigates to one route and soft-asserts that it is healthy.
 *
 * Soft assertions on purpose: the point of a sweep is a full list of what's broken,
 * not the first thing that broke.
 */
async function visitAndAssertHealthy(page: Page, route: string, problems: PageProblems): Promise<void> {
  const errorsBefore = problems.consoleErrors.length;

  const response = await page.goto(route, { waitUntil: "domcontentloaded" });

  expect.soft(response, `${route}: no response`).not.toBeNull();
  expect
    .soft(response?.status() ?? 0, `${route}: HTTP status`)
    .toBeLessThan(400);

  // A render or build error can still come back HTTP 200 with the dev overlay drawn
  // over the page, so status alone is not enough.
  //
  // Matched by the overlay's heading text rather than by `nextjs-portal`: that element
  // hosts the dev-tools indicator and is present on *every* dev page, so asserting it
  // is absent fails everywhere. Playwright's text engine pierces the shadow root the
  // overlay renders into.
  await expect
    .soft(
      page.getByText(ERROR_OVERLAY_HEADINGS),
      `${route}: Next.js error overlay is showing`,
    )
    .toHaveCount(0);

  const newErrors = problems.consoleErrors.slice(errorsBefore);
  expect.soft(newErrors, `${route}: console errors`).toEqual([]);
}

/**
 * Reads every distinct link on the current page whose path starts with `prefix`.
 * Used to discover module and section routes from the rendered navigation.
 */
async function collectLinkPaths(page: Page, prefix: string): Promise<string[]> {
  const hrefs = await page.locator(`a[href^="${prefix}"]`).evaluateAll((anchors) =>
    anchors.map((anchor) => anchor.getAttribute("href") ?? ""),
  );

  return [...new Set(hrefs.filter((href) => href.startsWith(prefix)))].sort();
}

test("core pages render", async ({ page }) => {
  const problems = recordPageProblems(page);

  for (const route of CORE_ROUTES) {
    await test.step(route, () => visitAndAssertHealthy(page, route, problems));
  }
});

test("administration pages render", async ({ page }) => {
  const problems = recordPageProblems(page);

  for (const route of ADMIN_ROUTES) {
    await test.step(route, () => visitAndAssertHealthy(page, route, problems));
  }
});

test("every module dashboard and section renders", async ({ page }) => {
  const problems = recordPageProblems(page);

  await visitAndAssertHealthy(page, "/", problems);
  const moduleRoutes = await collectLinkPaths(page, "/modules/");
  expect(moduleRoutes.length, "no module links found in the navigation").toBeGreaterThan(0);

  // Sections are only linked from inside their own module, so discovery has to happen
  // after landing on each module page rather than all up front.
  const visitedRoutes = new Set<string>();

  for (const moduleRoute of moduleRoutes) {
    await test.step(moduleRoute, () => visitAndAssertHealthy(page, moduleRoute, problems));
    visitedRoutes.add(moduleRoute);

    for (const sectionRoute of await collectLinkPaths(page, `${moduleRoute}/`)) {
      if (visitedRoutes.has(sectionRoute)) continue;
      visitedRoutes.add(sectionRoute);
      await test.step(sectionRoute, () => visitAndAssertHealthy(page, sectionRoute, problems));
    }
  }

  // Printed so a passing run still shows its coverage — a crawl that silently found
  // only one route would otherwise look identical to a full sweep.
  console.log(
    `Swept ${visitedRoutes.size} module route(s):\n  ${[...visitedRoutes].sort().join("\n  ")}`,
  );
});

test.describe("signed out", () => {
  // A signed-in visitor is redirected away from /login, so these tests need a context
  // with no session cookie rather than the shared authenticated state.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("login and create-account pages render", async ({ page }) => {
    const problems = recordPageProblems(page);

    for (const route of ["/login", "/login/register"]) {
      await test.step(route, () => visitAndAssertHealthy(page, route, problems));
    }
  });

  test("create-account flow creates an account", async ({ page }) => {
    const problems = recordPageProblems(page);
    // Unique per run: the account persists in the smoke database copy, and a repeat
    // would fail as a duplicate username rather than as a real regression.
    const username = `verify-signup-${Date.now()}`;

    await visitAndAssertHealthy(page, "/login/register", problems);
    // The submit is a client handler over controlled inputs, so the bundle has to be
    // in place before filling — otherwise the form does a native GET and nothing is
    // created. See the same wait in auth.setup.ts.
    await page.waitForLoadState("networkidle");

    const usernameField = page.getByLabel("Username", { exact: true });
    await usernameField.fill(username);
    await page.getByLabel("Full name", { exact: true }).fill("Verify Signup");
    await page.getByLabel("Password", { exact: true }).fill("verify-signup-password");
    await page.getByLabel("Confirm password", { exact: true }).fill("verify-signup-password");
    await expect(usernameField).toHaveValue(username);

    await page.getByRole("button", { name: "Create account" }).click();

    // registerAction deliberately creates no session — it redirects back to the login
    // page with a confirmation flag.
    await page.waitForURL(/\/login\?registered=1/, { timeout: 60_000 });
    await expect(page.getByText("Account created")).toBeVisible();
    expect(problems.consoleErrors).toEqual([]);
  });
});
