import {
  applyPrefillTemplate,
  deletePrefillTemplate,
  documentPrefillFieldLabel,
  emptyPrefillValues,
  getPrefillTemplateByName,
  listPrefillTemplates,
  prefillValuesToFormState,
  savePrefillTemplate,
  setPrefillTemplateEnabled,
  type DocumentPrefillField,
  type DocumentPrefillTemplate,
} from "@/lib/documents";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * Document Library prefill templates from the terminal — the same use-cases the
 * Prefill Templates screen drives.
 *
 *   documents-templates list
 *   documents-templates show   --name "Utility bill"
 *   documents-templates apply  --name "Utility bill"
 *   documents-templates set    --name "Utility bill" --field categories --value "Utilities"
 *   documents-templates set    --name "Utility bill" --field tags --value "Monthly, Electricity"
 *   documents-templates enable  --name "Utility bill"
 *   documents-templates disable --name "Utility bill"
 *   documents-templates delete  --name "Utility bill"
 *
 * `apply` is the interesting one: it prints what a new document would be prefilled
 * with, including how the two list fields split into names. It is how the merge is
 * checked without a browser — and the proof that it really lives in `src/lib/`, since
 * this file only prints.
 *
 * `set` is an upsert of one field on one template, creating the template if it does
 * not exist. Deliberately one field per invocation rather than a JSON blob argument:
 * a shell is a bad place to quote JSON, and the web editor is the right tool for
 * building a whole template at once.
 *
 * There is no `--now`, which the journal's equivalent has. A document has no date or
 * time field, so there is nothing to resolve at apply-time. See migration 0169.
 */
export async function documentsTemplatesCommand(args: string[]): Promise<void> {
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

function describe(template: DocumentPrefillTemplate): string {
  const state = template.isEnabled ? "" : " (disabled)";
  return `${template.name}${state}`;
}

function printFields(template: DocumentPrefillTemplate, indent: string): void {
  for (const entry of template.fields) {
    console.log(`${indent}${documentPrefillFieldLabel(entry.field).padEnd(12)} ${entry.value}`);
  }
}

function printList(): void {
  const templates = listPrefillTemplates(deps.documentsRepo);
  if (templates.length === 0) {
    console.log("No prefill templates.");
    return;
  }
  for (const template of templates) {
    console.log(describe(template));
    if (template.description !== "") console.log(`  ${template.description}`);
    printFields(template, "  ");
    console.log("");
  }
}

/** Looks a template up, reporting and exiting non-zero when it isn't found. */
function mustFind(name: string | undefined): DocumentPrefillTemplate | undefined {
  if (!name) {
    console.error("Pass --name.");
    process.exitCode = 1;
    return undefined;
  }
  const template = getPrefillTemplateByName(deps.documentsRepo, name);
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
  printFields(template, "  ");
}

function printApplied(name: string | undefined): void {
  const template = mustFind(name);
  if (!template) return;
  // Against an empty form, so every field the template names shows its value — which
  // is what "what would a new document start as?" means.
  const filled = applyPrefillTemplate(template, emptyPrefillValues());
  // Through the form-state converter, so the two list fields print as the names the
  // chip picker would actually show rather than as the raw comma-separated string.
  // That split is the one thing `apply` is worth running to see.
  const state = prefillValuesToFormState(filled);

  const rows: [DocumentPrefillField, string][] = [
    ["title", state.title],
    ["description", state.description],
    ["categories", state.categories.join(" | ")],
    ["tags", state.tags.join(" | ")],
  ];
  for (const [field, value] of rows) {
    if (value === "") continue;
    console.log(`${documentPrefillFieldLabel(field).padEnd(12)} ${value}`);
  }
}

function setField(flags: Record<string, string>): void {
  const name = flags.name;
  if (!name) {
    console.error("Pass --name.");
    process.exitCode = 1;
    return;
  }
  const field = flags.field as DocumentPrefillField | undefined;
  if (!field) {
    console.error("Pass --field.");
    process.exitCode = 1;
    return;
  }

  const existing = getPrefillTemplateByName(deps.documentsRepo, name);
  const fields = (existing?.fields ?? []).filter((entry) => entry.field !== field);
  fields.push({ field, mode: "literal", value: flags.value ?? "" });

  try {
    // The schema rejects an unknown field, so a typo here fails the same way it would
    // in the browser.
    const saved = savePrefillTemplate(deps.documentsRepo, {
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
  setPrefillTemplateEnabled(deps.documentsRepo, template.id, isEnabled);
  console.log(`${isEnabled ? "Enabled" : "Disabled"} "${template.name}".`);
}

function remove(name: string | undefined): void {
  const template = mustFind(name);
  if (!template) return;
  deletePrefillTemplate(deps.documentsRepo, template.id);
  console.log(`Deleted "${template.name}".`);
}
