// "My rule matches but nothing happened" — this explains exactly what the
// post-import clean-up would do to a transaction, and why.
//
// A read-only adapter: it calls the same `listRules` / `planRuleApplication` the
// real run uses, so its verdict is the run's verdict. Nothing is written.
//
//   npm run cli explain-rule -- --id 4231
//   npm run cli explain-rule -- --description AMAZON
import {
  RULE_ACTION_FIELD_LABELS,
  compilePattern,
  listRules,
  listTransactions,
  matchesPattern,
  planRuleApplication,
  type ExpenseTransaction,
  type RuleActionField,
} from "@/lib/expense";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

const MAX_ROWS = 10;

/** What the row currently holds for a field a rule might want to set. */
function currentValue(transaction: ExpenseTransaction, fieldName: RuleActionField): string {
  switch (fieldName) {
    case "categoryName":
      return transaction.categoryName;
    case "vendor":
      return transaction.vendor;
    case "note":
      return transaction.note;
    case "status":
      return transaction.status;
  }
}

function explain(transaction: ExpenseTransaction, rules: ReturnType<typeof listRules>): void {
  // JSON-quoted so stray leading whitespace or odd characters are visible — a
  // pattern containing "*" is anchored, so a leading space breaks the match.
  console.log(`\n#${transaction.id}  ${transaction.transactionDate}`);
  console.log(`  description : ${JSON.stringify(transaction.transactionDescription)}`);
  console.log(
    `  now         : category=${JSON.stringify(transaction.categoryName)} ` +
      `vendor=${JSON.stringify(transaction.vendor)} status=${transaction.status} ` +
      `note=${JSON.stringify(transaction.note)}`,
  );
  console.log(`  processed   : ${transaction.processed}`);

  if (transaction.processed) {
    console.log(
      "  !! The clean-up only reads rows with processed = 0, so this row is skipped\n" +
        "     entirely. Use \"Re-queue all\" first, then run the clean-up.",
    );
  }

  console.log("  rules, in evaluation order (priority asc, then id):");
  for (const rule of rules) {
    const hits = matchesPattern(transaction.transactionDescription, rule.pattern);
    const mark = !rule.isEnabled ? "disabled" : hits ? "MATCHES " : "no      ";
    // The name says why the rule exists, the pattern says what it matches — this
    // is a diagnostic, so print both rather than choosing.
    const name = rule.name.trim() === "" ? "" : `${JSON.stringify(rule.name)} `;
    console.log(
      `    [${mark}] #${rule.id} prio=${rule.priority} ${name}` +
        `${JSON.stringify(rule.pattern)} -> ${compilePattern(rule.pattern)}`,
    );
  }

  const plan = planRuleApplication(transaction, rules);
  if (!plan) {
    console.log("  verdict     : no enabled rule matches — nothing would change.");
    return;
  }

  const winnerName = plan.rule.name.trim() === "" ? "" : `${JSON.stringify(plan.rule.name)} `;
  console.log(
    `  winner      : #${plan.rule.id} ${winnerName}${JSON.stringify(plan.rule.pattern)} ` +
      "(only the FIRST matching rule is applied — rules do not stack)",
  );
  if (plan.rule.description.trim() !== "") {
    console.log(`  description : ${plan.rule.description}`);
  }

  const assigned = new Set(plan.assignments.map((assignment) => assignment.fieldName));
  for (const action of [...plan.rule.actions].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const label = RULE_ACTION_FIELD_LABELS[action.fieldName];
    if (assigned.has(action.fieldName)) {
      console.log(`    + ${label} := ${JSON.stringify(action.fieldValue)}`);
    } else {
      console.log(
        `    - ${label} skipped — rules only fill blank fields, and this row already ` +
          `holds ${JSON.stringify(currentValue(transaction, action.fieldName))}`,
      );
    }
  }

  if (plan.assignments.length === 0) {
    console.log(
      "  verdict     : the rule matches but would change nothing (every field it sets\n" +
        "                is already filled in). The row is still marked processed.",
    );
  }
}

export function explainRuleCommand(args: string[]): void {
  const flags = parseFlags(args);
  const rules = listRules(deps.expenseRepo);

  if (rules.length === 0) {
    console.log("There are no post-import rules in this database.");
    return;
  }

  const all = listTransactions(deps.expenseRepo);
  let rows: ExpenseTransaction[];

  if (flags.id !== undefined) {
    const id = Number(flags.id);
    rows = all.filter((transaction) => transaction.id === id);
    if (rows.length === 0) {
      console.error(`No transaction with id ${flags.id}.`);
      process.exitCode = 1;
      return;
    }
  } else if (flags.description) {
    const needle = flags.description.toUpperCase();
    rows = all
      .filter((transaction) => transaction.transactionDescription.toUpperCase().includes(needle))
      .slice(0, MAX_ROWS);
    if (rows.length === 0) {
      console.error(`No transaction description contains ${JSON.stringify(flags.description)}.`);
      process.exitCode = 1;
      return;
    }
  } else {
    console.error("Give either --id <transactionId> or --description <text>.");
    process.exitCode = 1;
    return;
  }

  for (const transaction of rows) explain(transaction, rules);
}
