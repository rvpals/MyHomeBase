// The Code Library use-cases: functions that take data and return data.
//
// Every one is reachable identically from the web app and from the CLI — they take
// a repository through their parameters and never construct one. The composition
// root in `wiring.ts` supplies the real thing; a test supplies a fake.

import { decryptText, encryptText } from "@/lib/shared/encryption";
import type { CodeLibraryRepository } from "./ports";
import {
  SNIPPET_PREVIEW_LINES,
  createSnippetSchema,
  colorSnippetSchema,
  encryptSnippetSchema,
  pinSnippetSchema,
  snippetFilterSchema,
  snippetTaxonomyNameSchema,
  snippetPasswordSchema,
  snippetTaxonomyWriteSchema,
  updateSnippetSchema,
  type CreateSnippetInput,
  type ColorSnippetInput,
  type EncryptSnippetInput,
  type PinSnippetInput,
  type SnippetFilterInput,
  type SnippetPasswordInput,
  type SnippetTaxonomyWriteInput,
  type UpdateSnippetInput,
} from "./schema";
import type {
  RecycledSnippet,
  Snippet,
  SnippetSummary,
  SnippetTaxonomyItem,
} from "./types";

/**
 * Thrown when an edit names a snippet that is not there.
 *
 * Its own class rather than a bare `Error` so a caller can tell "this id is gone"
 * apart from "the input was invalid" — the action turns both into a message, but
 * only one of them means the reader should reload.
 */
export class SnippetNotFoundError extends Error {
  constructor(id: number) {
    super(`No snippet with id ${id}.`);
    this.name = "SnippetNotFoundError";
  }
}

/**
 * The snippet list, filtered.
 *
 * Takes a **partial** filter and parses it, so a route handing over raw search
 * params gets the defaults rather than having to build a complete object. The
 * schema is forgiving by design: a stale bookmark narrows the list to nothing
 * instead of throwing.
 */
export function listSnippets(
  repo: CodeLibraryRepository,
  filter: Partial<SnippetFilterInput> = {},
  previewLines: number = SNIPPET_PREVIEW_LINES,
): SnippetSummary[] {
  const parsed = snippetFilterSchema.parse(filter);
  return repo.listSnippets(parsed, previewLines);
}

/**
 * One snippet in full, or `undefined`.
 *
 * Deliberately `undefined` rather than a throw: the caller decides whether a
 * missing id is a 404 (a route) or a message (the CLI).
 */
export function getSnippet(
  repo: CodeLibraryRepository,
  id: number,
): Snippet | undefined {
  return repo.getSnippetById(id);
}

/**
 * Stores a new snippet.
 *
 * Validates here rather than trusting the caller: this is the boundary, and the
 * web form and the CLI both reach it. `createdBy` is attribution — it is not read
 * by anything that decides access.
 *
 * Note what does **not** happen to `code` on the way through: nothing. It is not
 * sanitized, escaped, trimmed or normalised. That is the module's contract.
 */
export function createSnippet(
  repo: CodeLibraryRepository,
  input: CreateSnippetInput,
  createdBy: number | null,
): Snippet {
  const parsed = createSnippetSchema.parse(input);
  return repo.createSnippet(parsed, createdBy);
}

/**
 * Replaces an existing snippet's title, body and language.
 *
 * Throws `SnippetNotFoundError` when the id is gone — an edit that silently saved
 * nothing is worse than one that says the snippet has been removed.
 */
export function updateSnippet(
  repo: CodeLibraryRepository,
  input: UpdateSnippetInput,
): Snippet {
  const parsed = updateSnippetSchema.parse(input);
  const snippet = repo.updateSnippet(parsed);
  if (!snippet) throw new SnippetNotFoundError(parsed.id);
  return snippet;
}

/**
 * Pins or unpins a snippet.
 *
 * Its own use-case rather than a field on the editor's save, so pinning from the
 * list does not have to round-trip the body — and so saving an edit can never
 * silently unpin something the reader pinned in another tab.
 */
export function setSnippetPinned(
  repo: CodeLibraryRepository,
  input: PinSnippetInput,
): void {
  const parsed = pinSnippetSchema.parse(input);
  if (!repo.setSnippetPinned(parsed)) throw new SnippetNotFoundError(parsed.id);
}

/**
 * Sets or clears a snippet's card tint.
 *
 * Its own use-case for the same reason pinning is: recolouring from the list must
 * not round-trip the body, and a save from the editor must not silently reset a
 * colour chosen in another tab.
 */
export function setSnippetColor(
  repo: CodeLibraryRepository,
  input: ColorSnippetInput,
): void {
  const parsed = colorSnippetSchema.parse(input);
  if (!repo.setSnippetColor(parsed)) throw new SnippetNotFoundError(parsed.id);
}

/**
 * Seals a snippet behind a password.
 *
 * Title and body are encrypted as **separate blobs** under the same password,
 * each with its own salt and IV — never one key, two plaintexts, one IV. That is
 * `encryptText`'s contract and the reason it is called twice rather than once on
 * a joined string.
 *
 * There is no recovery. A snippet is the household's, so a forgotten password
 * loses it for everyone; the UI says so before this is called.
 */
