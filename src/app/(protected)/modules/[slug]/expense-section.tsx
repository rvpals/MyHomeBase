// Composes one Expense section: the section nav, a heading with the section's
// description, and the section's own view. Data is loaded per section
// rather than all at once, so opening the dashboard doesn't read every
// transaction, rule and mapping.
//
// A server component, so it can talk to `deps` directly and hand plain data to
// the client views.

import { listNamedMappings } from "@/lib/csv-import";
import {
  countUnprocessed,
  listAccounts,
  listCategories,
  listRules,
  listTransactions,
  listVendors,
  mergeVendorsWithTotals,
  resolveExpenseSettings,
  totalsByCategory,
  vendorSpendTotals,
  vendorTotals,
} from "@/lib/expense";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { ExpenseAccountsView } from "./expense-accounts-view";
import { ExpenseChartsView } from "./expense-charts-view";
import { ExpenseDashboardView } from "./expense-dashboard-view";
import { ExpenseImportView } from "./expense-import-view";
import { ExpenseInstructions } from "./expense-instructions";
import { EXPENSE_SECTION_INFO, type ExpenseSection } from "./expense-sections";
import { ExpenseShell } from "./expense-shell";
import { ExpenseRulesView } from "./expense-rules-view";
import { ExpenseSettingsView } from "./expense-settings-view";
import { ExpenseTransactionsView } from "./expense-transactions-view";
import { CollapsibleCard } from "@/components/collapsible-card";

const EXPENSE_MODULE_SLUG = "expense";
const TOP_SPENDER_COUNT = 5;

function loadSettings() {
  const expenseModule = getModuleBySlug(deps.moduleRepo, EXPENSE_MODULE_SLUG);
  return resolveExpenseSettings(
    expenseModule ? listModuleSettingsFor(deps.moduleSettingsRepo, expenseModule.id) : [],
  );
}

function SectionBody({
  section,
  prefillRuleName,
  prefillRuleDescription,
  prefillRulePattern,
  requestedGroupBy,
  requestedGroupKey,
}: {
  section: ExpenseSection;
  prefillRuleName?: string;
  prefillRuleDescription?: string;
  prefillRulePattern?: string;
  requestedGroupBy?: string;
  requestedGroupKey?: string;
}) {
  switch (section) {
    case "main": {
      const transactions = listTransactions(deps.expenseRepo);
      return (
        <ExpenseDashboardView
          totalCents={transactions.reduce((sum, transaction) => sum + transaction.amountCents, 0)}
          transactionCount={transactions.length}
          unprocessedCount={countUnprocessed(deps.expenseRepo)}
          uncategorisedCount={transactions.filter((t) => t.categoryName === "").length}
          toReconcileCount={transactions.filter((t) => t.status === "new").length}
          // The rows are already in hand, so roll them up here rather than
          // re-reading the table through totalsByVendor — same pure core either way.
          //
          // `vendorSpendTotals`, not `vendorTotals`: this is a "biggest spenders"
          // list, and the plain rollup invents vendors from statement prose on
          // payment and redemption lines ("ONLINE PAYMENT THANK YOU" -> ONLINE).
          // Those net negative, so the sign filter drops them.
          topVendors={vendorSpendTotals(transactions).slice(0, TOP_SPENDER_COUNT)}
          topCategories={totalsByCategory(deps.expenseRepo).slice(0, TOP_SPENDER_COUNT)}
          categories={listCategories(deps.expenseRepo)}
          vendors={listVendors(deps.expenseRepo)}
        />
      );
    }

    case "transactions":
      return (
        <ExpenseTransactionsView
          transactions={listTransactions(deps.expenseRepo)}
          accounts={listAccounts(deps.expenseRepo)}
          categories={listCategories(deps.expenseRepo)}
          vendors={listVendors(deps.expenseRepo)}
          requestedGroupBy={requestedGroupBy}
          requestedGroupKey={requestedGroupKey}
        />
      );

    case "meta-data":
      return (
        <ExpenseAccountsView
          accounts={listAccounts(deps.expenseRepo)}
          categories={listCategories(deps.expenseRepo)}
          // Saved vendors merged with the ones derived from the transactions, so
          // a vendor that only exists on a statement can still be given an icon.
          vendors={mergeVendorsWithTotals(
            listVendors(deps.expenseRepo),
            vendorTotals(listTransactions(deps.expenseRepo)),
          )}
        />
      );

    case "charts": {
      // Read once and reused: the vendor rollup and the month-over-month cards
      // both walk the whole table, and this section previously read it twice.
      const transactions = listTransactions(deps.expenseRepo);
      return (
        <ExpenseChartsView
          totals={totalsByCategory(deps.expenseRepo)}
          // Rolled up from the rows in hand rather than through totalsByVendor,
          // so the vendor chart doesn't cost a second read of the table.
          vendorTotals={vendorTotals(transactions)}
          // The trend cards roll up per month client-side. Pure functions over
          // rows the section already holds, so this costs no extra read.
          transactions={transactions}
          categories={listCategories(deps.expenseRepo)}
          vendors={listVendors(deps.expenseRepo)}
        />
      );
    }

    // Importing still *applies* the rules — that happens in the library
    // (`importExpenseCsv` / `runCleanupBatch`), not here. Only the editing UI
    // moved out, to the transaction-rules section.
    case "import":
      return (
        <ExpenseImportView
          accounts={listAccounts(deps.expenseRepo)}
          namedMappings={listNamedMappings(deps.csvImportMappingRepo, "Expense")}
        />
      );

    case "transaction-rules":
      return (
        <ExpenseRulesView
          rules={listRules(deps.expenseRepo)}
          categories={listCategories(deps.expenseRepo)}
          vendors={listVendors(deps.expenseRepo)}
          unprocessedCount={countUnprocessed(deps.expenseRepo)}
          prefillName={prefillRuleName}
          prefillDescription={prefillRuleDescription}
          prefillPattern={prefillRulePattern}
        />
      );

    case "settings":
      return <ExpenseSettingsView settings={loadSettings()} />;

    default:
      return null;
  }
}

