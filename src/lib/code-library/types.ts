// Domain types for the Code Library: reusable code snippets, filed by language.
//
// No zod here and no SQL — `schema.ts` validates boundary input, `repository.ts`
// talks to the database, and these are the shapes everything else passes around.

import type { SnippetCardColor, SnippetLanguage } from "./schema";

/**
 * One snippet, in full.
 *
 * `code` is **verbatim text** — exactly the bytes the reader pasted, never escaped
 * and never HTML. That is the single decision the whole module rests on, and it is
 * what separates this from a clip: `Clip.contentHtml` is sanitized markup because a
 * clip is pasted email, and sanitizing code would cost its indentation, its angle
 * brackets and any hope of highlighting it. See
 * `migrations/0178_create_code_library.md`.
 *
 * Nothing may render this with `dangerouslySetInnerHTML`. React escapes it on
 * output, which is where escaping belongs for text that has to survive storage
 * unchanged.
 */
export interface Snippet {
  id: number;
  /** Blank is normal — an untitled snippet is a thing people paste in a hurry. */
  title: string;
  /** The snippet, verbatim. See the note above. */
  code: string;
  /**
   * Which language, from the closed list in `schema.ts`.
   *
   * Widened back into the union by the repository on the way out, which is also
   * where an unrecognised stored value degrades to `"text"` — dropping a language
   * from the list later must leave its snippets readable, not broken.
   */
  language: SnippetLanguage;
  categories: string[];
  tags: string[];
  /**
   * Whether this snippet leads the list.
   *
   * Shared, like the snippet itself — there is no per-user pin, because there is
   * no per-user snippet. Applied in the repository's single `ORDER BY`, so every
   * view inherits the same order.
   */
  isPinned: boolean;
  /**
   * Which card tint this snippet wears, or `""` for the default surface.
   *
   * A **key** from `SNIPPET_CARD_COLORS`, never a hex — a stored hex would be the
   * same pink card on all eight themes, two of which are light. Typed as the union
   * rather than `string` so a card or an action cannot pass a colour the palette
   * does not hold; the repository widens a stored value back into this type on the
   * way out.
   */
  color: SnippetCardColor | "";
  /**
   * Where the snippet came from, or `""`.
   *
   * Six months on, the question is rarely what the code does — it is whether
   * there is a newer version of it. Nothing else in the row answers that.
   */
  sourceUrl: string;
  /**
   * The prose around the code: why this approach, what it breaks, which version
   * it needs.
   *
   * Deliberately not part of `code`. The body has to stay copy-pasteable
   * verbatim, and commenting an explanation into it would mean pasting that
   * explanation into a terminal every time.
   */
  notes: string;
  /**
   * A sealed snippet carries `isEncrypted: true`, blank `title`/`code`, and the
   * ciphertext in `titleEncrypted`/`codeEncrypted`. This mirrors a journal entry
   * and a clip exactly (migration 0131) — including that the taxonomy and the
   * language stay readable, so a sealed snippet still appears under its labels.
   *
   * Unlike a journal entry, a snippet is **shared**: anyone granted the module
   * who has the password can open it, which is also why forgetting it loses the
   * snippet for everyone.
   */
  isEncrypted: boolean;
  /** `v1:salt:iv:tag:ciphertext`, or `""` when not sealed. */
  titleEncrypted: string;
  /** `v1:salt:iv:tag:ciphertext`, or `""` when not sealed. */
  codeEncrypted: string;
  /**
   * Stored in the clear, on purpose: it has to be readable *before* anyone can
   * decrypt. It must never contain the password — the schema refuses the
   * obvious case and the UI says so.
   */
  passwordHint: string;
  /** Who wrote it. Attribution only — never a permission check. */
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A snippet sitting in the recycle bin.
 *
 * `id` is the **bin row's** id — what restore and purge address — and
 * `snippetId` is the id it had in `cod_snippets`, which restore aims at. The two
 * are written out rather than one type extending the other precisely because
 * `id` means something different here, and an `extends` would hide that.
 */
export interface RecycledSnippet {
  id: number;
  snippetId: number;
  /** Already run through `displayTitle` — reads "(encrypted)" when sealed. */
  title: string;
  /** The opening lines. Blank when sealed: there is no plaintext to preview. */
  preview: string;
  language: SnippetLanguage;
  lineCount: number;
  isEncrypted: boolean;
  categories: string[];
  tags: string[];
  deletedAt: string;
}

/** One category or tag, with how many snippets carry it. */
export interface SnippetTaxonomyItem {
  name: string;
  description: string;
  /** How many snippets are filed under it. Drives the chip's count. */
  usageCount: number;
}

/**
 * A snippet as a list row.
 *
 * A deliberate projection rather than a trimmed `Snippet`: a list of 200 snippets
 * must not pull 200 full bodies into memory. `preview` is the first few lines, cut
 * by the repository.
 *
 * `lineCount` rides along because a card wants to say how long the snippet is and
 * counting it from a truncated preview would be wrong.
 */
export interface SnippetSummary {
  id: number;
  title: string;
  /** The opening lines of `code`, verbatim as far as they go. */
  preview: string;
  /**
   * The **whole** body, carried on the summary so a card can copy it.
   *
   * A deliberate exception to this projection, and the one place it does not
   * trim. Copying a snippet is the module's primary action, and a copy button
   * that has to fetch first must `await` before writing to the clipboard — which
   * can spend the browser's user-gesture window and makes the button fail on
   * Safari while working everywhere else. Holding the text means the write
   * happens inside the click, reliably.
   *
   * The cost is that a list sends every body to the page. For a library of tens
   * of snippets at a few KB each that is nothing; if one ever holds hundreds of
   * large files, the answer is to fetch on hover rather than to make the common
   * case unreliable. `preview` stays alongside it because the *card* still
   * renders the short form, and cutting it here keeps that cut tested.
   */
  code: string;
  language: SnippetLanguage;
  /** How many lines the whole snippet has, not the preview. */
  lineCount: number;
  categories: string[];
  tags: string[];
  /** See `Snippet.isPinned`. Carried here because the list orders by it. */
  isPinned: boolean;
  /** See `Snippet.color`. A key from `SNIPPET_CARD_COLORS`, or `""`. */
  color: SnippetCardColor | "";
  /** See `Snippet.sourceUrl`. The card links it. */
  sourceUrl: string;
  /** See `Snippet.notes`. Shown above the code on a card. */
  notes: string;
  /**
   * Whether this snippet is sealed.
   *
   * A sealed row comes back with a blank `code` and `preview` — there is no
   * plaintext to show, and the Copy button hides rather than copying "". The
   * taxonomy and language are still populated, so it stays findable.
   */
  isEncrypted: boolean;
  /**
   * The hint, carried on the summary because it has to be readable *before*
   * anyone can decrypt — that is the whole point of storing it in the clear.
   * Blank for an unsealed snippet.
   */
  passwordHint: string;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}
