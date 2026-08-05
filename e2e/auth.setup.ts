import { test as setup, expect } from "@playwright/test";
import { SMOKE_TEST_PASSWORD, SMOKE_TEST_USERNAME } from "../scripts/verify-db";
import { AUTHENTICATED_STATE_PATH } from "../playwright.config";

/**
 * Signs in once and saves the session cookie for the smoke spec to reuse, so the
 * route sweep doesn't pay for a login per test.
 *
 * The account is created by `npm run verify:prepare-db` inside a throwaway copy of
 * the database — see scripts/prepare-smoke-db.ts.
 */
setup("sign in", async ({ page }) => {
  // networkidle, not the default load: the form's inputs are React-controlled and its
  // submit is a client handler, so anything typed or clicked before the client bundle
  // hydrates is discarded — and the form falls back to a native GET to /login?.
  await page.goto("/login", { waitUntil: "networkidle" });

  // The login inputs carry no name or id, so the wrapping <label> text is the only
  // stable handle. `exact` matters: a substring match for "Password" also hits
  // "Confirm password" on the sibling register form.
  const usernameField = page.getByLabel("Username", { exact: true });
  const passwordField = page.getByLabel("Password", { exact: true });

  await usernameField.fill(SMOKE_TEST_USERNAME);
  await passwordField.fill(SMOKE_TEST_PASSWORD);

  // Confirms hydration actually took: an unhydrated controlled input loses its value
  // the moment React mounts, so this failing means the bundle never took over.
  await expect(usernameField).toHaveValue(SMOKE_TEST_USERNAME);
  await expect(passwordField).toHaveValue(SMOKE_TEST_PASSWORD);

  await page.getByRole("button", { name: "Sign in" }).click();

  // A successful login redirects to the dashboard; a failed one stays put and shows
  // an inline error, so leaving /login is the signal.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
  await expect(page).toHaveURL(/\/$/);

  await page.context().storageState({ path: AUTHENTICATED_STATE_PATH });
});
