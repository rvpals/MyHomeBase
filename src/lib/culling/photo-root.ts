import { resolveJournalPreferences } from "../journal";
import { DEFAULT_CULL_IMAGES } from "./config";
import { CULLING_MODULE_SLUG, resolveCullingSettings } from "./settings";
import { listModuleSettingsFor } from "../module-settings";
import { getModuleBySlug } from "../modules";
import { deps } from "../wiring";

// Where the archive path comes from for a culling run.
//
// The same answer `app/(protected)/modules/[slug]/journal-photo-root.ts` gives the web
// layer, re-derived here rather than imported because `src/lib` may not import from
// `src/app` -- that direction is the whole point of the layering. Kept to the one
// function the CLI needs rather than copying the whole file.

const JOURNAL_MODULE_SLUG = "journal";

/**
 * The configured archive path: the Journal module's `photo_root` setting, falling back
 * to `MYHOMEBASE_PHOTO_ROOT`, else `""`.
 *
 * The setting wins because it is the one an admin can fix in the browser; the env var
 * stays so an install configured that way keeps working. `""` means not configured,
 * and `cullFolder` reports that rather than guessing a default -- a wrong guess here
 * would rank some arbitrary folder.
 *
 * @returns The archive root, or `""` when nothing is configured.
 */
export function configuredPhotoRoot(): string {
  const journalModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
  if (!journalModule) return deps.photoRootFromEnv;

  const preferences = resolveJournalPreferences(
    listModuleSettingsFor(deps.moduleSettingsRepo, journalModule.id),
  );
  return preferences.photoRoot !== "" ? preferences.photoRoot : deps.photoRootFromEnv;
}

/**
 * The configured culling ceiling: Picture Gallery's `culling_max_images` setting,
 * falling back to the built-in default.
 *
 * Read here rather than in each action so there is one answer to "how many may we
 * decode", whichever module is asking. The Journal's photo dialog and the gallery's
 * three sections share the ceiling deliberately — it limits one operation's cost, and
 * that cost does not change with the screen it was started from.
 *
 * @returns A usable ceiling; a missing or broken row resolves to the default.
 */
export function configuredCullCeiling(): number {
  const galleryModule = getModuleBySlug(deps.moduleRepo, CULLING_MODULE_SLUG);
  if (!galleryModule) return DEFAULT_CULL_IMAGES;

  return resolveCullingSettings(
    listModuleSettingsFor(deps.moduleSettingsRepo, galleryModule.id),
  ).maxCullImages;
}
