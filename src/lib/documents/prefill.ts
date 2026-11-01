// Document Library prefill templates: the field registry, the pure apply logic, and
// the use-cases behind the Prefill Templates screen.
//
// A template is a named set of field values a new document can be filed from.
// Storage and the reasoning behind it are in migration 0169; this file holds the
// behaviour. The apply step is a pure function so the same fill runs in the browser
// (the New Document form), in the CLI, and in a test.

import type { DocumentsRepository } from "./ports";
import { saveDocumentPrefillTemplateSchema } from "./schema";
import type { SaveDocumentPrefillTemplateInput } from "./schema";
import type {
  DocumentPrefillField,
  DocumentPrefillFieldValue,
  DocumentPrefillFormValues,
  DocumentPrefillTemplate,
} from "./types";

/** How many suggestions the template editor's value box offers per field. */
export const DOCUMENT_PREFILL_SUGGESTION_LIMIT = 25;

/**
 * The fields a template can fill, in the order the editor's dropdown lists them —
 * which is the order they appear on the New Document form, so the dropdown reads
 * like the screen it fills.
 *
 * `kind` tells the editor which value control to draw:
 *   text      — a single-line box
 *   multiline — a textarea
 *   list      — a `TokenPicker` over the managed category/tag list, the same
 *                control the New Document form fills the field with
 *
 * Attachments are absent on purpose: a template fills form fields, and the bytes of
 * a document are the one part that is genuinely new each time.
 *
 * `suggests` marks the two fields that have a vocabulary to offer. Title and
 * Description don't: a document title is "Lease 2026" or "Toyota warranty", near
 * enough unique every time, so a list of 25 past titles under the box would be
 * noise rather than help. Categories and tags are the opposite — a managed,
 * deliberately small vocabulary, and suggesting it is how the drift a template is
 * meant to prevent gets prevented.
 *
 * It is what `listPrefillSuggestions` answers for, and it tracks `kind: "list"`
 * exactly today — the template editor draws its `TokenPicker` off the `kind`, since
 * that is what decides the CONTROL. The two are kept apart because they answer
 * different questions: a future free-text field with a suggestion list would be
 * `suggests` without being a `list`.
 */
export const DOCUMENT_PREFILL_FIELDS: readonly {
  field: DocumentPrefillField;
  label: string;
  kind: "text" | "multiline" | "list";
  /** Shown under the value box in the editor. */
  hint: string;
  /** Whether this field's box offers autocomplete. See above. */
  suggests: boolean;
}[] = [
  {
    field: "title",
    label: "Title",
    kind: "text",
    hint: "A starting title, e.g. Utility bill —.",
    suggests: false,
  },
  {
    field: "description",
    label: "Description",
    kind: "multiline",
    hint: "Context that is the same every time this kind is filed.",
    suggests: false,
  },
  {
    field: "categories",
    label: "Categories",
    kind: "list",
    hint: "What KIND of document this is.",
    suggests: true,
  },
  {
    field: "tags",
    label: "Tags",
    kind: "list",
    hint: "What the document is ABOUT.",
    suggests: true,
  },
] as const;

const FIELD_LABELS: Record<DocumentPrefillField, string> = Object.fromEntries(
  DOCUMENT_PREFILL_FIELDS.map((entry) => [entry.field, entry.label]),
) as Record<DocumentPrefillField, string>;

/** Human-readable name for a field, for messages and the templates list. */
export function documentPrefillFieldLabel(field: DocumentPrefillField): string {
  return FIELD_LABELS[field] ?? field;
}

/** Whether a field's editor box offers suggestions. Mirrors `suggests` above. */
export function documentPrefillFieldSuggests(field: DocumentPrefillField): boolean {
  return DOCUMENT_PREFILL_FIELDS.find((entry) => entry.field === field)?.suggests ?? false;
}

/** Whether a field holds a delimited list rather than one value. */
export function documentPrefillFieldIsList(field: DocumentPrefillField): boolean {
  return DOCUMENT_PREFILL_FIELDS.find((entry) => entry.field === field)?.kind === "list";
}

// --- Lists as text -----------------------------------------------------------

/**
 * Splits a template's delimited text into names.
 *
 * Comma-separated, because a category or a tag here may legitimately contain a
 * space — "Car insurance" is one name, not two. The Journal splits its tags on
 * whitespace, which works there because journal tags are single words by
 * convention; document tags are not, and splitting "Car insurance" into two tags
 * would quietly create a vocabulary nobody chose.
 *
 * Blanks are dropped and case-insensitive duplicates collapse, so a template value
 * of `Tax, , tax` yields one name. The form's chip picker applies exactly the same
 * two rules, and a template that got past them would produce chips the picker
 * itself would have refused.
 */
export function splitPrefillList(value: string): string[] {
  const names: string[] = [];
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    if (names.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) continue;
    names.push(trimmed);
  }
  return names;
}

/** The inverse, for showing an existing list value in the editor's box. */
export function joinPrefillList(names: readonly string[]): string {
  return names.join(", ");
}

// --- Applying a template -----------------------------------------------------

/** The empty form, used as the starting point when nothing has been typed. */
export function emptyPrefillValues(): DocumentPrefillFormValues {
  return { title: "", description: "", categories: "", tags: "" };
}

/**
 * Merges a template into whatever is already on the form.
 *
 * **Fill-only-blanks.** A field the filer has already typed into is never
 * overwritten — applying a template can add to a half-filled form but cannot
 * destroy work, so the control needs no confirmation and no undo. A template value
 * that is itself blank fills nothing.
 *
 * For the two list fields, "blank" means *no names chosen*: a template never merges
 * into a list already started. Half-merging two vocabularies would produce a set of
 * chips neither the template nor the filer asked for, and the filer could not tell
 * which came from where.
 *
 * Returns a new object; the input is not mutated.
 */
