// The zod schemas that validate boundary input for the Code Library, plus the
// constants the presentation layer needs in order to offer the same choices.
//
// Everything crossing into the module — a server action's payload, a CLI flag —
// goes through one of these first. `ARCHITECTURE.md` → *Validation at the boundary*.

import { z } from "zod";
import { TINT_COLORS, tintColorSchema, type TintColor } from "@/lib/shared/tint";

/**
 * The card tints a snippet may wear.
 *
 * The shared palette, not a Code Library one: six tints is a palette, and two
 * modules drifting to different colour names would be a nuisance with no upside.
 * The keys are **permanent** — they are stored in every coloured snippet's row,
 * so renaming one blanks those cards. See `migrations/0182`.
 */
export const SNIPPET_CARD_COLORS = TINT_COLORS;

export type SnippetCardColor = TintColor;

/** A card tint, or `""` for the default surface. */
export const snippetCardColorSchema = tintColorSchema;

/**
 * Sealing a snippet behind a password.
 *
 * The hint is refused when it contains the password verbatim — the obvious
 * mistake, and the only one a schema can catch. It cannot tell that "the usual
 * one" is a bad hint, which is why the UI says so as well.
 */
export const encryptSnippetSchema = z
  .object({
    id: z.number().int().positive("That snippet id is not valid."),
    password: z.string().min(1, "A password is required."),
    passwordHint: z.string().trim().max(200, "Keep the hint short.").default(""),
  })
  .refine(
    (value) =>
      value.passwordHint === "" ||
      !value.passwordHint.toLowerCase().includes(value.password.toLowerCase()),
    { message: "The hint must not contain the password.", path: ["passwordHint"] },
  );

export type EncryptSnippetInput = z.infer<typeof encryptSnippetSchema>;

/** Opening or unsealing a snippet. */
export const snippetPasswordSchema = z.object({
  id: z.number().int().positive("That snippet id is not valid."),
  password: z.string().min(1, "A password is required."),
});

export type SnippetPasswordInput = z.infer<typeof snippetPasswordSchema>;

/** Setting or clearing a snippet's tint. */
export const colorSnippetSchema = z.object({
  id: z.number().int().positive("That snippet id is not valid."),
  color: snippetCardColorSchema,
});

export type ColorSnippetInput = z.infer<typeof colorSnippetSchema>;

/**
 * Every language a snippet may be filed under.
 *
 * A **closed list**, which is what makes `language` a column rather than a tag: the
 * highlighter has to map it to a grammar, and a free-text value cannot be relied on
 * for that.
 *
 * Unlike an icon slot id or a card-colour key, these are **not permanent** — the
 * value is read, not persisted as a reference, so adding one is a one-line change
 * and removing one degrades its snippets to `text` rather than orphaning them
 * (see `toSnippetLanguage`). Ordered roughly by how often they turn up here, with
 * `text` last because it is the fallback rather than a choice.
 */
export const SNIPPET_LANGUAGES = [
  "ts",
  "js",
  "python",
  "sql",
  "bash",
  "powershell",
  "json",
  "yaml",
  "html",
  "css",
  "text",
] as const;

export type SnippetLanguage = (typeof SNIPPET_LANGUAGES)[number];

/** What each language is called on screen. The list above is the id, this is the label. */
export const SNIPPET_LANGUAGE_LABELS: Record<SnippetLanguage, string> = {
  ts: "TypeScript",
  js: "JavaScript",
  python: "Python",
  sql: "SQL",
  bash: "Bash",
  powershell: "PowerShell",
  json: "JSON",
  yaml: "YAML",
  html: "HTML",
  css: "CSS",
  text: "Plain text",
};

/** The language a snippet gets when none was chosen, and when a stored one is unknown. */
export const DEFAULT_SNIPPET_LANGUAGE: SnippetLanguage = "text";

/**
 * Widens a stored string back into the union, **forgivingly**.
 *
 * Used by the repository on the way out. A row written when the list held a
 * language that has since been removed must still read — it comes back as `text`,
 * which renders unhighlighted but intact. Throwing here would make a list screen
 * fail wholesale because of one stale row.
 */
