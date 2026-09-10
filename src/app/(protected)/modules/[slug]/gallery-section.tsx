import { Suspense } from "react";
import { CollapsibleCard } from "@/components/collapsible-card";
import { listFavPhotos } from "@/lib/fav-photos";
import { deps } from "@/lib/wiring";
import { FavPhotosList } from "./gallery-fav-photos-list";
import { GalleryInstructions } from "./gallery-instructions";
import { RandomPhotoCard } from "./gallery-random-photo-card";
import { GalleryShell } from "./gallery-shell";
import {
  GALLERY_SECTION_INFO,
  type GallerySection as GallerySectionName,
} from "./gallery-sections";

// Composes one Picture Gallery section: the section nav, a heading, the instruction
// card, and the section's own view. A server component, so it can read `deps` directly
// and hand plain data to the client views. Mirrors games-section.tsx.
//
// Each section loads only what it needs: Home screen reads nothing here (the photo
// draw is streamed inside its own card, below), and Favorites reads the kept list.

export async function GallerySection({ section }: { section: GallerySectionName }) {
  const info = GALLERY_SECTION_INFO[section];

  return (
    // The two-tier shell: a module rail, a section panel and a utility header, all
    // placed by `GalleryShell`. See design.md, "Navigation: the two-tier shell".
    <GalleryShell>
      <div>
        <header className="mb-4">
          <h1 className="font-display text-2xl text-ink">{info.label}</h1>
          <p className="text-sm text-muted">{info.description}</p>
        </header>

        <CollapsibleCard title="Instruction">
          <GalleryInstructions section={section} />
        </CollapsibleCard>

        <div className="mt-6">
          {section === "main" && (
            // Streamed, so the SMB walk cannot hold up first paint -- the same reason
            // it was streamed on the app home screen it came from. The fallback is
            // deliberately empty rather than a skeleton: the card's height depends on
            // the photograph, so a placeholder box would be the wrong size and shift
            // the page twice instead of once.
            <Suspense fallback={null}>
              <RandomPhotoCard />
            </Suspense>
          )}
          {section === "favorites" && (
            // Read on the server so the screen paints with content instead of opening
            // onto a spinner. Every write after that goes through the list's own server
            // actions and re-reads there.
            //
            // Favourites are not per-user -- the table has no user column, because this
            // is a household's shared archive and a photograph one person keeps is one
            // everybody sees. See migrations/0073_create_fav_photo.md.
            <FavPhotosList initialFavorites={listFavPhotos(deps.favPhotoRepo)} />
          )}
        </div>
      </div>
    </GalleryShell>
  );
}
