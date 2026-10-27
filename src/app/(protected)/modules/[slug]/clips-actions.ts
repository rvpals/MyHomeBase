"use server";

import { revalidatePath } from "next/cache";
import {
  addClipImage,
  createClip,
  decryptClip,
  deleteClip,
  deleteClipCategory,
  deleteClipTag,
  encryptClip,
  getClip,
  linkClip,
  listClipItems,
  listClips,
  listClipsForTarget,
  openClip,
  saveClipCategory,
  saveClipItems,
  saveClipTag,
  setClipColor,
  setClipExcerptChars,
  setClipPinned,
  toggleClipItem,
  unlinkClip,
  updateClip,
  type Clip,
  type ClipCardColor,
  type ClipImageUploadInput,
  type ClipItem,
  type ClipSummary,
  type CreateClipInput,
  type EncryptClipInput,
  type ResolvedClipLink,
  type UpdateClipInput,
} from "@/lib/clips";
// The Journal, read from the presentation layer so `src/lib/clips` never imports
// `src/lib/journal`. See the note above the link actions below.
import { displayEntryTitle, getEntry, listRecentEntries, searchEntries } from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { requireAdmin, requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "clips";

const CLIPS_PATH = "/modules/clips";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

// Every export below opens with `requireModuleAccess`, INSIDE the try so a denial
// renders as an inline error rather than an unhandled rejection. A server action is
// its own POST endpoint: neither the `(protected)` layout nor the page's own access
// check runs before one fires, so hiding the module from the tree does nothing to
// stop these being invoked directly.
//
// The read actions carry the guard too. A `list…`/`get…` leaks another module's data
// just as effectively as a write corrupts it — and a clip can hold a pasted email.

export interface ClipResult extends ActionResult {
  clip?: Clip;
  /** What the sanitizer stripped, so the editor can tell the reader. */
  removed?: string[];
  /**
   * The clip's checklist, on the reads that fetch a full record.
   *
   * Carried here rather than fetched separately so the editor opens in one round
   * trip — the items and the body are both needed to draw it, and two actions would
   * mean two loading states for one panel.
   */
  items?: ClipItem[];
}

export interface ClipListResult extends ActionResult {
  clips?: ClipSummary[];
}

export async function listClipsAction(filter: {
  search?: string;
  categories?: string[];
  tags?: string[];
}): Promise<ClipListResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    return { ok: true, clips: listClips(deps.clipsRepo, filter) };
  } catch (error) {
    return toErrorResult(error, "Could not load the clips.");
  }
}

export async function getClipAction(id: number): Promise<ClipResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    return {
      ok: true,
      clip: getClip(deps.clipsRepo, id),
      items: listClipItems(deps.clipsRepo, id),
    };
  } catch (error) {
    return toErrorResult(error, "Could not load that clip.");
  }
}

export async function createClipAction(input: CreateClipInput): Promise<ClipResult> {
  try {
    const user = await requireModuleAccess(ACCESS_MODULE_SLUG);
    const { clip, removed } = createClip(deps.clipsRepo, input, user.id);
    revalidatePath(CLIPS_PATH);
    return { ok: true, clip, removed };
  } catch (error) {
    return toErrorResult(error, "Could not save that clip.");
  }
}

export async function updateClipAction(input: UpdateClipInput): Promise<ClipResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const { clip, removed } = updateClip(deps.clipsRepo, input);
    revalidatePath(CLIPS_PATH);
    return { ok: true, clip, removed };
  } catch (error) {
    return toErrorResult(error, "Could not save that clip.");
  }
}

export async function deleteClipAction(id: number): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    deleteClip(deps.clipsRepo, id);
    revalidatePath(CLIPS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not delete that clip.");
  }
}

// Encryption.
//
// There is no recovery: a forgotten password loses the clip for everyone granted
// the module, because clips are shared. The dialog says so before calling this.

export async function encryptClipAction(input: EncryptClipInput): Promise<ClipResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const clip = encryptClip(deps.clipsRepo, input);
    revalidatePath(CLIPS_PATH);
    return { ok: true, clip };
  } catch (error) {
    return toErrorResult(error, "Could not encrypt that clip.");
  }
}

export interface OpenClipResult extends ActionResult {
  title?: string;
  contentHtml?: string;
}

/** Reads a sealed clip's plaintext for display. Does not change what is stored. */
export async function openClipAction(id: number, password: string): Promise<OpenClipResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const text = openClip(deps.clipsRepo, { id, password });
    return { ok: true, ...text };
  } catch (error) {
    // WrongPasswordError's message is already the one to show, and it deliberately
    // does not distinguish a wrong password from altered bytes — GCM cannot tell
    // them apart, and inventing a distinction would mean trusting something other
    // than the authentication tag.
    return toErrorResult(error, "Could not open that clip.");
  }
}

