// The Expense module's section list and metadata.
//
// Deliberately NOT a "use client" module: server components (the section pages
// and the shell) read these values directly. Exporting them from the client
// nav module instead would hand the server client-reference proxies rather than
// the real objects, so a lookup like EXPENSE_SECTION_INFO[section] would come
// back undefined.

export const EXPENSE_SECTIONS = [
  "main",
  "transactions",
  "meta-data",
  "charts",
  "import",
  "transaction-rules",
  "settings",
] as const;

export type ExpenseSection = (typeof EXPENSE_SECTIONS)[number];

export function isExpenseSection(value: string): value is ExpenseSection {
  return (EXPENSE_SECTIONS as readonly string[]).includes(value);
}

/** Title and one-line description, used in the nav and as the page heading. */
export const EXPENSE_SECTION_INFO: Record<ExpenseSection, { label: string; description: string }> = {
  main: {
    label: "Main (Dashboard)",
    description: "At-a-glance totals and what still needs your attention.",
  },
  transactions: {
    label: "Transactions",
    description: "Browse, search and edit every transaction, or add one by hand.",
  },
  "meta-data": {
    label: "Meta Data",
    description: "The credit cards and categories everything else refers to.",
  },
  charts: {
    label: "Charts and Analysis",
    description: "Where the money went, by category — and how this month compares to last.",
  },
  import: {
    label: "Import Transaction",
    description: "Bring in statement CSVs. The rules that tidy them up live in Transaction Rules.",
  },
  "transaction-rules": {
    label: "Transaction Rules",
    description: "The post-import rules that fill in vendor, category, status and notes.",
  },
  settings: {
    label: "Settings",
    description: "Automatic import folder and how often it runs.",
  },
};

/** Section → nav icon key, resolved by TreeIcon. */
export const EXPENSE_SECTION_ICONS: Record<ExpenseSection, string> = {
  main: "grid",
  transactions: "list",
  "meta-data": "database",
  charts: "chart",
  import: "upload",
  "transaction-rules": "clip",
  settings: "sliders",
};

const BASE_PATH = "/modules/expense";

/** The dashboard is the module root; every other section is a child route. */
export function expenseSectionHref(section: ExpenseSection): string {
  return section === "main" ? BASE_PATH : `${BASE_PATH}/${section}`;
}

/**
 * A link to the Transactions section with one group already open — what the Meta
 * Data cards use, so clicking a card, category or vendor lands on just its rows.
 *
 * The grouping and the group key travel in the URL rather than in client state so
 * the result is a real address: bookmarkable, shareable, and surviving a refresh
 * or the back button. Same reasoning as the Journal's ?filter=.
 *
 * `groupKey` comes from the matching helper in `@/lib/expense` (`accountGroupKey`
 * and friends) — don't hand-build the string here, or this and the grouping can
 * drift apart and every link quietly opens nothing.
 */
export function expenseGroupHref(groupBy: string, groupKey: string): string {
  const params = new URLSearchParams({ groupBy, group: groupKey });
  return `${expenseSectionHref("transactions")}?${params.toString()}`;
}
