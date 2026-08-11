import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getModuleBySlug } from "@/lib/modules";
import { userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { PAGE_CONTAINER } from "../../../page-container";
import { ExpenseSection } from "../expense-section";
import { isExpenseSection } from "../expense-sections";
import { StockSection } from "../stock-section";
import { isStockSection } from "../stock-sections";

const EXPENSE_MODULE_SLUG = "expense";
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
function renderSection(slug: string, section: string) {
  if (slug === EXPENSE_MODULE_SLUG && isExpenseSection(section)) {
    return <ExpenseSection section={section} />;
  }
  if (slug === STOCK_ETFS_MODULE_SLUG && isStockSection(section)) {
    return <StockSection section={section} />;
  }
  return undefined;
}

export default async function ModuleSectionPage({
  params,
}: {
  params: Promise<{ slug: string; section: string }>;
}) {
  const { slug, section } = await params;

  const appModule = getModuleBySlug(deps.moduleRepo, slug);
  if (!appModule) notFound();

  const body = renderSection(slug, section);
  if (!body) notFound();

  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // Same guard as the module page — a section must not be reachable by someone
  // who hasn't been granted the module.
  if (!currentUser || !userHasModuleAccess(currentUser, appModule.id, deps.userRepo)) notFound();

  return (
    <div className={PAGE_CONTAINER}>
      <h1 className="font-display text-3xl font-semibold text-ink">{appModule.longName}</h1>
      <div className="mt-3 h-px w-full bg-line" />
      <div className="mt-8">{body}</div>
    </div>
  );
}