/** Unseals permanently. */
export async function decryptClipAction(id: number, password: string): Promise<ClipResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const clip = decryptClip(deps.clipsRepo, { id, password });
    revalidatePath(CLIPS_PATH);
    return { ok: true, clip };
  } catch (error) {
    return toErrorResult(error, "Could not decrypt that clip.");
  }
}

export interface ClipImageResult extends ActionResult {
  /** Where the stored image is served from, for the editor to insert. */
  url?: string;
}

/**
 * Stores one pasted image and returns its serving URL.
 *
 * The editor calls this per image as the paste lands, then inserts `<img>` tags
 * pointing at what comes back — the bytes never travel inside the clip's HTML.
 */
export async function addClipImageAction(
  clipId: number,
  input: ClipImageUploadInput,
): Promise<ClipImageResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const image = await addClipImage(deps.clipsRepo, deps.clipImageProcessor, clipId, input);
    return { ok: true, url: `/api/clips/images/${image.id}` };
  } catch (error) {
    return toErrorResult(error, "Could not save that image.");
  }
}

// Links.
//
// The two reads below are the one place this module touches the Journal, and they
// do it HERE rather than in `src/lib/clips`: a server action is presentation, so it
// may compose both modules. Putting a journal read inside the Clips library would
// make the two import each other — the cycle ARCHITECTURE.md forbids.

/** One journal entry, as the attach picker and the "Attached to" list show it. */
export interface JournalEntryRef {
  id: number;
  date: string;
  title: string;
  isEncrypted: boolean;
}

export interface EntrySearchResult extends ActionResult {
  entries?: JournalEntryRef[];
}

/**
 * Journal entries to attach a clip to.
 *
 * A blank term lists the most recent entries rather than nothing, because the
 * entry someone wants to attach to is usually the one they just wrote. The
 * library's `searchEntries` deliberately matches nothing on a blank term, which is
 * right for a search box and wrong for a picker that opens empty.
 */
export async function searchJournalEntriesForClipAction(
  term: string,
): Promise<EntrySearchResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);

    const entries =
      term.trim() === ""
        ? listRecentEntries(deps.journalRepo, 20)
        : searchEntries(deps.journalRepo, term, 20);

    return { ok: true, entries: entries.map(toEntryRef) };
  } catch (error) {
    return toErrorResult(error, "Could not search the journal.");
  }
}

export interface ClipLinksResult extends ActionResult {
  links?: ResolvedClipLink[];
}

/**
 * One clip's links, each resolved against the entry it points at.
 *
 * A link whose entry is gone comes back with no `targetTitle` and no `targetHref`.
 * That is a normal state, not an error: a clip outlives whatever it was attached
 * to, which is the module's central promise. The viewer renders it as "the linked
 * entry is gone" rather than hiding the row — hiding it would make a clip look
 * unattached when it is really attached to something deleted.
 */
export async function listClipLinksAction(clipId: number): Promise<ClipLinksResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);

    const links = deps.clipsRepo.listLinksForClip(clipId).map((link): ResolvedClipLink => {
      const entry = getEntry(deps.journalRepo, link.targetId);
      if (!entry) return link;

      return {
        ...link,
        // An encrypted entry's title is blank in the column (migration 0131), so
        // the placeholder stands in — the same thing every journal screen shows.
        targetTitle: `${entry.date} — ${displayEntryTitle(entry.title, entry.isEncrypted)}`,
        targetHref: `/modules/journal/entries?entry=${entry.id}`,
      };
    });

    return { ok: true, links };
  } catch (error) {
    return toErrorResult(error, "Could not load this clip's links.");
  }
}

/**
 * Clips to attach to an entry, for the entry form's picker.
 *
 * A blank term lists the most recent clips rather than nothing — the mirror of
 * `searchJournalEntriesForClipAction`, and for the same reason: the clip someone
 * wants to attach is usually one they just wrote.
 *
 * Sealed clips are listed. Their titles read "(encrypted)" and they carry no
 * excerpt, but attaching one is a link, not a read: there is no reason to need the
 * password to say "this supports that entry".
 */
export async function searchClipsForEntryAction(term: string): Promise<ClipListResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    return { ok: true, clips: listClips(deps.clipsRepo, { search: term }).slice(0, 20) };
  } catch (error) {
    return toErrorResult(error, "Could not search the clips.");
  }
}

