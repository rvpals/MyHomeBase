"use server";

import { pickRandomPhoto, type RandomPhotoPick } from "@/lib/journal-photos";
import { photoStore } from "./modules/[slug]/journal-photo-root";

/**
 * Draws a fresh photograph for the home-screen card's refresh button.
 *
 * A thin adapter over the use-case, like `drawRandomQuoteAction`: the walk, the retry
 * budget and the "why not" reasons all live in `pickRandomPhoto`, and this adds only
 * the store to read from and a failure that cannot throw across the boundary.
 *
 * The store is built per call by `photoStore()` rather than held, so correcting the
 * path on the Journal's configuration screen takes effect on the next click with no
 * restart -- the whole reason that helper exists.
 *
 * No input to validate: the draw takes no parameters, which is also why there is no
 * zod schema here. The one value that does cross a boundary is the resulting relative
 * path, and that is parsed by `photoRelativePathSchema` on the image route that serves
 * the bytes.
 */
export async function drawRandomPhotoAction(): Promise<RandomPhotoPick> {
  try {
    return await pickRandomPhoto(photoStore());
  } catch {
    // An SMB share that drops mid-walk lands here. Reported as "unreachable" -- the
    // same vocabulary the root check uses -- so the card has one set of reasons to
    // render rather than a separate error channel.
    return { isAvailable: false, reason: "unreachable" };
  }
}
