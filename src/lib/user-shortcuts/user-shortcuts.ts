import type { NavigationTree } from "@/lib/navigation";
import { reorderShortcutsSchema, shortcutDraftSchema } from "./schema";
import type { ShortcutDraftInput } from "./schema";
import { DEFAULT_SHORTCUT_ICON, MAX_SHORTCUTS_PER_USER } from "./types";
import type { ResolvedShortcut, Shortcut, ShortcutDraft } from "./types";
import type { UserShortcutsRepository } from "./ports";

/**
 * What a write returns: the new list, or a reason it didn't happen.
 *
 * A result object rather than a thrown error, because every failure here is
 * something the reader can fix (the name is blank, the list is full) and a
 * dialog needs to render the reason beside the field. Genuine programming
 * errors still throw.
 */
export interface ShortcutResult {
  ok: boolean;
  error?: string;
  shortcuts?: Shortcut[];
  /**
   * The id of the row just created, on `addShortcut` only.
   *
   * Needed because an uploaded icon is a *second* write against a row that has
   * to exist first: the dialog creates the shortcut, then posts the picture
   * against the id that comes back. Without this the caller would have to guess
   * which of the returned shortcuts was the new one.
   */
  createdId?: number;
}

/** Fills the unused kind's columns with `""`, which is what the table stores. */
function toDraft(parsed: ReturnType<typeof shortcutDraftSchema.parse>): ShortcutDraft {
  return parsed.kind === "url"
    ? {
        kind: "url",
        name: parsed.name,
        icon: parsed.icon,
        url: parsed.url,
        moduleSlug: "",
        sectionId: "",
      }
    : {
        kind: "section",
        name: parsed.name,
        icon: parsed.icon,
        url: "",
        moduleSlug: parsed.moduleSlug,
        sectionId: parsed.sectionId,
      };
}

/** Turns a zod failure into the one message a form field can show. */
function firstIssue(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: { message: string }[] }).issues;
    if (issues.length > 0) return issues[0].message;
  }
  return "That shortcut isn't valid.";
}

/**
 * Adds a shortcut for one person.
 *
 * The cap is enforced here rather than in the repository: it is a product rule
 * about how big a home-screen card should get, not a storage constraint, and
 * the repository has no business knowing why twelve.
 */
export function addShortcut(
  repo: UserShortcutsRepository,
  userId: number,
  input: ShortcutDraftInput,
): ShortcutResult {
  const parsed = shortcutDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  if (repo.count(userId) >= MAX_SHORTCUTS_PER_USER) {
    return {
      ok: false,
      error: `You can keep up to ${MAX_SHORTCUTS_PER_USER} shortcuts. Remove one to add another.`,
    };
  }

  const created = repo.create(userId, toDraft(parsed.data));
  return { ok: true, shortcuts: repo.list(userId), createdId: created.id };
}

/**
 * Replaces one of this person's shortcuts.
 *
 * No cap check: editing cannot grow the list. No ownership check either — the
 * repository is scoped by `userId`, so someone else's id returns `undefined`
 * and falls out as a miss.
 */
export function editShortcut(
  repo: UserShortcutsRepository,
  userId: number,
  id: number,
  input: ShortcutDraftInput,
): ShortcutResult {
  const parsed = shortcutDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const updated = repo.update(userId, id, toDraft(parsed.data));
  if (!updated) return { ok: false, error: "That shortcut no longer exists." };

  return { ok: true, shortcuts: repo.list(userId) };
}

/** Removes one. A miss is reported rather than silently succeeding. */
export function removeShortcut(
  repo: UserShortcutsRepository,
  userId: number,
  id: number,
): ShortcutResult {
  if (!repo.delete(userId, id)) return { ok: false, error: "That shortcut no longer exists." };
  return { ok: true, shortcuts: repo.list(userId) };
}

/** Writes a new order for the whole list. */
export function reorderShortcuts(
  repo: UserShortcutsRepository,
  userId: number,
  ids: number[],
): ShortcutResult {
  const parsed = reorderShortcutsSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  repo.reorder(userId, parsed.data);
  return { ok: true, shortcuts: repo.list(userId) };
}

/**
 * Moves one shortcut a single place, returning the ids in their new order.
 *
 * A pure list operation, so the caller can hand the result straight to
 * `reorderShortcuts`. One already at the end it is moving toward comes back
 * unchanged rather than wrapping — wrapping would make a held-down button cycle
 * forever, the same reasoning `moveHomeWidget` records.
 */
