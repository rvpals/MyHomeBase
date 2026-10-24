// The Clips use-cases: functions that take data and return data.
//
// Every one of these is reachable identically from the web app and from the CLI —
// they take a repository through their parameters and never construct one. The
// composition root in `wiring.ts` supplies the real thing; a test supplies a fake.

import { decryptText, displayTitle, encryptText } from "@/lib/shared/encryption";
import { decodeImageUpload } from "@/lib/shared/image-upload";
import type { ClipImageProcessor, ClipsRepository, ClipWriteData } from "./ports";
import {
  CLIP_IMAGE_MAX_BYTES,
  CLIP_IMAGE_MAX_EDGE,
  CLIP_MAX_IMAGES,
  clipFilterSchema,
  clipImageUploadSchema,
  clipPasswordSchema,
  clipTaxonomySchema,
  createClipSchema,
  encryptClipSchema,
  linkClipSchema,
  unlinkClipSchema,
  updateClipSchema,
  type ClipFilterInput,
  type ClipImageUploadInput,
  type ClipPasswordInput,
  type ClipTaxonomyInput,
  type CreateClipInput,
  type EncryptClipInput,
  type LinkClipInput,
  type UnlinkClipInput,
  type UpdateClipInput,
} from "./schema";
import { buildClipExcerpt, sanitizeClipHtml } from "./sanitize-html";
import type { Clip, ClipImage, ClipLinkModule, ClipSummary, ClipTaxonomyItem } from "./types";

/** Thrown when a clip id does not exist. */
export class ClipNotFoundError extends Error {
  constructor(id: number) {
    super(`No clip with id ${id}.`);
    this.name = "ClipNotFoundError";
  }
}

/**
 * Thrown when an operation needs the clip's plaintext but the clip is sealed.
 *
 * Separate from `WrongPasswordError`: this one means "you did not supply a
 * password at all", which is a different thing for the UI to say.
 */
export class ClipIsEncryptedError extends Error {
  constructor() {
    super("That clip is encrypted. Open it with its password first.");
    this.name = "ClipIsEncryptedError";
  }
}

/** Thrown when a clip already holds as many images as it may. */
export class TooManyClipImagesError extends Error {
  constructor() {
    super(`A clip can hold at most ${CLIP_MAX_IMAGES} images.`);
    this.name = "TooManyClipImagesError";
  }
}

/**
 * Normalises a taxonomy list: trimmed, de-duplicated case-insensitively, order kept.
 *
 * Case-insensitive because "Work" and "work" are indistinguishable to a reader
 * glancing at two chips, and the taxonomy tables index their names `COLLATE NOCASE`
 * for the same reason. The **first** spelling wins, so what the reader typed is what
 * is stored.
 */
function normaliseNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (name === "") continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Turns validated input into what the repository stores.
 *
 * The sanitiser runs **here**, in the use-case, rather than in the schema or the
 * repository: it is a transformation with a result worth reporting ("your table's
 * styling was dropped"), not a yes/no boundary check, and running it here means the
 * CLI and the web app sanitise identically.
 */
function toWriteData(
  input: CreateClipInput,
  createdBy: number | null,
): { data: ClipWriteData; removed: string[] } {
  const { html, removed } = sanitizeClipHtml(input.contentHtml);
  return {
    data: {
      title: input.title.trim(),
      contentHtml: html,
      categories: normaliseNames(input.categories),
      tags: normaliseNames(input.tags),
      createdBy,
    },
    removed,
  };
}

/** What a write returns: the stored clip, plus anything the sanitiser took out. */
export interface ClipWriteResult {
  clip: Clip;
  /** Empty when the markup was already clean. Shown to the reader after a paste. */
  removed: string[];
}

/** The list, filtered. An empty filter is the whole list, newest first. */
export function listClips(repo: ClipsRepository, filter: Partial<ClipFilterInput> = {}): ClipSummary[] {
  return repo.listClips(clipFilterSchema.parse(filter));
}

/**
 * One clip in full.
 *
 * A sealed clip comes back with its ciphertext and blank plaintext — this does not
 * decrypt. `openClip` is the use-case that needs a password.
 */
export function getClip(repo: ClipsRepository, id: number): Clip {
  const clip = repo.getClipById(id);
  if (!clip) throw new ClipNotFoundError(id);
  return clip;
}

export function createClip(
  repo: ClipsRepository,
  input: CreateClipInput,
  createdBy: number | null = null,
): ClipWriteResult {
  const validated = createClipSchema.parse(input);
  const { data, removed } = toWriteData(validated, createdBy);

  // Inline creation: writing a clip may name a category or tag that does not exist
  // yet, exactly as the journal's entry form does. Creating them here keeps the
  // managed lists complete, so the Categories & Tags screen never shows a shorter
  // list than the chips on the clips do.
  for (const name of data.categories) repo.upsertCategory(name, "");
  for (const name of data.tags) repo.upsertTag(name, "");

  return { clip: repo.createClip(data), removed };
}

/**
 * Replaces a clip's own fields and its taxonomy.
 *
 * Refuses a sealed clip: its plaintext is not available to merge against, so an
 * update would silently discard the sealed body. The caller unseals first.
 */
export function updateClip(
  repo: ClipsRepository,
  input: UpdateClipInput,
): ClipWriteResult {
  const validated = updateClipSchema.parse(input);
  const existing = repo.getClipById(validated.id);
  if (!existing) throw new ClipNotFoundError(validated.id);
  if (existing.isEncrypted) throw new ClipIsEncryptedError();

  const { data, removed } = toWriteData(validated, existing.createdBy);
  for (const name of data.categories) repo.upsertCategory(name, "");
  for (const name of data.tags) repo.upsertTag(name, "");

  return { clip: repo.updateClip(validated.id, data), removed };
}

/**
 * Deletes a clip and everything belonging to it.
 *
 * The only path that deletes a clip. Nothing in another module can trigger this:
 * a clip outlives whatever it was linked to, which is the module's central promise.
 */
export function deleteClip(repo: ClipsRepository, id: number): void {
  if (!repo.getClipById(id)) throw new ClipNotFoundError(id);
  repo.deleteClip(id);
}

/**
 * Seals a clip behind a password.
 *
 * **There is no recovery.** Unlike a journal entry — which is one person's — a clip
 * is shared, so a forgotten password loses it for everyone granted the module. The
 * UI must say so before calling this.
 */
export function encryptClip(repo: ClipsRepository, input: EncryptClipInput): Clip {
  const validated = encryptClipSchema.parse(input);
  const existing = repo.getClipById(validated.id);
  if (!existing) throw new ClipNotFoundError(validated.id);
  // Already sealed: re-sealing would encrypt the blank plaintext columns and throw
  // away the real content, which is unrecoverable. Refuse instead.
  if (existing.isEncrypted) throw new ClipIsEncryptedError();

  return repo.sealClip(validated.id, {
    titleEncrypted: encryptText(existing.title, validated.password),
    contentEncrypted: encryptText(existing.contentHtml, validated.password),
    passwordHint: validated.passwordHint,
  });
}

/** A sealed clip's plaintext, for display. Does not change what is stored. */
export function openClip(
  repo: ClipsRepository,
  input: ClipPasswordInput,
): { title: string; contentHtml: string } {
  const validated = clipPasswordSchema.parse(input);
  const existing = repo.getClipById(validated.id);
  if (!existing) throw new ClipNotFoundError(validated.id);
  if (!existing.isEncrypted) {
    return { title: existing.title, contentHtml: existing.contentHtml };
  }

  // Throws WrongPasswordError from @/lib/shared/encryption when the password is
  // wrong — the GCM tag is the check, so there is no separate verifier to consult.
  return {
    title: decryptText(existing.titleEncrypted, validated.password),
    contentHtml: decryptText(existing.contentEncrypted, validated.password),
  };
}

/** Unseals permanently: writes the plaintext back and clears the sealed columns. */
export function decryptClip(repo: ClipsRepository, input: ClipPasswordInput): Clip {
  const validated = clipPasswordSchema.parse(input);
  const existing = repo.getClipById(validated.id);
  if (!existing) throw new ClipNotFoundError(validated.id);
  if (!existing.isEncrypted) return existing;

  const title = decryptText(existing.titleEncrypted, validated.password);
  const contentHtml = decryptText(existing.contentEncrypted, validated.password);
  return repo.unsealClip(validated.id, title, contentHtml);
}

/**
 * Adds a pasted image to a clip and returns the stored row.
 *
 * The caller rewrites the clip's body to point at `/api/clips/images/<id>`; the
 * bytes never travel inside `contentHtml`. See `types.ts` for why that matters.
 */
export async function addClipImage(
  repo: ClipsRepository,
  processor: ClipImageProcessor,
  clipId: number,
  input: ClipImageUploadInput,
): Promise<ClipImage> {
  const validated = clipImageUploadSchema.parse(input);
  if (!repo.getClipById(clipId)) throw new ClipNotFoundError(clipId);

  if (repo.listClipImages(clipId).length >= CLIP_MAX_IMAGES) {
    throw new TooManyClipImagesError();
  }

  // Cap checked on the decoded length, not the base64 string, which is ~33% longer.
  const decoded = decodeImageUpload(validated, CLIP_IMAGE_MAX_BYTES);
  const prepared = await processor.prepare(decoded, CLIP_IMAGE_MAX_EDGE);
  return repo.addClipImage(clipId, prepared.image, prepared.width, prepared.height);
}

export function deleteClipImage(repo: ClipsRepository, id: number): void {
  repo.deleteClipImage(id);
}

/**
 * Attaches a clip to a record in another module.
 *
 * Deliberately does **not** check that the target exists. Clips does not import
 * another module's repository — that would be the import cycle `ARCHITECTURE.md`
 * forbids — and a link whose target is later deleted is a normal state here anyway
 * (`types.ts` → `ClipLink`). The viewer renders a missing target as "gone" rather
 * than as an error, so validating it now would buy nothing and cost the boundary.
 */
export function linkClip(repo: ClipsRepository, input: LinkClipInput) {
  const validated = linkClipSchema.parse(input);
  if (!repo.getClipById(validated.clipId)) throw new ClipNotFoundError(validated.clipId);
  return repo.createLink(validated.clipId, validated.targetModule, validated.targetId);
}

export function unlinkClip(repo: ClipsRepository, input: UnlinkClipInput): void {
  const validated = unlinkClipSchema.parse(input);
  repo.deleteLink(validated.linkId);
}

/** Every clip attached to one record — what the journal's viewer lists. */
export function listClipsForTarget(
  repo: ClipsRepository,
  targetModule: ClipLinkModule,
  targetId: number,
): ClipSummary[] {
  return repo.listClips(
    clipFilterSchema.parse({ targetModule, targetId }),
  );
}

/**
 * How many clips are attached to each of these records.
 *
 * One query for the whole page — a list of 200 journal entries must not cost 200
 * round trips. Ids with no clips are absent from the map rather than present with 0,
 * so a caller can test with `?? 0` and never iterate empties.
 */
export function countClipsForTargets(
  repo: ClipsRepository,
  targetModule: ClipLinkModule,
  targetIds: number[],
): Map<number, number> {
  if (targetIds.length === 0) return new Map();
  return repo.countLinksForTargets(targetModule, targetIds);
}

// Taxonomy

export function listClipCategories(repo: ClipsRepository): ClipTaxonomyItem[] {
  return repo.listCategories();
}

export function listClipTags(repo: ClipsRepository): ClipTaxonomyItem[] {
  return repo.listTags();
}

export function saveClipCategory(repo: ClipsRepository, input: ClipTaxonomyInput): ClipTaxonomyItem {
  const validated = clipTaxonomySchema.parse(input);
  return repo.upsertCategory(validated.name, validated.description);
}

export function saveClipTag(repo: ClipsRepository, input: ClipTaxonomyInput): ClipTaxonomyItem {
  const validated = clipTaxonomySchema.parse(input);
  return repo.upsertTag(validated.name, validated.description);
}

export function deleteClipCategory(repo: ClipsRepository, name: string): void {
  repo.deleteCategory(name);
}

export function deleteClipTag(repo: ClipsRepository, name: string): void {
  repo.deleteTag(name);
}

/**
 * The list-row projection of a clip.
 *
 * Exported because the repository builds summaries and a test needs the same rule:
 * a sealed clip shows "(encrypted)" and **no excerpt**, since there is no plaintext
 * to preview and deriving one from ciphertext would be noise.
 */
export function toClipSummary(
  clip: Clip,
  imageCount: number,
  linkCount: number,
): ClipSummary {
  return {
    id: clip.id,
    title: displayTitle(clip.title, clip.isEncrypted),
    excerpt: clip.isEncrypted ? "" : buildClipExcerpt(clip.contentHtml),
    isEncrypted: clip.isEncrypted,
    categories: clip.categories,
    tags: clip.tags,
    imageCount,
    linkCount,
    createdAt: clip.createdAt,
    updatedAt: clip.updatedAt,
  };
}

