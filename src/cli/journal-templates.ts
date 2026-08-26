import {
  applyPrefillTemplate,
  deletePrefillTemplate,
  emptyPrefillValues,
  getPrefillTemplateByName,
  listPrefillTemplates,
  prefillFieldLabel,
  savePrefillTemplate,
  setPrefillTemplateEnabled,
  type JournalPrefillField,
  type JournalPrefillTemplate,
} from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * Journal prefill templates from the terminal — the same use-cases the Templates
 * screen drives.
 *
 *   journal-templates list
 *   journal-templates show --name "Gym"
 *   journal-templates apply --name "Gym"
 *   journal-templates set --name "Gym" --field categories --value HEALTH
 *   journal-templates set --name "Today" --field date --now
 *   journal-templates enable  --name "Gym"
 *   journal-templates disable --name "Gym"
 *   journal-templates delete  --name "Gym"
 *
 * `apply` is the interesting one: it prints what a new entry would be prefilled
 * with, resolving "current date"/"current time" against this machine's clock. It
 * is how the dynamic-mode behaviour is checked without a browser — and the proof
 * that the merge really lives in `src/lib/`, since this file only prints.
 *
 * `set` is an upsert of one field on one template, creating the template if it
 * does not exist. Deliberately one field per invocation rather than a JSON blob
 * argument: a shell is a bad place to quote JSON, and the web editor is the right
 * tool for building a whole template at once.
 */
export async function journalTemplatesCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const flags = parseFlags(rest);

  switch (subcommand) {
    case "list":
      return printList();
    case "show":
      return printOne(flags.name);
    case "apply":
      return printApplied(flags.name);
    case "set":
      return setField(flags);
    case "enable":
      return setEnabled(flags.name, true);
    case "disable":
      return setEnabled(flags.name, false);
    case "delete":
      return remove(flags.name);
    default:
      console.error(`Unknown subcommand "${subcommand ?? "(none)"}".`);
      console.error("Use: list | show | apply | set | enable | disable | delete");
      process.exitCode = 1;
  }
}

function describe(template: JournalPrefillTemplate): string {
  const state = template.isEnabled ? "" : " (disabled)";
  return `${template.name}${state}`;
}

function printList(): void {
  const templates = listPrefillTemplates(deps.journalRepo);
  if (templates.length === 0) {
    console.log("No prefill templates.");
    return;
  }
  for (const template of templates) {
    console.log(describe(template));
    if (template.description !== "") console.log(`  ${template.description}`);
    for (const entry of template.fields) {
      const value = entry.mode === "now" ? "<current>" : entry.value;
      console.log(`  ${prefillFieldLabel(entry.field).padEnd(12)} ${value}`);
    }
    console.log("");
  }
}

/** Looks a template up, reporting and exiting non-zero when it isn't found. */
function mustFind(name: string | undefined): JournalPrefillTemplate | undefined {
  if (!name) {
    console.error("Pass --name.");
    process.exitCode = 1;
    return undefined;
  }
  const template = getPrefillTemplateByName(deps.journalRepo, name);
  if (!template) {
    console.error(`No prefill template named "${name}".`);
    process.exitCode = 1;
    return undefined;
  }
  return template;
}

function printOne(name: string | undefined): void {
  const template = mustFind(name);
  if (!template) return;
  console.log(describe(template));
  if (template.description !== "") console.log(template.description);
  for (const entry of template.fields) {
    const value = entry.mode === "now" ? "<current>" : entry.value;
    console.log(`  ${prefillFieldLabel(entry.field).padEnd(12)} ${value}`);
  }
}

function printApplied(name: string | undefined): void {
  const template = mustFind(name);
  if (!template) return;
  // Against an empty form, so every field the template names shows its resolved
  // value — which is what "what would a new entry start as?" means.
  const filled = applyPrefillTemplate(template, emptyPrefillValues(), new Date());
  for (const [field, value] of Object.entries(filled)) {
    if (value === "") continue;
    console.log(`${prefillFieldLabel(field as JournalPrefillField).padEnd(12)} ${value}`);
  }
}

function setField(flags: Record<string, string>): void {
  const name = flags.name;
  if (!name) {
    console.error("Pass --name.");
    process.exitCode = 1;
    return;
  }
  const field = flags.field as JournalPrefillField | undefined;
  if (!field) {
    console.error("Pass --field.");
    process.exitCode = 1;
    return;
  }
  // `--now` takes no value, so parseFlags leaves it as the next token or "".
  // Its presence as a key is what matters.
  const isNow = "now" in flags;

  const existing = getPrefillTemplateByName(deps.journalRepo, name);
  const fields = (existing?.fields ?? []).filter((entry) => entry.field !== field);
  fields.push({ field, mode: isNow ? "now" : "literal", value: isNow ? "" : (flags.value ?? "") });

  try {
    // The schema rejects an unknown field and an illegal `now`, so a typo here
    // fails the same way it would in the browser.
    const saved = savePrefillTemplate(deps.journalRepo, {
      id: existing?.id,
      name: existing?.name ?? name,
      description: flags.description ?? existing?.description ?? "",
      isEnabled: existing?.isEnabled ?? true,
      fields,
    });
    console.log(`Saved "${saved.name}" (${saved.fields.length} field(s)).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function setEnabled(name: string | undefined, isEnabled: boolean): void {
  const template = mustFind(name);
  if (!template) return;
  setPrefillTemplateEnabled(deps.journalRepo, template.id, isEnabled);
  console.log(`${isEnabled ? "Enabled" : "Disabled"} "${template.name}".`);
}

function remove(name: string | undefined): void {
  const template = mustFind(name);
  if (!template) return;
  deletePrefillTemplate(deps.journalRepo, template.id);
  console.log(`Deleted "${template.name}".`);
}
