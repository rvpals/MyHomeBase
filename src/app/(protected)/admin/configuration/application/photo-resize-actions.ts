"use server";

import { deps } from "@/lib/wiring";
// Imported from the LEAF, not from `@/lib/journal-photos`. The barrel re-exports
// `SharpPhotoThumbnailRenderer`, which pulls in the `sharp` native binding; a server
// action file is fine either way, but the control beside this one is a client component
// and the leaf keeps the rule consistent for both. Same reason as the system-log control
// importing from `system-log/schema`.
import {
  PHOTO_THUMBNAIL_SETTING_KEYS,
  photoThumbnailResizeValue,
  resolvePhotoThumbnailSettings,
} from "@/lib/journal-photos/thumbnail-settings";
import { requireAdmin } from "../../../require-access";

// The server-side photo resize switch, on Application Configuration.
//
// Its own action rather than the admin shell's Save button, for the same reason as the
// system log's switches next to it: the shell models `sys_app_settings` as named fields
// (`applicationName`, `colorThemeId`, …) rather than an open key/value draft, so carrying
// one more boolean through it would widen a shared type for one screen.
//
// It also suits what this is. The switch is an escape hatch -- you reach for it because
// thumbnails are misbehaving right now -- and a Save button you have to remember
// afterwards is how you end up staring at a strip that is still resizing.
//
// NO `revalidatePath`. Nothing renders this server-side: the switch is read per request
// inside `/api/journal/photos/thumb`, which is not a cached route segment. The browser's
// own `private, max-age=3600` on already-fetched tiles is the real staleness, and no
// server-side invalidation reaches that -- the control says so on screen.

/** Whether the server may shrink an original. For the control's initial state. */
export async function loadPhotoResizeSettingAction(): Promise<boolean> {
  await requireAdmin();
  return resolvePhotoThumbnailSettings(deps.settingsRepo.listSettings()).resizeOriginals;
}

/**
 * Turns resizing on or off, and returns the stored state.
 *
 * `setValue` rather than `updateAll`: the shared update schema is what the Application
 * Configuration screen posts for its draft, and writing one key through it would mean
 * loosening a schema that protects every other setting. Same split as the system log's.
 */
export async function setPhotoResizeSettingAction(enabled: boolean): Promise<boolean> {
  await requireAdmin();

  deps.settingsRepo.setValue(
    PHOTO_THUMBNAIL_SETTING_KEYS.resizeOriginals,
    photoThumbnailResizeValue(enabled),
  );

  return resolvePhotoThumbnailSettings(deps.settingsRepo.listSettings()).resizeOriginals;
}
