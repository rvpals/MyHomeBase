import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getModuleBySlug } from "@/lib/modules";
import { isAdmin, userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { PAGE_CONTAINER } from "../../../page-container";
import { ExpenseSection } from "../expense-section";
import { isExpenseSection } from "../expense-sections";
import { isJournalSection } from "../journal-sections";
import { JournalSection } from "../journal-section";
import { StockSection } from "../stock-section";
import { isStockSection } from "../stock-sections";

const EXPENSE_MODULE_SLUG = "expense";
const JOURNAL_MODULE_SLUG = "journal";
const STOCK_ETFS_MODULE_SLUG = "stock-etfs";

/**
 * A module's sub-section, e.g. /modules/expense/transactions or
 * /modules/stock-etfs/positions.
 *
 * Nested under the dynamic [slug] segment on purpose: a static `expense` folder
 * would shadow /modules/[slug] and break the module page itself. Only the modules
 * listed here have sections; anything else 404s.
 *
 * Each module validates its own section names, so an Expense section name can't be
 * reached under the Stocks slug (or vice versa) — that would render a nav pointing
 * at routes the other module doesn't have.
 */
function renderSection(
  slug: string,
  section: string,
  isAdmin: boolean,
  filterQuery: string | undefined,
) {
  if (slug === EXPENSE_MODULE_SLUG && isExpenseSection(section)) {
    return <ExpenseSection section={section} />;
  }
  if (slug === JOURNAL_MODULE_SLUG && isJournalSection(section)) {
    return <JournalSection section={section} isAdmin={isAdmin} filterQuery={filterQuery} />;
  }
  if (slug === STOCK_ETFS_MODULE_SLUG && isStockSection(section)) {
    return <StockSection section={section} />;
  }
  return undefined;
}

export default async function ModuleSectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; section: string }>;
  // `filter` carries a journal filter query, so a filtered entry list is a real
  // URL — linkable, shareable, and surviving a refresh or a back button. That's
  // why the Top Tags/Categories cards link here rather than pushing client state.
  searchParams: Promise<{ filter?: string | string[] }>;
}) {
  const { slug, section } = await params;
  const { filter } = await searchParams;
  // A repeated ?filter= yields an array; take the first rather than joining, so a
  // crafted URL can't smuggle a second expression in.
  const filterQuery = Array.isArray(filter) ? filter[0] : filter;

  const appModule = getModuleBySlug(deps.moduleRepo, slug);
  if (!appModule) notFound();

  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // Same guard as the module page — a section must not be reachable by someone
  // who hasn't been granted the module.
  if (!currentUser || !userHasModuleAccess(currentUser, appModule.id, deps.userRepo)) notFound();

  const body = renderSection(slug, section, isAdmin(currentUser), filterQuery);
  if (!body) notFound();

  return <div className={PAGE_CONTAINER}>{body}</div>;
}
