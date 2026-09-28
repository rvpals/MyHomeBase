/**
 * Every card the home screen can draw, in its default top-to-bottom order.
 *
 * Two things the home screen renders are deliberately absent, because neither is a
 * card you arrange:
 *
 * - The **deployment message** is a one-shot notice that clears itself once
 *   acknowledged, so a permanent "hide" would be a setting for something that is
 *   already gone by the next visit.
 * - The **failed sign-in alert** is a security signal shown only to admins, and only
 *   while failures are unreviewed. Letting it be ticked away permanently would hide a
 *   warning rather than tidy a layout.
 *
 * A saved layout naming an id that is no longer here is dropped by `resolveHomeWidgets`,
 * and a widget missing from a saved layout is inserted at its catalogue position — so
 * adding or retiring a card needs no migration.
 *
 * **This list is app-wide, and that stays true even for a card whose contents are
 * personal.** `myShortcuts` draws a different set of tiles for every reader, but whether
 * the card exists at all is still one household decision an admin makes here — the same
 * line migration 0096 drew between the scratchpad's shared tabs and its private notes.
 * A per-user version of *this* list would be a different feature, and would leave the
 * Dashboard Widgets screen with nothing to administer.
 *
 * **`clock` was retired** from this catalogue when the Clock card was removed from the
 * home screen; the clock now lives in the floating layer instead (see
 * `FLOATING_COMPONENTS`). A stored `home_widgets` value still naming it is harmless for
 * exactly the reason above — `resolveHomeWidgets` drops the unknown id — which is why
 * that removal shipped without a migration.
 */
export const HOME_WIDGET_IDS = [
  "carousel",
  "myShortcuts",
  "dailyQuote",
  "todayInHistory",
  "stockGlance",
] as const;

export type HomeWidgetId = (typeof HOME_WIDGET_IDS)[number];

/** What a card is called and what it holds, for the Dashboard Widgets list. */
export interface HomeWidgetInfo {
  id: HomeWidgetId;
  label: string;
  description: string;
}

export const HOME_WIDGET_INFO: Record<HomeWidgetId, HomeWidgetInfo> = {
  carousel: {
    id: "carousel",
    label: "Module Carousel",
    description:
      "The scrolling strip of module cards with their artwork. Hiding it leaves the module rail as the way into a module, so the home screen stays navigable either way.",
  },
  myShortcuts: {
    id: "myShortcuts",
    label: "My Shortcuts",
    description:
      "Each person's own jump-off points — to a web address, or to any module or page in this app. The shortcuts themselves are private to whoever made them; this switch decides whether the card appears at all.",
  },
  dailyQuote: {
    id: "dailyQuote",
    label: "Daily Quote",
    description:
      "One quote drawn fresh from the collection on every landing, with a reroll for admins. Shown only when at least one quote has been added.",
  },
  todayInHistory: {
    id: "todayInHistory",
    label: "Today in History",
    description:
      "Journal entries written on this day in earlier years. Draws an empty state rather than nothing when there are none.",
  },
  stockGlance: {
    id: "stockGlance",
    label: "Stock Daily Glance",
    description:
      "Today's move across the portfolio, by type and by ticker. Shown only to someone who can open the Investments module, and only when there are positions to report.",
  },
};

/** One card's place on the home screen and whether it's drawn. */
export interface HomeWidgetPreference {
  id: HomeWidgetId;
  visible: boolean;
}
