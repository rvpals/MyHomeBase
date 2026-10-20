import { z } from "zod";
import type { UserPreferencesRepository } from "@/lib/user-preferences";

// The cards on the Journal home screen, and which of them each reader has switched on.
//
// Modelled on `lib/home-dashboard` (the app's home screen) — same stored encoding, same
// tolerance for a catalogue that changes underneath a saved layout — but **per reader**:
// the Journal is personal, so this is one `user_preferences` row, not an app setting.
// No migration: that table is key/value and ignores keys it has never heard of.

/** The `user_preferences` key a reader's Journal home layout is stored under. */
export const JOURNAL_HOME_WIDGETS_KEY = "journal_home_widgets";

/**
 * Every card the Journal home screen can draw, in the order it ships with.
 *
 * **Ids are permanent once shipped** — they are persisted in each reader's stored
 * layout, so renaming one silently drops that card's saved position and visibility.
 * Add a new card at the position it should appear; `resolveJournalHomeWidgets`
 * anchors it there for readers who already saved a layout.
 */
export const JOURNAL_HOME_WIDGET_IDS = [
  "counters",
  // Tags and categories share one card. `topTags` and `topCategories` were two
  // separate cards and are **retired ids** — a stored layout still naming either is
  // dropped by `resolveJournalHomeWidgets`, and `topTaxonomy` is then inserted at this
  // position, visible. That is why combining them needed no migration. Do not reuse
  // either old id for something else.
  "topTaxonomy",
  "topWords",
  "countByYears",
  // Pinned entries and recently-edited entries share one card, as two tabs.
  // `pinnedEntries` is a **retired id** — a stored layout still naming it is dropped by
  // `resolveJournalHomeWidgets`, and `pinnedAndRecentlyEdited` is then inserted at this
  // position, visible. That is why combining them needed no migration, and it is the
  // same arrangement `topTaxonomy` uses. Do not reuse the old id for something else.
  //
  // Known consequence, the same one the topTaxonomy merge has: a reader who had
  // *hidden* Pinned Entries gets the combined card back visible. Hiding a retired id
  // cannot carry forward, because the id it was hiding no longer exists.
  "pinnedAndRecentlyEdited",
  "recentEntries",
] as const;

export type JournalHomeWidgetId = (typeof JOURNAL_HOME_WIDGET_IDS)[number];

export interface JournalHomeWidgetPreference {
  id: JournalHomeWidgetId;
  visible: boolean;
}

export const JOURNAL_HOME_WIDGET_INFO: Record<
  JournalHomeWidgetId,
  { label: string; description: string }
> = {
  counters: {
    label: "Entry counters",
    description: "Total, locked, log and recycled entry counts.",
  },
  topTaxonomy: {
    label: "Top Tags & Categories",
    description:
      "The tags and the categories you use most, side by side, each linking to its entries.",
  },
  topWords: {
    label: "Top 10 Words",
    description: "The words you write most often across every entry.",
  },
  countByYears: {
    label: "Count by Years",
    description: "How many entries you wrote in each year and month.",
  },
  pinnedAndRecentlyEdited: {
    label: "Pinned & Recently Edited",
    description:
      "Two tabs in one card: the entries you pinned, and the ones you edited most recently.",
  },
  recentEntries: {
    label: "Recent entries",
    description: "The latest entries, newest first.",
  },
};

const HIDDEN_PREFIX = "-";
const KNOWN_IDS = new Set<string>(JOURNAL_HOME_WIDGET_IDS);

export const journalHomeWidgetsSchema = z
  .array(z.object({ id: z.enum(JOURNAL_HOME_WIDGET_IDS), visible: z.boolean() }))
  .length(JOURNAL_HOME_WIDGET_IDS.length, "Every widget must be listed exactly once.")
  .refine((widgets) => new Set(widgets.map((widget) => widget.id)).size === widgets.length, {
    message: "A widget is listed more than once.",
  });

/** Everything visible, in the order the home screen ships with. */
export function defaultJournalHomeWidgets(): JournalHomeWidgetPreference[] {
  return JOURNAL_HOME_WIDGET_IDS.map((id) => ({ id, visible: true }));
}

/**
 * Reads a stored layout, falling back to the shipped default.
 *
 * Stored as one comma-separated ordered list with a `-` prefix meaning hidden:
 * `counters,-topWords,recentEntries`. A retired id is dropped; a card missing from the
 * stored value is inserted at its catalogue position, visible — so shipping a card shows
 * it to every reader instead of hiding it from everyone who ever saved a layout.
 */
