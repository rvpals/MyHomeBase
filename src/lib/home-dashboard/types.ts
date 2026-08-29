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
 */
export const HOME_WIDGET_IDS = [
  "carousel",
  "dailyQuote",
  "todayInHistory",
  "randomPhoto",
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
  randomPhoto: {
    id: "randomPhoto",
    label: "Random Photo",
    description:
      "One photograph drawn from anywhere in the journal archive. Hiding it also skips the directory listings over the photo share, so an unreachable NAS costs the home screen nothing.",
  },
  stockGlance: {
    id: "stockGlance",
    label: "Stock Daily Glance",
    description:
      "Today's move across the portfolio, by type and by ticker. Shown only to someone who can open the Stocks & ETFs module, and only when there are positions to report.",
  },
};

/** One card's place on the home screen and whether it's drawn. */
export interface HomeWidgetPreference {
  id: HomeWidgetId;
  visible: boolean;
}
