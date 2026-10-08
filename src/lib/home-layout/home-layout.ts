import { HOME_WIDGET_IDS, type HomeWidgetId } from "@/lib/home-dashboard";
import { homeColumnCountSchema, homeWidgetHiddenSchema, homeWidgetOrderSchema } from "./schema";
import { DEFAULT_HOME_COLUMNS, type HomeColumnCount, type HomeLayoutPreference } from "./types";

const KNOWN_IDS = new Set<string>(HOME_WIDGET_IDS);

/** The layout for someone who has never touched the column switch or dragged a card. */
export function defaultHomeLayout(): HomeLayoutPreference {
  return { columns: DEFAULT_HOME_COLUMNS, order: [], hidden: [] };
}

/**
 * Reads a stored column count, falling back to the shipped default.
 *
 * Takes the raw string rather than a preferences object for the same reason
 * `resolveHomeWidgets` does: deciding where the value came from is the caller's job.
 */
export function resolveHomeColumns(raw: string | undefined): HomeColumnCount {
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_HOME_COLUMNS;
  return homeColumnCountSchema.parse(trimmed) as HomeColumnCount;
}

/**
 * Reads a stored personal order, dropping anything that is no longer a card.
 *
 * Unparseable or empty resolves to `[]` — "no opinion, follow the household order" —
 * rather than to the catalogue, because those two mean different things downstream
 * (see `HomeLayoutPreference.order`).
 */
export function resolveHomeWidgetOrder(raw: string | undefined): HomeWidgetId[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];

  const seen = new Set<HomeWidgetId>();
  const resolved: HomeWidgetId[] = [];

  for (const token of trimmed.split(",")) {
    // Narrowed by `KNOWN_IDS`, not by a cast up front: asserting `HomeWidgetId` on the
    // raw token would be claiming the very thing this loop exists to check, and it
    // also hides the empty-token case from the compiler.
    const candidate = token.trim();
    // A retired card leaves no hole and throws nothing, matching `resolveHomeWidgets`.
    if (!KNOWN_IDS.has(candidate)) continue;

    const id = candidate as HomeWidgetId;
    if (seen.has(id)) continue;
    seen.add(id);
    resolved.push(id);
  }

  return resolved;
}

/** The inverse, kept beside the reader so the two encodings can't drift. */
export function homeWidgetOrderToValue(order: HomeWidgetId[]): string {
  return homeWidgetOrderSchema.parse(order).join(",");
}

/**
 * Reads the cards this reader has closed, dropping anything that is no longer a card.
 *
 * Shares `resolveHomeWidgetOrder`'s encoding — a comma-separated list of ids — but is
 * a *set*, not a sequence: the stored order carries no meaning and nothing downstream
 * reads it. Blank resolves to `[]`, "nothing closed", which is also what `Reset
 * layout` writes.
 *
 * Unlike the household `home_widgets` setting there is no `-` prefix here. That value
 * lists every card with a visibility flag each; this one lists only the exceptions, so
 * presence *is* the flag.
 */
export function resolveHiddenHomeWidgets(raw: string | undefined): HomeWidgetId[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];

  const seen = new Set<HomeWidgetId>();
  const resolved: HomeWidgetId[] = [];

  for (const token of trimmed.split(",")) {
    // Narrowed by `KNOWN_IDS` before the cast, exactly as the order reader does, so a
    // retired card leaves no hole and an unknown id throws nothing.
    const candidate = token.trim();
    if (!KNOWN_IDS.has(candidate)) continue;

    const id = candidate as HomeWidgetId;
    if (seen.has(id)) continue;
    seen.add(id);
    resolved.push(id);
  }

  return resolved;
}

/** The inverse, kept beside the reader so the two encodings can't drift. */
export function hiddenHomeWidgetsToValue(hidden: HomeWidgetId[]): string {
  return homeWidgetHiddenSchema.parse(hidden).join(",");
}

/**
 * Adds a card to the closed set, returning a new list.
 *
 * Idempotent: closing a card that is already closed returns the list unchanged rather
 * than storing it twice, because the `✕` of a card drawn from a stale page is an
 * ordinary gesture and not an error. Same refusal to throw that `reorderHomeWidgets`
 * makes for a drop onto oneself.
 */
export function hideHomeWidget(hidden: HomeWidgetId[], id: HomeWidgetId): HomeWidgetId[] {
  if (hidden.includes(id)) return hidden;
  return [...hidden, id];
}

/**
 * The cards left after this reader's closed ones are taken out.
 *
 * Runs over `visible` — what the page has already decided to draw, being the admin's
 * list AND-ed with each card's own condition — so this can only ever **remove**. A
 * closed id naming a card that isn't drawn today is simply inert, which is what keeps
 * a stored value valid across an admin hiding a card or a card being retired.
 *
 * Deliberately a separate pass from `applyPersonalOrder` rather than folded into it:
 * that function answers "in what order", this one answers "which at all", and the home
 * screen needs to filter *before* it orders so a closed card cannot occupy a position.
 */
export function applyHiddenWidgets(
  visible: HomeWidgetId[],
  hidden: HomeWidgetId[],
): HomeWidgetId[] {
  if (hidden.length === 0) return visible;

  const hiddenSet = new Set(hidden);
  return visible.filter((id) => !hiddenSet.has(id));
}

