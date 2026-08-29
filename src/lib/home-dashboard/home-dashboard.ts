import { homeWidgetsSchema } from "./schema";
import type { HomeWidgetsInput } from "./schema";
import { HOME_WIDGET_IDS } from "./types";
import type { HomeWidgetId, HomeWidgetPreference } from "./types";

/** The app-settings key the layout is stored under. */
export const HOME_WIDGETS_SETTING_KEY = "home_widgets";

/** Marks a hidden card in the stored value. */
const HIDDEN_PREFIX = "-";

const KNOWN_IDS = new Set<string>(HOME_WIDGET_IDS);

/** Everything visible, in the order the home screen ships with. */
export function defaultHomeWidgets(): HomeWidgetPreference[] {
  return HOME_WIDGET_IDS.map((id) => ({ id, visible: true }));
}

/**
 * Reads a stored home layout, falling back to the shipped default.
 *
 * Takes the raw string rather than a settings array, so the same function serves the
 * app-settings row today and a per-user row later without changing: deciding where the
 * value comes from is the caller's job, not this module's.
 *
 * Stored as one comma-separated ordered list, a `-` prefix meaning hidden:
 * `carousel,-dailyQuote,randomPhoto`. Two rules make it survive the app changing
 * underneath it:
 *
 * - An id that's no longer a card is **dropped** — a retired card shouldn't leave a
 *   hole, or worse, throw.
 * - A card missing from the stored value is **inserted at its catalogue position,
 *   visible** — so shipping a new card shows it to everyone instead of hiding it from
 *   every user who ever saved a layout.
 *
 * Anything unparseable falls back to the default rather than showing a blank page.
 */
export function resolveHomeWidgets(raw: string | undefined): HomeWidgetPreference[] {
  const trimmedRaw = raw?.trim();
  if (!trimmedRaw) return defaultHomeWidgets();

  const seen = new Set<HomeWidgetId>();
  const resolved: HomeWidgetPreference[] = [];

  for (const token of trimmedRaw.split(",")) {
    const trimmed = token.trim();
    if (trimmed === "") continue;

    const visible = !trimmed.startsWith(HIDDEN_PREFIX);
    const id = (visible ? trimmed : trimmed.slice(HIDDEN_PREFIX.length)) as HomeWidgetId;
    if (!KNOWN_IDS.has(id) || seen.has(id)) continue;

    seen.add(id);
    resolved.push({ id, visible });
  }

  if (resolved.length === 0) return defaultHomeWidgets();

  // Cards added to the app since this layout was saved, each inserted where the
  // catalogue puts it rather than appended.
  //
  // Appending is the trap `stock-dashboard` already fell into: a card shipped at the
  // *top* of the catalogue would appear at the *bottom* for every user with a saved
  // layout, which is the opposite of where it was placed. Anchoring to the nearest
  // already-known neighbour keeps a new card beside the cards it shipped beside, while
  // leaving every deliberate reorder untouched.
  HOME_WIDGET_IDS.forEach((id, catalogueIndex) => {
    if (seen.has(id)) return;

    // The first known card that follows this one in the catalogue; the new card goes
    // immediately before it, or at the end if nothing follows.
    const successor = HOME_WIDGET_IDS.slice(catalogueIndex + 1).find((candidate) =>
      seen.has(candidate),
    );
    const at = successor ? resolved.findIndex((preference) => preference.id === successor) : -1;

    if (at === -1) resolved.push({ id, visible: true });
    else resolved.splice(at, 0, { id, visible: true });

    seen.add(id);
  });

  return resolved;
}

/**
 * The inverse: a validated layout back to the string it's stored as. Keeps the encoding
 * in one place so the reader and the writer can't drift.
 */
export function homeWidgetsToValue(input: HomeWidgetsInput): string {
  return homeWidgetsSchema
    .parse(input)
    .map((preference) => (preference.visible ? preference.id : `${HIDDEN_PREFIX}${preference.id}`))
    .join(",");
}

/**
 * Moves one card up or down by a single place, returning a new list. A card already at
 * the end it's moving toward is returned unchanged rather than wrapping around —
 * wrapping would make a held-down button cycle forever.
 */
export function moveHomeWidget(
  preferences: HomeWidgetPreference[],
  id: HomeWidgetId,
  direction: "up" | "down",
): HomeWidgetPreference[] {
  const index = preferences.findIndex((preference) => preference.id === id);
  if (index === -1) return preferences;

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= preferences.length) return preferences;

  const next = [...preferences];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Flips one card's visibility, returning a new list. */
export function toggleHomeWidget(
  preferences: HomeWidgetPreference[],
  id: HomeWidgetId,
): HomeWidgetPreference[] {
  return preferences.map((preference) =>
    preference.id === id ? { ...preference, visible: !preference.visible } : preference,
  );
}

/** The ids to draw, in order — what the home screen actually iterates. */
export function visibleHomeWidgets(preferences: HomeWidgetPreference[]): HomeWidgetId[] {
  return preferences.filter((preference) => preference.visible).map((preference) => preference.id);
}

/**
 * Whether one card should be drawn.
 *
 * This is an **AND with the card's own condition**, never an override: ticking Stock
 * Daily Glance can't conjure positions that don't exist, and the home screen keeps its
 * existing guards. Visibility only ever takes a card away.
 */
export function isHomeWidgetVisible(
  preferences: HomeWidgetPreference[],
  id: HomeWidgetId,
): boolean {
  // An id absent from a resolved layout can't happen -- resolveHomeWidgets completes the
  // list -- but defaulting to visible is the safe read for a hand-built array.
  return preferences.find((preference) => preference.id === id)?.visible ?? true;
}
