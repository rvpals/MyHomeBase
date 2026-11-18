"use server";

import { getHomeAlbumSlideshow, type HomeAlbumSlides } from "@/lib/albums";
import { homeAlbumIdSchema, saveHomeAlbum } from "@/lib/user-preferences";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "./require-access";

/** The Picture Gallery's full slug — albums are that module's data. */
const GALLERY_MODULE_SLUG = "picture-gallery";

export type SelectHomeAlbumResult =
  | { ok: true; album: HomeAlbumSlides }
  | { ok: false; error: string };

/**
 * Switches the home screen's Photo Albums card to another album, remembering the choice
 * for this reader, and returns that album's photos so the card can start cycling
 * without a page reload.
 *
 * `requireModuleAccess("picture-gallery")` on the first line: the card is home-screen
 * chrome, but what it reads is the gallery's albums, and an action is its own POST
 * endpoint — hiding the card from someone without the module gates nothing by itself.
 *
 * The session decides whose preference this is; the client never supplies a user id.
 * Not `revalidatePath`: the card already holds the new album in state.
 */
export async function selectHomeAlbumAction(albumId: unknown): Promise<SelectHomeAlbumResult> {
  const currentUser = await requireModuleAccess(GALLERY_MODULE_SLUG);

  const parsed = homeAlbumIdSchema.safeParse(albumId);
  if (!parsed.success) return { ok: false, error: "That isn't an album." };

  // Read before writing: a stale card could offer an album deleted since the page
  // loaded, and storing its id would be harmless (it falls back) but would show the
  // wrong album with no explanation. `getHomeAlbumSlideshow` falls back silently, so
  // the existence check is made explicitly here.
  const slideshow = getHomeAlbumSlideshow(deps.albumRepo, parsed.data);
  if (slideshow.current?.id !== parsed.data) {
    return { ok: false, error: "That album no longer exists." };
  }

  saveHomeAlbum(deps.userPreferencesRepo, currentUser.id, parsed.data);
  return { ok: true, album: slideshow.current };
}
