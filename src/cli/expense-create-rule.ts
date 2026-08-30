// Creates one post-import transaction rule from the terminal — the CLI half of
// the Transaction Rules screen, so a rule can be scripted rather than typed.
//
// `--name` and `--description` are the rule's own two fields. A rule also needs
// a pattern and at least one field to set, or it is inert: a blank pattern never
// matches (`matchesPattern`) and `savePostImportRuleSchema` requires one action.
//
//   npm run cli -- expense-create-rule --name "TGI Friday's" \
//     --description "The card prints this restaurant three different ways" \
//     --pattern "%TGI%" --set vendor="TGI Friday" --set categoryName=Restaurant
//
//   npm run cli -- expense-create-rule --name Amazon --pattern "AMAZON%" \
//     --set categoryName=online-purchase --priority 10 --disabled
import {
  RULE_ACTION_FIELDS,
  createRule,
  type RuleActionField,
  type SavePostImportRuleInput,
} from "@/lib/expense";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";

const USAGE = `Usage:
  npm run cli -- expense-create-rule --name <name> --pattern <glob> --set <field>=<value> [...]

Required:
  --name <text>          What to call this rule, e.g. "TGI Friday's".
  --pattern <glob>       Matched against the statement description, e.g. "%TGI%".
                         "%" is the wildcard; "*" is a literal asterisk.
  --set <field>=<value>  A field this rule sets. Repeatable. One is required.
                         Fields: ${RULE_ACTION_FIELDS.join(", ")}

Optional:
  --description <text>   Why this rule exists.
  --priority <number>    Lowest number wins when several rules match. Default 0.
  --disabled             Create it switched off.`;

/**
 * Parses this command's argv. Hand-rolled rather than using `parseFlags`, which
 * flattens repeats into one key — `--set` has to accumulate.
 */
function parseArgs(args: string[]): {
  name?: string;
  description?: string;
  pattern?: string;
  priority?: string;
  disabled: boolean;
  sets: string[];
} {
  const parsed = { disabled: false, sets: [] as string[] } as ReturnType<typeof parseArgs>;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);

    if (key === "disabled") {
      parsed.disabled = true;
      continue;
    }

    const value = args[index + 1] ?? "";
    index += 1;
    switch (key) {
      case "name":
        parsed.name = value;
        break;
      case "description":
        parsed.description = value;
        break;
      case "pattern":
        parsed.pattern = value;
        break;
      case "priority":
        parsed.priority = value;
        break;
      case "set":
        parsed.sets.push(value);
        break;
      default:
        // Unknown flags are ignored rather than fatal, matching the other commands.
        break;
    }
  }

  return parsed;
}

/** Splits `vendor=TGI Friday` into an action. Throws with the allowed list on a bad field. */
function parseAction(raw: string): { fieldName: RuleActionField; fieldValue: string } {
  const separator = raw.indexOf("=");
  if (separator === -1) {
    throw new Error(`--set expects <field>=<value>, got ${JSON.stringify(raw)}.`);
  }

  const fieldName = raw.slice(0, separator).trim();
  // Only the FIRST "=" splits, so a value may contain one.
  const fieldValue = raw.slice(separator + 1).trim();

  if (!(RULE_ACTION_FIELDS as readonly string[]).includes(fieldName)) {
    throw new Error(
      `Unknown field ${JSON.stringify(fieldName)}. Expected one of: ${RULE_ACTION_FIELDS.join(", ")}.`,
    );
  }

  return { fieldName: fieldName as RuleActionField, fieldValue };
}

export function expenseCreateRuleCommand(args: string[]): void {
  const parsed = parseArgs(args);

  // Argument shape is checked here; the *rule's* own invariants (a name is
  // required, a status must be a real status, at least one action) belong to
  // savePostImportRuleSchema and are reported from the catch below.
  if (parsed.sets.length === 0 || parsed.name === undefined || parsed.pattern === undefined) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  let actions: { fieldName: RuleActionField; fieldValue: string }[];
  try {
    actions = parsed.sets.map(parseAction);
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
    return;
  }

  const priority = parsed.priority === undefined ? 0 : Number(parsed.priority);
  if (!Number.isInteger(priority)) {
    console.error(`--priority expects a whole number, got ${JSON.stringify(parsed.priority)}.`);
    process.exitCode = 1;
    return;
  }

  const input: SavePostImportRuleInput = {
    name: parsed.name,
    description: parsed.description ?? "",
    pattern: parsed.pattern,
    priority,
    isEnabled: !parsed.disabled,
    actions,
  };

  try {
    // The same use-case the web form calls, so validation is identical.
    const rule = createRule(deps.expenseRepo, input);
    console.log(`Created rule #${rule.id} ${JSON.stringify(rule.name)} (${rule.pattern})`);
    if (rule.description !== "") console.log(`  description : ${rule.description}`);
    console.log(`  priority    : ${rule.priority}${rule.isEnabled ? "" : "  [disabled]"}`);
    for (const action of rule.actions) {
      console.log(`  sets        : ${action.fieldName} = ${JSON.stringify(action.fieldValue)}`);
    }
    console.log(
      "\nExisting transactions are untouched until the clean-up runs. Use Transaction Rules →\n" +
        "Re-queue all, then Manually Run Import Clean up, to apply it to history.",
    );
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}
