import { z } from "zod";
import { homeWidgetIdSchema, HOME_WIDGET_IDS } from "@/lib/home-dashboard";

/**
 * The column count as it arrives from the switch or a CLI arg.
 *
 * `z.coerce` because the web sends it through a form/action boundary where a number
 * can arrive as a string, and the CLI always hands over a string. One schema for both
 * adapters is the rule (ARCHITECTURE.md), so the coercion lives here rather than each
 * caller pre-parsing.
 *
 * `.catch` rather than a hard failure for the same reason `compactNavStyle` has one:
 * an unrecognised value from an older client should correct itself to the default, not
 * reject a save. There is no partial state to protect here, but the home screen does
 * have to render, and a thrown error on this path would be a blank page.
 */
export const homeColumnCountSchema = z.coerce
  .number()
  .int()
  .refine((value): value is 1 | 2 => value === 1 || value === 2)
  .catch(1);

/**
 * A reader's personal card order.
 *
 * Unlike `homeWidgetsSchema` — the admin setting, which insists every card appears
 * exactly once — this one accepts a **partial** list, and that difference is
 * deliberate. The admin form posts the whole catalogue because it renders the whole
 * catalogue; a drag posts what the reader can currently see, which excludes any card
 * an admin has hidden and any card whose data is absent today (no positions, so no
 * Stock Daily Glance). Demanding the full list here would mean a drag could only be
 * saved by a reader who happens to see every card.
 *
 * Duplicates are still rejected: a repeated id would draw a card twice, which is a
 * caller bug rather than an older client, and silently de-duplicating would hide it.
 * An empty array is valid and means "no opinion" — see `HomeLayoutPreference.order`.
 */
export const homeWidgetOrderSchema = z
  .array(homeWidgetIdSchema)
  .max(HOME_WIDGET_IDS.length)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "A widget is listed more than once.",
  })
  .catch([]);

/**
 * The cards a reader has closed.
 *
 * Structurally identical to `homeWidgetOrderSchema` — a partial list, no duplicates,
 * `.catch([])` — and written out rather than aliased because the two answer different
 * questions and will not necessarily stay the same: a cap of "every card" is a
 * coincidence here (you can close them all) where for the order it is a invariant.
 *
 * Duplicates are rejected for the same reason: a repeated id is a caller bug, and
 * de-duplicating silently would hide it. `hideHomeWidget` cannot produce one.
 */
export const homeWidgetHiddenSchema = z
  .array(homeWidgetIdSchema)
  .max(HOME_WIDGET_IDS.length)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "A widget is listed more than once.",
  })
  .catch([]);

/** The whole personal layout — the boundary for a save that sets all three. */
export const homeLayoutUpdateSchema = z.object({
  columns: homeColumnCountSchema,
  order: homeWidgetOrderSchema,
  hidden: homeWidgetHiddenSchema,
});

export type HomeLayoutUpdate = z.infer<typeof homeLayoutUpdateSchema>;

/**
 * One, two or all three parts of the layout — the boundary for `saveHomeLayout`.
 *
 * Spelled out rather than `homeLayoutUpdateSchema.partial()`, which does not work
 * here: `.partial()` wraps each field in `.optional()`, but every field carries a
 * `.catch`, and a caught schema swallows `undefined` and hands back its fallback
 * instead of staying absent. A drag that sent only an order would therefore arrive
 * carrying `columns: 1` and quietly knock a reader out of two-column mode — and,
 * now, `hidden: []`, silently reopening every card they had closed.
 *
 * `.optional()` **outside** the `.catch` is what keeps "field absent" distinct from
 * "field present but garbled" — absent stays `undefined` and is not written at all,
 * while a garbled value still corrects itself to the default.
 */
export const homeLayoutPartialUpdateSchema = z.object({
  columns: homeColumnCountSchema.optional(),
  order: homeWidgetOrderSchema.optional(),
  hidden: homeWidgetHiddenSchema.optional(),
});

export type HomeLayoutPartialUpdate = z.infer<typeof homeLayoutPartialUpdateSchema>;