/** Every clip attached to one journal entry — what the entry's badge opens. */
export async function listClipsForEntryAction(entryId: number): Promise<ClipListResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    return { ok: true, clips: listClipsForTarget(deps.clipsRepo, "journal", entryId) };
  } catch (error) {
    return toErrorResult(error, "Could not load the clips on that entry.");
  }
}

function toEntryRef(entry: {
  id: number;
  date: string;
  title: string;
  isEncrypted: boolean;
}): JournalEntryRef {
  return {
    id: entry.id,
    date: entry.date,
    title: displayEntryTitle(entry.title, entry.isEncrypted),
    isEncrypted: entry.isEncrypted,
  };
}

export async function linkClipAction(clipId: number, entryId: number): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    linkClip(deps.clipsRepo, { clipId, targetModule: "journal", targetId: entryId });
    revalidatePath(CLIPS_PATH);
    // The journal's entry screens draw the badge from this, so they need
    // revalidating too — the link changed what those pages should render.
    revalidatePath("/modules/journal");
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not attach that clip.");
  }
}

export async function unlinkClipAction(linkId: number): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    unlinkClip(deps.clipsRepo, { linkId });
    revalidatePath(CLIPS_PATH);
    revalidatePath("/modules/journal");
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not detach that clip.");
  }
}

// Taxonomy.

export async function saveClipCategoryAction(
  name: string,
  description: string,
): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    saveClipCategory(deps.clipsRepo, { name, description });
    revalidatePath(CLIPS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not save that category.");
  }
}

export async function saveClipTagAction(name: string, description: string): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    saveClipTag(deps.clipsRepo, { name, description });
    revalidatePath(CLIPS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not save that tag.");
  }
}

export async function deleteClipCategoryAction(name: string): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    deleteClipCategory(deps.clipsRepo, name);
    revalidatePath(CLIPS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not delete that category.");
  }
}

export async function deleteClipTagAction(name: string): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    deleteClipTag(deps.clipsRepo, name);
    revalidatePath(CLIPS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not delete that tag.");
  }
}

// Board actions: pinning, colour, and the checklist.
//
// Each opens with `requireModuleAccess` on its first line inside the try, exactly as
// every action above does — an action is its own POST endpoint, so nothing the page
// or the layout checks protects these.

export interface ClipItemsResult extends ActionResult {
  items?: ClipItem[];
}

export async function setClipPinnedAction(
  id: number,
  isPinned: boolean,
): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    setClipPinned(deps.clipsRepo, { id, isPinned });
    revalidatePath(CLIPS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not pin that clip.");
  }
}

export async function setClipColorAction(id: number, color: string): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    // Cast at the boundary only: the schema inside the use-case is what actually
    // validates the key, so an unknown colour still fails there rather than here.
    setClipColor(deps.clipsRepo, { id, color: color as ClipCardColor | "" });
    revalidatePath(CLIPS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not recolour that clip.");
  }
}

export async function saveClipItemsAction(
  clipId: number,
  items: { id?: number; text: string; isDone?: boolean }[],
): Promise<ClipItemsResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const saved = saveClipItems(deps.clipsRepo, {
      clipId,
      items: items.map((item) => ({
        id: item.id,
        text: item.text,
        isDone: item.isDone ?? false,
      })),
    });
    revalidatePath(CLIPS_PATH);
    return { ok: true, items: saved };
  } catch (error) {
    return toErrorResult(error, "Could not save that checklist.");
  }
}

/**
 * Ticks or un-ticks one item.
 *
 * Deliberately does NOT `revalidatePath`. A tick is a single click on a board that
 * may hold forty cards, and re-rendering the whole route on each one would make a
 * checklist feel like a page load. The card updates its own state optimistically and
 * the next navigation picks up the stored value.
 */
export async function toggleClipItemAction(
  itemId: number,
  isDone: boolean,
): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    toggleClipItem(deps.clipsRepo, { itemId, isDone });
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not update that item.");
  }
}

/**
 * Saves how much of a clip a card shows.
 *
 * `requireAdmin` rather than `requireModuleAccess`: this is a module-wide setting
 * stored in `sys_module_settings`, so one reader changing it changes every reader's
 * board — the same reason the other module Configuration screens are admin-only.
 */
export async function setClipExcerptCharsAction(value: number): Promise<ActionResult> {
  try {
    await requireAdmin();
    setClipExcerptChars(deps.moduleRepo, deps.moduleSettingsRepo, value);
    revalidatePath(CLIPS_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not save that setting.");
  }
}
