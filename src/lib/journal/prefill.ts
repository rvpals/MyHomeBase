// Journal prefill templates: the field registry, the pure apply logic, and the
// use-cases behind the Templates screen.
//
// A template is a named set of field values a new entry can be started from.
// Storage and the reasoning behind it are in migration 0062; this file holds the
// behaviour. The apply step is a pure function so the same fill runs in the
// browser (the New Entry form), in the CLI, and in a test.

import type { JournalRepository } from "./ports";
import { savePrefillTemplateSchema } from "./schema";
import type { SavePrefillTemplateInput } from "./schema";
import type {
  JournalPrefillField,
  JournalPrefillFieldValue,
  JournalPrefillFormValues,
  JournalPrefillTemplate,
} from "./types";

/** How many suggestions the template editor's value box offers per field. */
export const PREFILL_SUGGESTION_LIMIT = 25;

/**
 * The fields a template can fill, in the order the editor's dropdown lists them
 * — which is the order they appear on the entry form, so the dropdown reads like
 * the screen it fills.
 *
 * `kind` tells the editor which value control to draw:
 *   text      — a single-line box
 *   multiline — a textarea
 *   list      — a box whose suggestions come from the managed category/tag list
 *   date/time — a native picker, plus the literal-or-current toggle
 *
 * Locations and weather are absent on purpose: the entry form already resolves
 * both live from GPS, and a stored copy would be staler than one button press.
 */
export const JOURNAL_PREFILL_FIELDS: readonly {
  field: JournalPrefillField;
  label: string;
  kind: "text" | "multiline" | "list" | "date" | "time";
  /** Shown under the value box in the editor. */
  hint: string;
}[] = [
  { field: "date", label: "Date", kind: "date", hint: "Usually Current date." },
  { field: "time", label: "Time", kind: "time", hint: "Usually Current time." },
  { field: "title", label: "Title", kind: "text", hint: "A headline to start from." },
  {
    field: "placeName",
    label: "Place name",
    kind: "text",
    hint: "Free text, e.g. Princeton University.",
  },
  {
    field: "categories",
    label: "Categories",
    kind: "list",
    hint: "Comma-separated, as on the entry form.",
  },
  { field: "tags", label: "Tags", kind: "list", hint: "Space-separated, as on the entry form." },
  {
    field: "content",
    label: "Content",
    kind: "multiline",
    hint: "A skeleton for the entry body.",
  },
] as const;

const FIELD_LABELS: Record<JournalPrefillField, string> = Object.fromEntries(
  JOURNAL_PREFILL_FIELDS.map((entry) => [entry.field, entry.label]),
) as Record<JournalPrefillField, string>;

/** Human-readable name for a field, for messages and the templates list. */
export function prefillFieldLabel(field: JournalPrefillField): string {
  return FIELD_LABELS[field] ?? field;
}

/** Whether a field offers the "current date/time" mode. Mirrors the schema's rule. */
export function prefillFieldAllowsNow(field: JournalPrefillField): boolean {
  return field === "date" || field === "time";
}

// --- Applying a template -----------------------------------------------------

/** The empty form, used as the starting point when nothing has been typed. */
export function emptyPrefillValues(): JournalPrefillFormValues {
  return { date: "", time: "", title: "", content: "", placeName: "", categories: "", tags: "" };
}

/**
 * Resolves one field's value.
 *
 * `now` is taken as an argument rather than read from `new Date()` here, for two
 * reasons: it keeps this function pure and testable, and it forces the caller to
 * decide *whose* clock is meant. The web form passes the browser's, because an
 * entry's date is the calendar day the writer is living in — resolving it
 * server-side would file a late-evening entry under the wrong day for anyone in a
 * different timezone from the server. See 0062.
 */
export function resolvePrefillValue(entry: JournalPrefillFieldValue, now: Date): string {
  if (entry.mode !== "now") return entry.value;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (entry.field === "date") {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  if (entry.field === "time") {
    return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
  // Unreachable via the schema, which rejects `now` on every other field. Falling
  // back to the literal is the harmless answer if a hand-edited row gets here.
  return entry.value;
}

/**
 * Merges a template into whatever is already on the form.
 *
 * **Fill-only-blanks.** A field the writer has already typed into is never
 * overwritten — applying a template can add to a half-written entry but cannot
 * destroy work, so the control needs no confirmation and no undo. A template
 * value that is itself blank fills nothing.
 *
 * Returns a new object; the input is not mutated.
 */
export function applyPrefillTemplate(
  template: JournalPrefillTemplate,
  current: JournalPrefillFormValues,
  now: Date,
): JournalPrefillFormValues {
  const next = { ...current };
  for (const entry of template.fields) {
    if (next[entry.field].trim() !== "") continue;
    const resolved = resolvePrefillValue(entry, now);
    if (resolved === "") continue;
    next[entry.field] = resolved;
  }
  return next;
}

// --- Use-cases ---------------------------------------------------------------

export function listPrefillTemplates(repo: JournalRepository): JournalPrefillTemplate[] {
  return repo.listPrefillTemplates();
}

/** Only the templates the New Entry form should offer. See 0062 on `is_enabled`. */
export function listEnabledPrefillTemplates(repo: JournalRepository): JournalPrefillTemplate[] {
  return repo.listPrefillTemplates().filter((template) => template.isEnabled);
}

export function getPrefillTemplate(
  repo: JournalRepository,
  id: number,
): JournalPrefillTemplate | undefined {
  return repo.getPrefillTemplateById(id);
}

/** By name, case-insensitively — how the CLI addresses a template. */
export function getPrefillTemplateByName(
  repo: JournalRepository,
  name: string,
): JournalPrefillTemplate | undefined {
  return repo.getPrefillTemplateByName(name.trim());
}

/**
 * Creates or updates a template. The input's optional `id` decides which.
 *
 * The name clash is checked here rather than left to the unique index, so the
 * caller gets a sentence instead of a SQLITE_CONSTRAINT — and so the check reads
 * the same from the web form and the CLI.
 */
export function savePrefillTemplate(
  repo: JournalRepository,
  input: SavePrefillTemplateInput,
): JournalPrefillTemplate {
  const parsed = savePrefillTemplateSchema.parse(input);

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
 * Deletes a template. Safe unconditionally: applying copies values into an entry
 * and nothing links back, so no entry depends on the template that seeded it.
 */
export function deletePrefillTemplate(repo: JournalRepository, id: number): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`deletePrefillTemplate: id must be a positive integer, got ${id}.`);
  }
  repo.deletePrefillTemplate(id);
}

export function setPrefillTemplateEnabled(
  repo: JournalRepository,
  id: number,
  isEnabled: boolean,
): JournalPrefillTemplate {
  if (!repo.getPrefillTemplateById(id)) {
    throw new Error(`Prefill template ${id} no longer exists.`);
  }
  return repo.setPrefillTemplateEnabled(id, isEnabled);
}

/**
 * Autocomplete suggestions for one field in the template editor.
 *
 * Categories and tags come from the module's managed lists rather than from what
 * entries happen to contain, so the editor suggests the vocabulary the journal is
 * *meant* to use — that list is the thing the Categories & Tags screen curates,
 * and suggesting a typo back at the writer is how the drift a template is
 * supposed to prevent gets baked in.
 */
export function listPrefillSuggestions(
  repo: JournalRepository,
  field: JournalPrefillField,
  limit = PREFILL_SUGGESTION_LIMIT,
): string[] {
  if (field === "categories") return repo.listCategories().map((category) => category.name);
  if (field === "tags") return repo.listTags().map((tag) => tag.name);
  return repo.listDistinctFieldValues(field, limit);
}