export function toSnippetLanguage(value: string): SnippetLanguage {
  return (SNIPPET_LANGUAGES as readonly string[]).includes(value)
    ? (value as SnippetLanguage)
    : DEFAULT_SNIPPET_LANGUAGE;
}

export const snippetLanguageSchema = z.enum(SNIPPET_LANGUAGES);

/**
 * Title cap. Matches `CLIP_TITLE_MAX_LENGTH` — the two lists sit in the same kind
 * of card and a longer title only truncates on screen.
 */
export const SNIPPET_TITLE_MAX_LENGTH = 200;

/**
 * Body cap, in characters.
 *
 * Generous on purpose: 500 KB is the same ceiling a clip body has, and a snippet
 * is occasionally a whole file someone wants to keep. The limit exists to stop a
 * runaway paste, not to police length.
 */
export const SNIPPET_CODE_MAX_LENGTH = 500_000;

/**
 * How many lines a list preview carries.
 *
 * Lines rather than characters, unlike a clip's excerpt: one line of code is the
 * unit a reader scans, and cutting at 200 characters would slice a line in half.
 */
export const SNIPPET_PREVIEW_LINES = 6;

/**
 * The body field, shared by create and update.
 *
 * **Not trimmed, deliberately.** `.trim()` would strip the first line's indentation
 * and any trailing newline, and this module exists precisely so that what comes out
 * is what went in. A snippet whose first line is indented — a method lifted out of
 * a class, a YAML fragment — must survive the round trip.
 *
 * Emptiness is still refused, but by *testing* a trimmed copy rather than storing
 * one: whitespace-only is not a snippet, while whitespace-around-code is.
 */
const snippetCodeSchema = z
  .string()
  .max(SNIPPET_CODE_MAX_LENGTH, "That snippet is too large to store.")
  .refine((value) => value.trim() !== "", "A snippet needs some code.");

/** The title field, shared by create and update. Trimmed — a title has no shape to keep. */
const snippetTitleSchema = z
  .string()
  .trim()
  .max(SNIPPET_TITLE_MAX_LENGTH, "That title is too long.")
  .default("");

/**
 * A new snippet.
 *
 * `language` defaults rather than being required, so the CLI can add a snippet with
 * two flags and the form can submit before anyone touches the dropdown.
 */
/**
 * A taxonomy name: a category or a tag.
 *
 * Trimmed, because surrounding space in a chip is invisible and would produce two
 * entries that look identical. Cased as the writer typed it — the unique index is
 * `COLLATE NOCASE`, so "Shell" and "shell" collide without either being rewritten.
 */
export const snippetTaxonomyNameSchema = z
  .string()
  .trim()
  .min(1, "Give it a name.")
  .max(60, "Keep the name under 60 characters.");

/**
 * The lists a snippet is filed under.
 *
 * Blank entries are dropped rather than refused: the editor's comma-separated box
 * produces them constantly ("sql, , postgres"), and failing the whole save over a
 * stray comma would be hostile. Duplicates go the same way — case-insensitively,
 * matching the unique index the pairing tables carry.
 */
const snippetTaxonomyListSchema = z
  .array(z.string())
  .max(20, "That is a lot of labels — keep it under 20.")
  .default([])
  .transform((names) => {
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const raw of names) {
      const name = raw.trim();
      if (name === "") continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(name);
    }
    return kept;
  });

/**
 * Where the snippet came from.
 *
 * Only `http(s)`. The field is rendered as a link, so `javascript:` would be a
 * script vector in this app's own origin — the same scheme check
 * `sanitizeClipHtml` makes on an `href`, for the same reason. A blank is fine;
 * anything else is refused rather than silently dropped, because a reader who
 * pasted a URL should be told it was not kept.
 */
const snippetSourceUrlSchema = z
  .string()
  .trim()
  .max(2000, "That URL is too long.")
  .default("")
  .refine(
    (value) => value === "" || /^https?:\/\//i.test(value),
    "A source link must start with http:// or https://.",
  );

