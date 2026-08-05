// The Stocks & ETFs module's section list and metadata.
//
// Deliberately NOT a "use client" module: server components (the section pages
// and the shell) read these values directly. Exporting them from the client nav
// module instead would hand the server client-reference proxies rather than the
// real objects, so a lookup like STOCK_SECTION_INFO[section] would come back
// undefined. Same reasoning as expense-sections.ts.

export const STOCK_SECTIONS = [
  "main",
  "positions",
  "transactions",
  "accounts",
  "actionables",
  "charts",
  "import",
  "settings",
] as const;

export type StockSection = (typeof STOCK_SECTIONS)[number];

export function isStockSection(value: string): value is StockSection {
  return (STOCK_SECTIONS as readonly string[]).includes(value);
}

/** Title and one-line description, used in the nav and as the page heading. */
export const STOCK_SECTION_INFO: Record<StockSection, { label: string; description: string }> = {
  main: {
    label: "Dashboard",
    description: "Portfolio value, today's move, total return and where the money sits.",
  },
  positions: {
    label: "Positions",
    description: "Every holding, with cost basis and gain — add, edit or refresh prices.",
  },
  transactions: {
    label: "Transactions",
    description: "The buy and sell history behind those positions.",
  },
  accounts: {
    label: "Account Performance",
    description: "Brokerage accounts and their value over time.",
  },
  actionables: {
    label: "Actionables",
    description: "Watch lists, and the next-day signals scanned from your holdings.",
  },
  charts: {
    label: "Chart & Analysis",
    description: "Volatility, correlation and Sharpe ratio across the portfolio.",
  },
  import: {
    label: "CSV Import",
    description: "Define a reusable mapping per broker export, then import with it.",
  },
  settings: {
    label: "Configuration",
    description: "Thresholds the next-day scan uses to decide what's worth flagging.",
  },
};

/** Section → nav icon key, resolved by TreeIcon. */
export const STOCK_SECTION_ICONS: Record<StockSection, string> = {
  main: "grid",
  positions: "list",
  transactions: "history",
  accounts: "database",
  actionables: "quote",
  charts: "chart",
  import: "upload",
  settings: "sliders",
};

const BASE_PATH = "/modules/stock-etfs";

/** The dashboard is the module root; every other section is a child route. */
export function stockSectionHref(section: StockSection): string {
  return section === "main" ? BASE_PATH : `${BASE_PATH}/${section}`;
}
