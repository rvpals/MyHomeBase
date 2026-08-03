import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getModuleBySlug, getModuleCode } from "@/lib/modules";
import { userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { ExpenseSection } from "../expense-section";
import { EXPENSE_PAGE_CONTAINER, isExpenseSection } from "../expense-sections";

const EXPENSE_MODULE_SLUG = "expense";

/**
 * A module's sub-section, e.g. /modules/expense/transactions.
 *
 * Nested under the dynamic [slug] segment on purpose: a static `expense` folder
 * would shadow /modules/[slug] and break the module page itself. Only the
 * Expense module has sections today, so anything else 404s.
 */
export default async function ModuleSectionPage({
  params,
}: {
  params: Promise<{ slug: string; section: string }>;
}) {
  const { slug, section } = await params;
  if (slug !== EXPENSE_MODULE_SLUG || !isExpenseSection(section)) notFound();

  const appModule = getModuleBySlug(deps.moduleRepo, slug);
  if (!appModule) notFound();

  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // Same guard as the module page — a section must not be reachable by someone
  // who hasn't been granted the module.
  if (!currentUser || !userHasModuleAccess(currentUser, appModule.id, deps.userRepo)) notFound();

  return (
    <div className={EXPENSE_PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        {getModuleCode(appModule.slug)}
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">{appModule.longName}</h1>
      <div className="mt-3 h-px w-full bg-line" />
      <div className="mt-8">
        <ExpenseSection section={section} />
      </div>
    </div>
  );
}