/**
 * The reader's personal order applied to the cards the home screen is actually
 * drawing today.
 *
 * `visible` is what the page already decided to render — the admin's visible list,
 * AND-ed with each card's own condition (no positions, no Stock Daily Glance). This
 * function only ever **reorders** that list: it can't add a card an admin hid, and it
 * can't remove one they showed. Visibility is not this preference's business.
 *
 * Three cases, all of which have to work without a migration:
 *
 * - **No personal order** (`[]`) — the household order is returned untouched, so an
 *   admin's arrangement still reaches everyone who hasn't made their own.
 * - **A card in the personal order that isn't visible today** — skipped. A reader who
 *   drags with positions in hand shouldn't get a hole on a day the market card has
 *   nothing to say, and an admin hiding a card must not resurrect it.
 * - **A visible card the personal order doesn't name** — appended. This is the case a
 *   newly-shipped card lands in, and appending is right *here* even though
 *   `resolveHomeWidgets` deliberately anchors to a catalogue neighbour instead: that
 *   function is reconciling against the catalogue, which has an authoritative position
 *   to anchor to. This one is reconciling against a hand-made arrangement, where the
 *   catalogue's opinion about position was already overridden — inserting a new card
 *   into the middle of someone's deliberate layout is more surprising than putting it
 *   at the end where they will see it and can drag it.
 */
export function applyPersonalOrder(
  visible: HomeWidgetId[],
  order: HomeWidgetId[],
): HomeWidgetId[] {
  if (order.length === 0) return visible;

  const visibleSet = new Set(visible);
  const ordered = order.filter((id) => visibleSet.has(id));

  const placed = new Set(ordered);
  const appended = visible.filter((id) => !placed.has(id));

  return [...ordered, ...appended];
}

/**
 * Moves one card to another's position, returning a new list.
 *
 * This is the drop, expressed as data: the card being dragged lands *at the index the
 * target currently occupies*, and everything between shuffles up or down. Taking a
 * target id rather than a numeric index is what lets the caller stay a dumb event
 * handler — the view knows which card the pointer is over, not what position that is.
 *
 * Returns the list unchanged when either id is absent or they are the same, rather
 * than throwing: a drop onto oneself is an ordinary gesture, not an error.
 */
export function reorderHomeWidgets(
  order: HomeWidgetId[],
  draggedId: HomeWidgetId,
  targetId: HomeWidgetId,
): HomeWidgetId[] {
  if (draggedId === targetId) return order;

  const from = order.indexOf(draggedId);
  const to = order.indexOf(targetId);
  if (from === -1 || to === -1) return order;

  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, draggedId);
  return next;
}

/**
 * A visible-only arrangement with the reader's closed cards folded back into it.
 *
 * The problem this solves: once a card is closed it is not on screen, so it cannot be
 * part of a drag — and an order written from what is on screen would drop it. The next
 * time it is reopened `applyPersonalOrder` would append it at the end, so a card the
 * reader had deliberately dragged to the top would come back at the bottom having
 * never moved. The closed cards' positions have to survive a drag they took no part in.
 *
 * Each closed id is reinserted directly after the nearest **still-present** card that
 * preceded it in `stored`, or at the front when nothing did. Walking `stored` forwards
 * means an earlier closed card is already back in `next` by the time a later one looks
 * for its predecessor, so a run of adjacent closed cards keeps its internal order.
 *
 * Returns `visibleOrder` untouched when there is nothing to fold in — no closed cards,
 * or no stored order to take positions from (a reader who has never dragged has no
 * positions to preserve, so the visible order stands on its own).
 */
export function orderWithHiddenPreserved(
  visibleOrder: HomeWidgetId[],
  stored: HomeWidgetId[],
  hidden: HomeWidgetId[],
): HomeWidgetId[] {
  if (hidden.length === 0 || stored.length === 0) return visibleOrder;

  const hiddenSet = new Set(hidden);
  const next = [...visibleOrder];

  stored.forEach((id, storedIndex) => {
    if (!hiddenSet.has(id) || next.includes(id)) return;

    const predecessor = stored
      .slice(0, storedIndex)
      .reverse()
      .find((candidate) => next.includes(candidate));

    const at = predecessor === undefined ? -1 : next.indexOf(predecessor);
    next.splice(at + 1, 0, id);
  });

  return next;
}

/**
 * Moves one card a single place, for the keyboard path.
 *
 * The drag is mouse-only — the HTML5 drag events this ships on don't fire for a
 * keyboard, and the column switch it lives under only renders on the full layout — so
 * this is what makes the arrangement reachable without a pointer. Mirrors
 * `moveHomeWidget` in the admin catalogue deliberately: same two directions, same
 * refusal to wrap at the ends (a held-down button would cycle forever).
 */
export function moveHomeWidgetInOrder(
  order: HomeWidgetId[],
  id: HomeWidgetId,
  direction: "up" | "down",
): HomeWidgetId[] {
  const index = order.indexOf(id);
  if (index === -1) return order;

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= order.length) return order;

  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
