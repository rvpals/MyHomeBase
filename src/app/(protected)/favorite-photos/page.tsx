import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { listFavPhotos } from "@/lib/fav-photos";
import { deps } from "@/lib/wiring";
import { HomeShell } from "../home-shell";
import { FavPhotosList } from "../fav-photos-list";
import { PAGE_CONTAINER } from "../page-container";

// The My Favorite Photos screen.
//
// Belongs to no feature module, like `/account` — it is a home-screen concern that
// outgrew the card it was launched from. It was a dialog over the home screen until it
// gained bulk selection, downloading and deletion; that is work rather than a glance,
// and work wants a URL, a back button and no risk of being dismissed halfway through.
// The Random Photo card's last header button now navigates here.
//
// A server component that reads the list once, so the screen paints with content
// instead of opening onto a spinner. Every write after that goes through the list's own
// server actions and re-reads there.
export default async function FavoritePhotosPage() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) redirect("/login");

  // Favourites are not per-user — the table has no user column, because this is a
  // household's shared archive and a photograph one person keeps is one everybody sees.
  // See migrations/0073_create_fav_photo.md.
  const favorites = listFavPhotos(deps.favPhotoRepo);

  return (
    // Belongs to no module, so the shell gives it the rail and the header but no
    // section panel — see `home-shell.tsx`.
    <HomeShell label="My favorite photos" icon="photo" href="/favorite-photos">
      <div className={`${PAGE_CONTAINER} p-4 max-lg:p-3`}>
        <p className="mb-4 text-sm text-muted">
          Every photograph kept from the Random Photo card. Tick a few to download them as
          one zip, or to remove them from your favorites — the pictures themselves stay in
          the archive either way.
        </p>
        <FavPhotosList initialFavorites={favorites} />
      </div>
    </HomeShell>
  );
}
