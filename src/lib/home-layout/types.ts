import type { HomeWidgetId } from "@/lib/home-dashboard";

/**
 * How many columns the home screen draws its cards in, on the full layout only.
 *
 * A union of two numbers rather than a boolean because "how many columns" is the
 * question being answered, and a `useTwoColumns` flag would have to be renamed the
 * day a three-column option appears on a 4K monitor. Same reasoning as
 * `CompactNavStyle`.
 *
 * **Compact ignores this entirely.** Below the two-column breakpoint the home screen
 * is always a single stack — a phone has no room for a second column, so the stored
 * value is simply not consulted there rather than being clamped to 1. That keeps the
 * preference meaning "what I want on my monitor" rather than becoming a lie the
 * moment the same person opens the app on their phone.
 */
export type HomeColumnCount = 1 | 2;

/** What the home screen ships with for someone who has never touched the control. */
export const DEFAULT_HOME_COLUMNS: HomeColumnCount = 1;

/**
 * One reader's personal arrangement of the home screen.
 *
 * Deliberately **separate from the `home_widgets` app setting**, which stays
 * household-wide and admin-owned. That setting answers "which cards exist, and in
 * what default order" — one decision for the whole house, made in Administration >
 * Display Settings > Dashboard Widgets. This answers "how do *I* want them laid out
 * on *my* screen", which is a different question with a different owner, and the
 * catalogue's own doc comment already predicted it would want to be one.
 *
 * The consequence worth knowing: dragging a card never writes the admin setting, and
 * an admin reordering the household default never silently rearranges a reader who
 * has dragged their own. `applyPersonalOrder` is where the two meet.
 */
export interface HomeLayoutPreference {
  columns: HomeColumnCount;
  /**
   * The reader's own card order, or `[]` when they have never dragged anything.
   *
   * Empty is meaningful and is *not* the same as "every card in catalogue order":
   * it means "no opinion, follow the household order", so an admin's reordering is
   * still picked up by everyone who hasn't arranged their own. Once a drag happens
   * this holds the full list and the household order stops applying to that reader.
   *
   * May name a card that has since been hidden or retired, and may omit one that has
   * since been added — `applyPersonalOrder` reconciles both rather than this being
   * kept in sync on write. Same rule `resolveHomeWidgets` already established, for
   * the same reason: a stored layout must survive the app changing underneath it.
   */
  order: HomeWidgetId[];
  /**
   * The cards this reader has closed with the card's own `✕`, or `[]` when they
   * have closed none.
   *
   * **Subtractive only, and that is the whole rule.** This can hide a card the
   * household setting shows; it can never resurrect one an admin hid, nor one whose
   * data is absent today. `applyHiddenWidgets` runs over the list the page has
   * already decided to draw, so the admin's decision is upstream of this one and
   * stays that way — the same direction `applyPersonalOrder` respects for order.
   *
   * Separate from `order` rather than folded into it as a `-` prefix (the encoding
   * the household `home_widgets` setting uses). Two reasons: these are two
   * independent gestures that must write independently — closing a card must not
   * rewrite an arrangement, and a drag must not resurrect a closed card — and a
   * reader with no order at all (`[]`, "follow the household order") can still have
   * closed something, which a combined list could not express without inventing a
   * full order for them.
   *
   * May name a card that has since been retired or hidden by an admin;
   * `resolveHiddenHomeWidgets` drops what it no longer recognises and
   * `applyHiddenWidgets` ignores the rest, so a stored value survives the app
   * changing underneath it without a migration.
   */
  hidden: HomeWidgetId[];
}