export function moveShortcut(
  shortcuts: readonly Shortcut[],
  id: number,
  direction: "up" | "down",
): number[] {
  const ids = shortcuts.map((shortcut) => shortcut.id);
  const index = ids.indexOf(id);
  if (index === -1) return ids;

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ids.length) return ids;

  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Resolves one stored shortcut against the reader's live navigation tree.
 *
 * This is the heart of the module, and the reason targets are stored as
 * coordinates instead of as a path.
 *
 * A **URL** shortcut always resolves: it points outside the app, so there is
 * nothing here that could revoke it.
 *
 * A **section** shortcut is re-resolved every time, which answers two questions
 * a stored href could not:
 *
 *  - *Does the target still exist?* A section removed in a later release, or a
 *    module deleted outright, is reported rather than drawn as a tile that 404s.
 *  - *May this reader still follow it?* The tree passed in is already filtered
 *    to the modules this person can reach (`getNavTreeData` builds it from
 *    `getAccessibleModules`), so a module missing from it is a module they have
 *    lost access to. Access is therefore re-checked on every render and never
 *    trusted from the stored row — which is the whole security property here.
 *
 * Unreachable shortcuts come back marked, not filtered out. The caller decides
 * how to show them; hiding them silently would look like data loss to the only
 * person who can fix them.
 */
export function resolveShortcut(shortcut: Shortcut, tree: NavigationTree): ResolvedShortcut {
  const base = {
    id: shortcut.id,
    name: shortcut.name,
    // An icon retired from the glyph set falls back rather than rendering
    // nothing — the row stays readable, matching how `resolveHomeWidgets`
    // tolerates a widget id it no longer knows.
    icon: shortcut.icon || DEFAULT_SHORTCUT_ICON,
    // An upload wins over the glyph. The glyph is still carried above, because
    // it is what the tile falls back to the moment the picture is cleared.
    //
    // The cache-buster is `updatedAt`, which the `setIcon`/`clearIcon` writes
    // bump via the table's trigger — so replacing a picture changes the URL and
    // the browser fetches the new one, while an unchanged icon keeps being
    // served from cache for the route's five minutes.
    iconImageUrl: shortcut.hasIconImage
      ? `/api/shortcuts/${shortcut.id}/icon?v=${encodeURIComponent(shortcut.updatedAt)}`
      : undefined,
    kind: shortcut.kind,
    // Carried through untouched so the edit dialog can reopen on what was
    // saved — including for an unreachable shortcut, which has no href to
    // derive anything from. See the field's comment in `types.ts`.
    target: {
      kind: shortcut.kind,
      url: shortcut.url,
      moduleSlug: shortcut.moduleSlug,
      sectionId: shortcut.sectionId,
    },
  };

  if (shortcut.kind === "url") {
    return { ...base, href: shortcut.url, reachable: true };
  }

  const treeModule = tree.modules.find((candidate) => candidate.slug === shortcut.moduleSlug);
  if (!treeModule) {
    return {
      ...base,
      href: "",
      reachable: false,
      unreachableReason: "That module is no longer available to you.",
    };
  }

  // An empty section id means the module root itself, which is why there is no
  // separate `module` kind — see the migration log.
  if (shortcut.sectionId === "") {
    return { ...base, href: treeModule.href, reachable: true };
  }

  const section = treeModule.sections.find((candidate) => candidate.id === shortcut.sectionId);
  if (!section) {
    return {
      ...base,
      href: "",
      reachable: false,
      unreachableReason: `That page no longer exists in ${treeModule.name}.`,
    };
  }

  return { ...base, href: section.href, reachable: true };
}

/** Every one of this person's shortcuts, resolved for drawing. Order is preserved. */
export function resolveShortcuts(
  shortcuts: readonly Shortcut[],
  tree: NavigationTree,
): ResolvedShortcut[] {
  return shortcuts.map((shortcut) => resolveShortcut(shortcut, tree));
}

/**
 * Stores an uploaded picture as one shortcut's icon.
 *
 * The bytes arrive already decoded and downscaled — decoding is the shared
 * `decodeImageUpload`'s job (it owns the mime allowlist, and excludes SVG
 * because these are served from our own origin), and downscaling belongs to the
 * image processor in the adapter. What is left for the use-case is the part
 * that is actually about shortcuts: that the row is this person's.
 */
export function setShortcutIcon(
  repo: UserShortcutsRepository,
  userId: number,
  id: number,
  image: { data: Buffer; mimeType: string },
): ShortcutResult {
  if (!repo.setIcon(userId, id, image)) {
    return { ok: false, error: "That shortcut no longer exists." };
  }
  return { ok: true, shortcuts: repo.list(userId) };
}

/**
 * Drops the uploaded picture, so the tile goes back to its glyph.
 *
 * Not a delete of the shortcut, and not a blanking of the icon: `icon` is
 * always populated, so this reveals what was underneath rather than leaving
 * the tile with nothing to draw.
 */
export function clearShortcutIcon(
  repo: UserShortcutsRepository,
  userId: number,
  id: number,
): ShortcutResult {
  if (!repo.clearIcon(userId, id)) {
    return { ok: false, error: "That shortcut no longer exists." };
  }
  return { ok: true, shortcuts: repo.list(userId) };
}

/**
 * Whether this person can add another.
 *
 * Exported so the card can disable its Add button with the same rule the
 * use-case enforces, rather than the view hardcoding the number and the two
 * drifting apart.
 */
export function canAddShortcut(count: number): boolean {
  return count < MAX_SHORTCUTS_PER_USER;
}