export const SNIPPET_NOTES_MAX_LENGTH = 2000;

export const createSnippetSchema = z.object({
  title: snippetTitleSchema,
  code: snippetCodeSchema,
  language: snippetLanguageSchema.default(DEFAULT_SNIPPET_LANGUAGE),
  categories: snippetTaxonomyListSchema,
  tags: snippetTaxonomyListSchema,
  sourceUrl: snippetSourceUrlSchema,
  notes: z
    .string()
    .trim()
    .max(SNIPPET_NOTES_MAX_LENGTH, "Keep the notes under 2000 characters.")
    .default(""),
});

/**
 * What a **caller** passes: the fields with defaults are optional.
 *
 * `z.input`, not `z.infer`. `infer` is the *output* type, where every default
 * has been filled in — so typing the boundary with it would force the CLI and
 * every test to spell out `categories: [], tags: [], sourceUrl: "", notes: ""`
 * on a call that means "just a body and a language". Defaults exist precisely so
 * those can be left out.
 */
export type CreateSnippetInput = z.input<typeof createSnippetSchema>;

/**
 * What the **repository** receives: the parsed value, every field present.
 *
 * The other half of the split above. A repository must never see an optional
 * field that the schema would have defaulted — that is the whole point of
 * parsing at the boundary.
 */
export type CreateSnippetData = z.output<typeof createSnippetSchema>;

/**
 * An edit to an existing snippet.
 *
 * Whole-record, not a patch: the editor always has every field on screen, and a
 * partial update would make "cleared the title" and "did not touch the title"
 * indistinguishable.
 */
export const updateSnippetSchema = createSnippetSchema.extend({
  id: z.number().int().positive("That snippet id is not valid."),
});

/** See `CreateSnippetInput` — the caller's shape, defaults optional. */
export type UpdateSnippetInput = z.input<typeof updateSnippetSchema>;

/** See `CreateSnippetData` — the parsed shape the repository receives. */
export type UpdateSnippetData = z.output<typeof updateSnippetSchema>;

/**
 * The list filter.
 *
 * Every field defaults, so an unparsed or partly-filled query string narrows the
 * list rather than throwing — a stale bookmark shows nothing matching, never a 500.
 * The same forgiving-filter rule `clipFilterSchema` follows.
 */
export const snippetFilterSchema = z.object({
  search: z.string().trim().default(""),
  /**
   * `""` means every language. Not `z.enum`, because a hand-edited URL carrying a
   * language that no longer exists must narrow to nothing, not 404.
   */
  language: z.string().trim().default(""),
  /**
   * **AND** semantics: two categories means snippets carrying both. Enforced in
   * the repository with `HAVING COUNT(DISTINCT …)` — an `IN` alone would quietly
   * mean either, which is a different and much less useful filter.
   */
  categories: z.array(z.string().trim()).default([]),
  tags: z.array(z.string().trim()).default([]),
});

/** Setting or clearing a snippet's pin. */
export const pinSnippetSchema = z.object({
  id: z.number().int().positive("That snippet id is not valid."),
  isPinned: z.boolean(),
});

export type PinSnippetInput = z.infer<typeof pinSnippetSchema>;

/** Creating or renaming a category or tag from the management screen. */
export const snippetTaxonomyWriteSchema = z.object({
  name: snippetTaxonomyNameSchema,
  description: z.string().trim().max(500, "Keep the description under 500 characters.").default(""),
  /**
   * The name being replaced, when this is a rename. Blank for a new entry.
   *
   * A rename has to carry the old name because the name **is** the key: the
   * pairing rows reference it, so the repository rewrites them in the same
   * transaction. Without this the rename would orphan every snippet filed
   * under the old word.
   */
  previousName: z.string().trim().default(""),
});

export type SnippetTaxonomyWriteInput = z.infer<typeof snippetTaxonomyWriteSchema>;

export type SnippetFilterInput = z.infer<typeof snippetFilterSchema>;