export function resolveJournalHomeWidgets(raw: string | undefined): JournalHomeWidgetPreference[] {
  const trimmedRaw = raw?.trim();
  if (!trimmedRaw) return defaultJournalHomeWidgets();

  const seen = new Set<JournalHomeWidgetId>();
  const resolved: JournalHomeWidgetPreference[] = [];

  for (const token of trimmedRaw.split(",")) {
    const trimmed = token.trim();
    if (trimmed === "") continue;

    const visible = !trimmed.startsWith(HIDDEN_PREFIX);
    const id = (visible ? trimmed : trimmed.slice(HIDDEN_PREFIX.length)) as JournalHomeWidgetId;
    if (!KNOWN_IDS.has(id) || seen.has(id)) continue;

    seen.add(id);
    resolved.push({ id, visible });
  }

  if (resolved.length === 0) return defaultJournalHomeWidgets();

  JOURNAL_HOME_WIDGET_IDS.forEach((id, catalogueIndex) => {
    if (seen.has(id)) return;

    // Immediately before the first already-placed card that follows it in the
    // catalogue, or at the end if none does — never blindly appended.
    const successor = JOURNAL_HOME_WIDGET_IDS.slice(catalogueIndex + 1).find((candidate) =>
      seen.has(candidate),
    );
    const at = successor ? resolved.findIndex((widget) => widget.id === successor) : -1;

    if (at === -1) resolved.push({ id, visible: true });
    else resolved.splice(at, 0, { id, visible: true });

    seen.add(id);
  });

  return resolved;
}

/** The inverse of `resolveJournalHomeWidgets`, validated. */
export function journalHomeWidgetsToValue(input: JournalHomeWidgetPreference[]): string {
  return journalHomeWidgetsSchema
    .parse(input)
    .map((widget) => (widget.visible ? widget.id : `${HIDDEN_PREFIX}${widget.id}`))
    .join(",");
}

/** Moves one card a single place, returning a new list; at either end it is unchanged. */
export function moveJournalHomeWidget(
  widgets: JournalHomeWidgetPreference[],
  id: JournalHomeWidgetId,
  direction: "up" | "down",
): JournalHomeWidgetPreference[] {
  const index = widgets.findIndex((widget) => widget.id === id);
  if (index === -1) return widgets;

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= widgets.length) return widgets;

  const next = [...widgets];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Moves one card to the position another currently occupies, returning a new list —
 * a drop, expressed as data. Unchanged for the same card or an unknown id.
 */
export function reorderJournalHomeWidget(
  widgets: JournalHomeWidgetPreference[],
  id: JournalHomeWidgetId,
  targetId: JournalHomeWidgetId,
): JournalHomeWidgetPreference[] {
  if (id === targetId) return widgets;

  const from = widgets.findIndex((widget) => widget.id === id);
  const to = widgets.findIndex((widget) => widget.id === targetId);
  if (from === -1 || to === -1) return widgets;

  const next = [...widgets];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Flips one card's visibility, returning a new list. */
export function toggleJournalHomeWidget(
  widgets: JournalHomeWidgetPreference[],
  id: JournalHomeWidgetId,
): JournalHomeWidgetPreference[] {
  return widgets.map((widget) =>
    widget.id === id ? { ...widget, visible: !widget.visible } : widget,
  );
}

/** The ids to draw, in order — what the home screen iterates. */
export function visibleJournalHomeWidgets(
  widgets: JournalHomeWidgetPreference[],
): JournalHomeWidgetId[] {
  return widgets.filter((widget) => widget.visible).map((widget) => widget.id);
}

/** One reader's layout, resolved. */
export function getJournalHomeWidgets(
  repo: UserPreferencesRepository,
  userId: number,
): JournalHomeWidgetPreference[] {
  const row = repo.listByUserId(userId).find((preference) => preference.key === JOURNAL_HOME_WIDGETS_KEY);
  return resolveJournalHomeWidgets(row?.value);
}

/** Validates and stores one reader's layout. Throws on a partial or duplicated list. */
export function saveJournalHomeWidgets(
  repo: UserPreferencesRepository,
  userId: number,
  input: JournalHomeWidgetPreference[],
): void {
  repo.setValue(userId, JOURNAL_HOME_WIDGETS_KEY, journalHomeWidgetsToValue(input));
}