export async function ExpenseSection({
  section,
  prefillRuleName,
  prefillRuleDescription,
  prefillRulePattern,
  requestedGroupBy,
  requestedGroupKey,
}: {
  section: ExpenseSection;
  /**
   * From ?name= / ?description= / ?vendorDescription= — seeds a new rule so the
   * screen is linkable.
   */
  prefillRuleName?: string;
  prefillRuleDescription?: string;
  prefillRulePattern?: string;
  /**
   * From ?groupBy= / ?group= — opens the Transactions screen on one grouping
   * with one group expanded, which is how the Meta Data cards link through.
   */
  requestedGroupBy?: string;
  requestedGroupKey?: string;
}) {
  // Defensive: an unknown section would otherwise crash on info.label. The route
  // already validates, so this only catches a future caller getting it wrong.
  const info = EXPENSE_SECTION_INFO[section] ?? EXPENSE_SECTION_INFO.main;

  return (
    // The two-tier shell: a module rail, a section panel and a utility header,
    // all placed by `ExpenseShell`. See design.md, "Navigation: the two-tier
    // shell".
    //
    // `async` because the shell reads cookies for the session and the pinned
    // layout, which `next/headers` only exposes as a promise.
    <ExpenseShell>
      <h2 className="font-display text-2xl font-semibold text-ink">{info.label}</h2>
      <p className="mt-1 text-sm text-muted">{info.description}</p>
      <div className="mt-3 h-px w-full bg-line" />

      {/* Each section gets only the guidance that applies to it — the whole
          document above every screen was noise between the heading and the
          content. */}
      <div className="mt-6">
        <CollapsibleCard title="Instruction">
          <ExpenseInstructions section={section} />
        </CollapsibleCard>
      </div>

      <div className="mt-6">
        <SectionBody
          section={section}
          prefillRuleName={prefillRuleName}
          prefillRuleDescription={prefillRuleDescription}
          prefillRulePattern={prefillRulePattern}
          requestedGroupBy={requestedGroupBy}
          requestedGroupKey={requestedGroupKey}
        />
      </div>
    </ExpenseShell>
  );
}
