"use server";

import type { HomeLayoutPartialUpdate } from "@/lib/home-layout";
import { saveHomeLayout } from "@/lib/user-preferences";
import { deps } from "@/lib/wiring";
import { requireUser } from "./require-access";

/**
 * Records this reader's home screen arrangement — the column count, the card order,
 * or both.
 *
 * `requireUser()` on the first line. The home screen is whole-app chrome that no
 * module owns — the same category the navigation-tree and floating-layer actions fall
 * in — so a session is the whole rule. An action is its own POST endpoint, so neither
 * the `(protected)` layout nor the fact that the only callers are a switch and a drop
 * handler guards it.
 *
 * The session decides *whose* layout this is; the client never supplies a user id, so
 * this cannot be used to rearrange someone else's home screen.
 *
 * **A single-key write, not a read-modify-write.** Unlike `setExpandedModulesAction`,
 * which has to re-read the whole preference set because `saveUserPreferences` writes
 * every key, `saveHomeLayout` touches only the keys it is given — so a drop cannot
 * blank a weather location, and flipping the column switch cannot discard an order.
 *
 * Returns nothing and throws nothing the caller acts on: the cards have already moved
 * on screen by the time this fires, and a failed write costs a remembered arrangement,
 * not a navigation. Deliberately not `revalidatePath` — the layout is applied on the
 * client from state the page already holds, so revalidating would re-render every
 * route in the layout to change nothing the reader can see.
 */
export async function setHomeLayoutAction(input: HomeLayoutPartialUpdate): Promise<void> {
  const currentUser = await requireUser();

  // Validated in `homeLayoutPartialUpdateSchema`: an unknown widget id is dropped and
  // a garbled column count corrects itself, so a hand-rolled payload can neither store
  // an unbounded blob nor put the home screen into a column count it can't render.
  saveHomeLayout(deps.userPreferencesRepo, currentUser.id, input);
}
