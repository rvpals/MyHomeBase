// The Random Photo card's data, moved off the home screen's critical render path.
//
// This exists purely so the NAS read can be Suspense-boundaried. `pickRandomPhoto`
// walks the photo share over SMB -- a root check, a year listing, then up to
// MAX_ATTEMPTS further pairs of listings (see src/lib/journal-photos/random.ts).
// Awaited inside page.tsx it was the ONE async call on a screen that is otherwise
// synchronous SQLite, so first paint waited on the share: an installed PWA sat on
// the Android splash screen for as long as a spun-down drive took to answer.
//
// Streaming it means the dashboard paints from the database alone and this card
// arrives when the share does. Nothing here is new logic -- it is the same two
// reads page.tsx used to do inline, relocated.
import { listFavPhotos } from "@/lib/fav-photos";
import { pickRandomPhoto } from "@/lib/journal-photos";
import { deps } from "@/lib/wiring";
import { photoStore } from "./modules/[slug]/journal-photo-root";
import { RandomPhotoWidget } from "./random-photo-widget";

export async function RandomPhotoCard({ className }: { className?: string }) {
  // An unconfigured or unreachable archive comes back as a `reason` rather than
  // throwing, so a sleeping NAS cannot take the home screen down with it.
  const pick = await pickRandomPhoto(photoStore());

  // Collapses to nothing when there is no photograph to show, which is what the
  // home screen did before this card streamed: `hasContent.randomPhoto` dropped it
  // from the layout entirely. That decision can no longer be made before paint, so
  // it is made here instead -- the card's slot is reserved, then given up if the
  // draw came back empty. Costs a small reflow on an unreachable share; chosen
  // deliberately over leaving an "unavailable" card on the dashboard.
  if (pick.relativePath === undefined) return null;

  // Read only once there is a photo to show. One small table read serving both the
  // heart's state and the list dialog's contents.
  const favoritePhotos = listFavPhotos(deps.favPhotoRepo);

  return (
    <RandomPhotoWidget
      className={className}
      initialPick={pick}
      initialFavorites={favoritePhotos}
    />
  );
}
