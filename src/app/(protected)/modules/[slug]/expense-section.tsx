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
  resolveExpenseSettings,
  totalsByCategory,
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
import { SectionLayout } from "./section-layout";
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

function SectionBody({ section }: { section: ExpenseSection }) {
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
          topVendors={vendorTotals(transactions).slice(0, TOP_SPENDER_COUNT)}
          topCategories={totalsByCategory(deps.expenseRepo).slice(0, TOP_SPENDER_COUNT)}
          categories={listCategories(deps.expenseRepo)}
        />
      );
    }

    case "transactions":
      return (
        <ExpenseTransactionsView
          transactions={listTransactions(deps.expenseRepo)}
          accounts={listAccounts(deps.expenseRepo)}
          categories={listCategories(deps.expenseRepo)}
        />
      );

    case "meta-data":
      return (
        <ExpenseAccountsView
          accounts={listAccounts(deps.expenseRepo)}
          categories={listCategories(deps.expenseRepo)}
        />
      );

    case "charts":
      return (
        <ExpenseChartsView
          totals={totalsByCategory(deps.expenseRepo)}
          categories={listCategories(deps.expenseRepo)}
        />
      );

    case "import":
      return (
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="font-display text-xl text-ink">Import a statement</h2>
            <div className="mt-3">
              <ExpenseImportView
                accounts={listAccounts(deps.expenseRepo)}
                namedMappings={listNamedMappings(deps.csvImportMappingRepo, "Expense")}
              />
            </div>
          </section>

          <section>
            <h2 className="font-display text-xl text-ink">Post Import Processing</h2>
            <div className="mt-3">
              <ExpenseRulesView
                rules={listRules(deps.expenseRepo)}
                categories={listCategories(deps.expenseRepo)}
                unprocessedCount={countUnprocessed(deps.expenseRepo)}
              />
            </div>
          </section>
        </div>
      );

    case "settings":
      return <ExpenseSettingsView settings={loadSettings()} />;

    default:
      return null;
  }
}

export function ExpenseSection({ section }: { section: ExpenseSection }) {
  // Defensive: an unknown section would otherwise crash on info.label. The route
  // already validates, so this only catches a future caller getting it wrong.
  const info = EXPENSE_SECTION_INFO[section] ?? EXPENSE_SECTION_INFO.main;

  return (
    // The nav/body split lives in SectionLayout: it's a bar in `full` and a
    // column in `rail`/`strip`, so which way this lays out is client state that
    // a server component can't hold.
    <SectionLayout nav="expense">
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
        <SectionBody section={section} />
      </div>
    </SectionLayout>
  );
}