export function encryptSnippet(
  repo: CodeLibraryRepository,
  input: EncryptSnippetInput,
): void {
  const parsed = encryptSnippetSchema.parse(input);

  const snippet = repo.getSnippetById(parsed.id);
  if (!snippet) throw new SnippetNotFoundError(parsed.id);
  if (snippet.isEncrypted) throw new Error("That snippet is already sealed.");

  const sealed = repo.sealSnippet(
    parsed.id,
    encryptText(snippet.title, parsed.password),
    encryptText(snippet.code, parsed.password),
    parsed.passwordHint,
  );

  if (!sealed) throw new SnippetNotFoundError(parsed.id);
}

/**
 * The plaintext of a sealed snippet, without unsealing it.
 *
 * What the viewer calls to show a snippet once the password is entered. Throws
 * `WrongPasswordError` from the shared module on a bad password, so the CLI and
 * the web app fail identically.
 */
export function openSnippet(
  repo: CodeLibraryRepository,
  input: SnippetPasswordInput,
): { title: string; code: string } {
  const parsed = snippetPasswordSchema.parse(input);

  const snippet = repo.getSnippetById(parsed.id);
  if (!snippet) throw new SnippetNotFoundError(parsed.id);
  if (!snippet.isEncrypted) return { title: snippet.title, code: snippet.code };

  return {
    title: decryptText(snippet.titleEncrypted, parsed.password),
    code: decryptText(snippet.codeEncrypted, parsed.password),
  };
}

/**
 * Removes the seal, writing the plaintext back.
 *
 * Decrypts first and only then writes: a wrong password throws before anything
 * is changed, so a failed unseal cannot leave a snippet half-open.
 */
export function decryptSnippet(
  repo: CodeLibraryRepository,
  input: SnippetPasswordInput,
): void {
  const parsed = snippetPasswordSchema.parse(input);

  const snippet = repo.getSnippetById(parsed.id);
  if (!snippet) throw new SnippetNotFoundError(parsed.id);
  if (!snippet.isEncrypted) return;

  const title = decryptText(snippet.titleEncrypted, parsed.password);
  const code = decryptText(snippet.codeEncrypted, parsed.password);

  if (!repo.unsealSnippet(parsed.id, title, code)) throw new SnippetNotFoundError(parsed.id);
}

/**
 * Moves a snippet to the recycle bin.
 *
 * The **only** delete this module exposes on a live snippet. Destroying one
 * takes a second, deliberate act in the bin — that is the whole reason the bin
 * was built before delete was.
 */
export function recycleSnippet(repo: CodeLibraryRepository, id: number): void {
  if (!repo.recycleSnippet(id)) throw new SnippetNotFoundError(id);
}

/** The bin, most recently deleted first. */
export function listRecycledSnippets(
  repo: CodeLibraryRepository,
  previewLines: number = SNIPPET_PREVIEW_LINES,
): RecycledSnippet[] {
  return repo.listRecycledSnippets(previewLines);
}

/**
 * Restores one binned snippet, returning the id it came back as.
 *
 * Usually the id it had — see the port. The caller gets the actual id rather
 * than a boolean so a "restored" message can link to it.
 */
export function restoreRecycledSnippet(repo: CodeLibraryRepository, recycledId: number): number {
  const id = repo.restoreRecycledSnippet(recycledId);
  if (id === undefined) throw new SnippetNotFoundError(recycledId);
  return id;
}

/** Destroys one binned snippet for good. */
export function purgeRecycledSnippet(repo: CodeLibraryRepository, recycledId: number): void {
  if (!repo.purgeRecycledSnippet(recycledId)) throw new SnippetNotFoundError(recycledId);
}

/** Destroys everything in the bin, returning how many snippets went. */
export function emptyRecycleBin(repo: CodeLibraryRepository): number {
  return repo.emptyRecycleBin();
}

/** Every category, alphabetical, with how many snippets carry each. */
export function listSnippetCategories(repo: CodeLibraryRepository): SnippetTaxonomyItem[] {
  return repo.listCategories();
}

/** Every tag, alphabetical, with how many snippets carry each. */
export function listSnippetTags(repo: CodeLibraryRepository): SnippetTaxonomyItem[] {
  return repo.listTags();
}

export function saveSnippetCategory(
  repo: CodeLibraryRepository,
  input: SnippetTaxonomyWriteInput,
): void {
  repo.saveCategory(snippetTaxonomyWriteSchema.parse(input));
}

export function saveSnippetTag(
  repo: CodeLibraryRepository,
  input: SnippetTaxonomyWriteInput,
): void {
  repo.saveTag(snippetTaxonomyWriteSchema.parse(input));
}

/**
 * Removes a category and every pairing to it.
 *
 * The name is validated rather than passed through: it reaches a `DELETE … WHERE
 * name = ?`, and a blank one would be a no-op that silently reported success.
 * The snippets filed under it are untouched — they simply lose the label.
 */
export function deleteSnippetCategory(repo: CodeLibraryRepository, name: string): void {
  repo.deleteCategory(snippetTaxonomyNameSchema.parse(name));
}

/** As `deleteSnippetCategory`, for tags. */
export function deleteSnippetTag(repo: CodeLibraryRepository, name: string): void {
  repo.deleteTag(snippetTaxonomyNameSchema.parse(name));
}