export function applyPrefillTemplate(
  template: DocumentPrefillTemplate,
  current: DocumentPrefillFormValues,
): DocumentPrefillFormValues {
  const next = { ...current };
  for (const entry of template.fields) {
    if (documentPrefillFieldIsList(entry.field)) {
      if (splitPrefillList(next[entry.field]).length > 0) continue;
      if (splitPrefillList(entry.value).length === 0) continue;
      next[entry.field] = entry.value;
      continue;
    }
    if (next[entry.field].trim() !== "") continue;
    if (entry.value.trim() === "") continue;
    next[entry.field] = entry.value;
  }
  return next;
}

/** What the editor form actually holds: two strings and two arrays. */
export interface DocumentPrefillFormState {
  title: string;
  description: string;
  categories: string[];
  tags: string[];
}

/**
 * Turns the flat string form into the shape the editor's controls want.
 *
 * Here rather than in the view so the split rule has exactly one home — the view
 * never parses a delimiter, and the CLI's `apply` prints the same names the form
 * would show. See migration 0169.
 */
export function prefillValuesToFormState(
  values: DocumentPrefillFormValues,
): DocumentPrefillFormState {
  return {
    title: values.title,
    description: values.description,
    categories: splitPrefillList(values.categories),
    tags: splitPrefillList(values.tags),
  };
}

/** The inverse: the live form, as the flat strings `applyPrefillTemplate` merges. */
export function formStateToPrefillValues(
  state: DocumentPrefillFormState,
): DocumentPrefillFormValues {
  return {
    title: state.title,
    description: state.description,
    categories: joinPrefillList(state.categories),
    tags: joinPrefillList(state.tags),
  };
}

// --- Use-cases ---------------------------------------------------------------

export function listPrefillTemplates(repo: DocumentsRepository): DocumentPrefillTemplate[] {
  return repo.listPrefillTemplates();
}

/** Only the templates the New Document form should offer. See 0169 on `is_enabled`. */
export function listEnabledPrefillTemplates(
  repo: DocumentsRepository,
): DocumentPrefillTemplate[] {
  return repo.listPrefillTemplates().filter((template) => template.isEnabled);
}

export function getPrefillTemplate(
  repo: DocumentsRepository,
  id: number,
): DocumentPrefillTemplate | undefined {
  return repo.getPrefillTemplateById(id);
}

/** By name, case-insensitively — how the CLI addresses a template. */
export function getPrefillTemplateByName(
  repo: DocumentsRepository,
  name: string,
): DocumentPrefillTemplate | undefined {
  return repo.getPrefillTemplateByName(name.trim());
}

/**
 * Creates or updates a template. The input's optional `id` decides which.
 *
 * The name clash is checked here rather than left to the unique index, so the caller
 * gets a sentence instead of a SQLITE_CONSTRAINT — and so the check reads the same
 * from the web form and the CLI.
 */
export function savePrefillTemplate(
  repo: DocumentsRepository,
  input: SaveDocumentPrefillTemplateInput,
): DocumentPrefillTemplate {
  const parsed = saveDocumentPrefillTemplateSchema.parse(input);

  const clash = repo.getPrefillTemplateByName(parsed.name);
  if (clash && clash.id !== parsed.id) {
    throw new Error(`A prefill template named "${clash.name}" already exists.`);
  }
  if (parsed.id !== undefined && !repo.getPrefillTemplateById(parsed.id)) {
    throw new Error(`Prefill template ${parsed.id} no longer exists.`);
  }

  return repo.savePrefillTemplate(parsed);
}

/**
 * Deletes a template. Safe unconditionally: applying copies values into the form and
 * nothing links back, so no document depends on the template that seeded it.
 */
export function deletePrefillTemplate(repo: DocumentsRepository, id: number): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`deletePrefillTemplate: id must be a positive integer, got ${id}.`);
  }
  repo.deletePrefillTemplate(id);
}

export function setPrefillTemplateEnabled(
  repo: DocumentsRepository,
  id: number,
  isEnabled: boolean,
): DocumentPrefillTemplate {
  if (!repo.getPrefillTemplateById(id)) {
    throw new Error(`Prefill template ${id} no longer exists.`);
  }
  return repo.setPrefillTemplateEnabled(id, isEnabled);
}

/**
 * Autocomplete suggestions for one field in the template editor.
 *
 * Categories and tags come from the module's managed lists rather than from what
 * documents happen to contain, so the editor suggests the vocabulary the library is
 * *meant* to use — that list is the thing the Categories & Tags screen curates, and
 * suggesting a typo back at the filer is how the drift a template is supposed to
 * prevent gets baked in.
 *
 * Every other field returns nothing. See `suggests` on `DOCUMENT_PREFILL_FIELDS`.
 */
export function listPrefillSuggestions(
  repo: DocumentsRepository,
  field: DocumentPrefillField,
): string[] {
  if (field === "categories") return repo.listCategories().map((category) => category.name);
  if (field === "tags") return repo.listTags().map((tag) => tag.name);
  return [];
}

/** A one-line summary of what a template fills, for a list row and the CLI. */
export function describePrefillFields(fields: readonly DocumentPrefillFieldValue[]): string {
  if (fields.length === 0) return "No fields yet.";
  return fields
    .map((entry) => `${documentPrefillFieldLabel(entry.field)}: ${entry.value}`)
    .join(" · ");
}
