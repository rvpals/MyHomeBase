/**
 * TODO Lists' domain types.
 *
 * All plain data. Nothing here knows about a tab strip, a checkbox or a database —
 * which is what lets the whole feature be driven from a terminal and tested without a
 * browser.
 *
 * The one structural fact worth reading first: **both a list and an item are shared.**
 * Neither type carries an owner, and that is deliberately unlike the Scratchpad, where a
 * category is shared and a note is private. A TODO item is a household commitment that
 * has to be visible to — and tickable by — whoever is next out of the house. Migration
 * 0123 explains the call and what it costs.
 */

/**
 * One TODO list: the tabs in the widget, the rows in the screen's side panel.
 *
 * Household-wide, so there is deliberately no `userId` here.
 */
export interface TodoCategory {
  id: number;
  /** The list's label, e.g. "To BUY". Unique case-insensitively. */
  name: string;
  /**
   * Position in the panel and the tab strip.
   *
   * Exposed rather than hidden because both the screen and the admin reorder by it.
   * Ties fall back to insertion order — the repository sorts by `(sortOrder, id)`, so a
   * tie is stable rather than arbitrary.
   */
  sortOrder: number;
  /** ISO 8601, from the database. */
  createdAt: string;
}

/**
 * One thing to do, filed under one list.
 *
 * `notes` is optional in spirit but always a string here — blank rather than absent, the
 * same mapping the database uses, so no caller has to handle two kinds of nothing.
 */
export interface TodoItem {
  id: number;
  categoryId: number;
  /** What to do. Never blank — an item with no title is not an item. */
  title: string;
  /** The second line under a long item, or `""` when there isn't one. */
  notes: string;
  /** Whether it has been ticked off. Ticking does not delete — see `doneAt`. */
  isDone: boolean;
  /**
   * ISO 8601 when it was ticked, or `undefined` while it is outstanding.
   *
   * The one optional field in the module, and optional for a reason: "not completed"
   * genuinely has no timestamp, where a sentinel date would read as a real completion.
   * Cleared again when an item is un-ticked.
   */
  doneAt?: string;
  /** Position among the outstanding items. Ignored once `isDone` — see `TodoCategoryBoard`. */
  sortOrder: number;
  /**
   * Who added it, or `undefined` once that account is gone.
   *
   * Attribution for the household, never a permission check: every item is actionable
   * by everyone granted the module. Nothing filters on it.
   */
  createdBy?: number;
  /** ISO 8601, from the database. */
  createdAt: string;
}

/**
 * One list with its items already split into the two halves the screen draws.
 *
 * The split lives here rather than in the view because the two halves are **ordered
 * differently** — open items by the arrangement, completed by most recently ticked —
 * and that is a domain rule, not a rendering one. See `buildTodoBoard`.
 */
export interface TodoCategoryBoard {
  category: TodoCategory;
  /** Outstanding items, in the arranged order. */
  open: TodoItem[];
  /** Ticked items, most recently completed first. */
  completed: TodoItem[];
}

/**
 * Everything one screen or widget render needs, in one object.
 *
 * Every list is present even when it holds nothing — an empty list still draws its card,
 * its tab and its zero count, and hiding it would leave nowhere to add the first item.
 */
export interface TodoBoard {
  categories: TodoCategoryBoard[];
}

/**
 * Why a delete was refused.
 *
 * A result rather than a thrown error, because both refusals are ordinary mistakes the
 * screen has to render as a sentence: the list is gone already, or it still holds items.
 */
export type CategoryDeleteResult =
  | { ok: true }
  | { ok: false; message: string };
