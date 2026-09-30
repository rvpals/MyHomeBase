import { HOME_WIDGET_IDS, type HomeWidgetId } from "@/lib/home-dashboard";
import { homeColumnCountSchema, homeWidgetOrderSchema } from "./schema";
import { DEFAULT_HOME_COLUMNS, type HomeColumnCount, type HomeLayoutPreference } from "./types";

const KNOWN_IDS = new Set<string>(HOME_WIDGET_IDS);

/** The layout for someone who has never touched the column switch or dragged a card. */
export function defaultHomeLayout(): HomeLayoutPreference {
  return { columns: DEFAULT_HOME_COLUMNS, order: [] };
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
