import type { AlbumRepository } from "./ports";
import type { AlbumSummary } from "./types";

/**
 * The home screen's Photo Albums card: one album, cycled photo by photo.
 *
 * Lives with albums rather than with the home dashboard because everything it decides
 * is about albums — which one to show when the reader's choice has gone, and what the
 * card needs to draw. The home screen only asks.
 */

/** How long each photo stays up before the card moves on. */
export const HOME_ALBUM_INTERVAL_MS = 5000;

/** One entry in the card's album picker. */
export interface HomeAlbumOption {
  id: number;
  name: string;
  photoCount: number;
}

/** The album the card is currently cycling, with its photos in album order. */
export interface HomeAlbumSlides {
  id: number;
  name: string;
  /** Paths from the photo root, in the album's own `sortOrder`. */
  paths: string[];
}

/** Everything the card draws: the picker's choices and the album being shown. */
export interface HomeAlbumSlideshow {
  albums: HomeAlbumOption[];
  /** `undefined` only when there are no albums at all. */
  current?: HomeAlbumSlides;
}

/**
 * Which album the card shows, given the reader's stored choice.
 *
 * The stored album if it still exists; otherwise the first album in the list (the
 * list is newest-first, so that is the most recently created); otherwise `undefined`
 * when there are no albums. A deleted album degrades to a sensible default rather than
 * an empty card, so deleting an album never needs to clean up anyone's preference.
 */
export function resolveHomeAlbum(
  summaries: AlbumSummary[],
  storedId: number | undefined,
): AlbumSummary | undefined {
  if (storedId !== undefined) {
    const stored = summaries.find((summary) => summary.id === storedId);
    if (stored) return stored;
  }
  return summaries[0];
}

/**
 * The slide after `index`, wrapping back to the first after the last.
 *
 * `0` for an empty or one-photo album, so a caller never has to special-case either.
 * An out-of-range index (the album shrank under a running card) also lands back in
 * range rather than pointing past the end.
 */
export function nextSlideIndex(index: number, count: number): number {
  if (count <= 1) return 0;
  return (((index + 1) % count) + count) % count;
}

/**
 * Reads what the card needs: every album for the picker and the chosen one's photos.
 *
 * One summary query plus one membership read for the single album shown — never the
 * photos of every album. Callers have already decided the reader may see albums
 * (Picture Gallery access); this does not check.
 */
export function getHomeAlbumSlideshow(
  repo: AlbumRepository,
  storedId: number | undefined,
): HomeAlbumSlideshow {
  const summaries = repo.listSummaries();
  const albums = summaries.map((summary) => ({
    id: summary.id,
    name: summary.name,
    photoCount: summary.photoCount,
  }));
  const chosen = resolveHomeAlbum(summaries, storedId);
  if (!chosen) return { albums };
  return {
    albums,
    current: {
      id: chosen.id,
      name: chosen.name,
      paths: repo.listPhotos(chosen.id).map((photo) => photo.relativePath),
    },
  };
}
