"use client";

// One-off home-screen widget (not a registered shared component) — nothing else will
// render an album slideshow card. Built from registered pieces: `CollapsibleCard` for
// the shell and `SlotIcon` for the header glyph.
//
// A SLIDESHOW, NOT A VIEWER. The card shows one photo of the reader's chosen album at
// a time and moves on every `HOME_ALBUM_INTERVAL_MS`, starting over after the last. No
// next/previous/pause controls by design; browsing an album properly is what Picture
// Gallery → Albums is for, one click away through the title's link.
//
// THUMBNAILS, NOT ORIGINALS. Each slide loads the small `/thumb` rendition rather than
// a multi-megabyte original over the NAS — a deliberate trade of sharpness for load,
// cycling forever on a screen that may be left open all day. The timer also stops
// while the tab is hidden, so a background tab pulls nothing.
//
// NARROW: one fixed 4:3 frame at the card's width with the picture contained in it,
// so it behaves the same in the phone's single stack as in either desktop column.
// The picker is a native <select>, which is the phone-friendly control anyway.

import { useEffect, useState } from "react";
import Link from "next/link";
import { CollapsibleCard } from "@/components/collapsible-card";
import { SlotIcon } from "@/components/slot-icon";
// Types from the barrel are erased at build time; runtime values come from the leaf
// file, because the barrel also exports the SQLite repository and a client component
// pulling that in would break the bundle.
import type { HomeAlbumOption, HomeAlbumSlides } from "@/lib/albums";
import { HOME_ALBUM_INTERVAL_MS, nextSlideIndex } from "@/lib/albums/slideshow";
import { getIconSlot } from "@/lib/icons";
import { selectHomeAlbumAction } from "./photo-albums-widget-actions";

// Resolved once at module scope — `getIconSlot` reads the static registry, so this is
// not I/O. A removed id costs the card its glyph rather than crashing it.
const CARD_SLOT = getIconSlot("homescreen_card_photo_albums");

const ALBUMS_HREF = "/modules/picture-gallery/albums";

/** The small rendition. Encoded whole: these folder names contain spaces. */
function thumbUrl(relativePath: string): string {
  return `/api/journal/photos/thumb?path=${encodeURIComponent(relativePath)}`;
}

/** True when the page is on screen — the slideshow only advances then. */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

export function PhotoAlbumsWidget({
  albums,
  initialAlbum,
  className,
}: {
  albums: HomeAlbumOption[];
  /** `undefined` only when no album exists yet. */
  initialAlbum?: HomeAlbumSlides;
  className?: string;
}) {
  const [album, setAlbum] = useState<HomeAlbumSlides | undefined>(initialAlbum);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const visible = useDocumentVisible();

  const paths = album?.paths ?? [];
  const count = paths.length;
  // Clamped on read rather than by an effect, so a shorter album can never index past
  // its end for even one render.
  const current = count > 0 ? index % count : 0;

  // The cycle. Restarted whenever the album changes or the tab comes back, and not run
  // at all for an album with fewer than two photos — there is nothing to move to.
  useEffect(() => {
    if (!visible || count < 2) return;
    const timer = window.setInterval(
      () => setIndex((previous) => nextSlideIndex(previous, count)),
      HOME_ALBUM_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [visible, count, album?.id]);

  // Warm the browser cache with the next slide, so the swap is instant rather than a
  // blank frame while the NAS answers.
  // Keyed on `album` (stable state) rather than the derived `paths`, which is a fresh
  // `[]` on every render when there is no album.
  useEffect(() => {
    if (!album || album.paths.length < 2) return;
    const next = new Image();
    next.src = thumbUrl(album.paths[nextSlideIndex(current, album.paths.length)]);
  }, [current, album]);

  async function handleSelect(rawId: string) {
    setError(undefined);
    setPending(true);
    try {
      const result = await selectHomeAlbumAction(Number(rawId));
      if (result.ok) {
        setAlbum(result.album);
        setIndex(0);
      } else {
        setError(result.error);
      }
    } finally {
      setPending(false);
    }
  }

  const picker =
    albums.length > 0 ? (
      <select
        aria-label="Album to show"
        value={album?.id ?? ""}
        disabled={pending}
        onChange={(event) => void handleSelect(event.target.value)}
        className="max-w-[11rem] truncate rounded-md border border-line bg-paper px-2 py-1 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-60"
      >
        {albums.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name} ({option.photoCount})
          </option>
        ))}
      </select>
    ) : undefined;

  return (
    <CollapsibleCard
      title="Photo Albums"
      titleIcon={CARD_SLOT ? <SlotIcon slot={CARD_SLOT} className="h-5 w-5" /> : undefined}
      defaultOpen
      titleAction={
        <Link
          href={ALBUMS_HREF}
          className="rounded px-2 py-0.5 text-xs font-medium text-brass-dark transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          Open
        </Link>
      }
      headerAction={picker}
      className={className}
    >
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-2 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      {albums.length === 0 ? (
        <p className="text-sm text-muted">
          No albums yet.{" "}
          <Link href={ALBUMS_HREF} className="text-brass-dark hover:text-ink">
            Create one in Picture Gallery
          </Link>
          .
        </p>
      ) : count === 0 ? (
        <p className="text-sm text-muted">This album has no photos yet.</p>
      ) : (
        <Link
          href={ALBUMS_HREF}
          aria-label={`Open ${album?.name ?? "this album"} in Picture Gallery`}
          className="relative block aspect-[4/3] w-full overflow-hidden rounded-lg bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          {/* A plain <img>, not next/image: the bytes come from an authenticated
              route that already serves a small rendition, so the optimiser has
              nothing to add. Keyed by path so each slide is a fresh element. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={paths[current]}
            src={thumbUrl(paths[current])}
            alt=""
            className="h-full w-full object-contain"
          />
          <span className="absolute bottom-2 right-2 rounded bg-black/55 px-1.5 py-0.5 text-xs tabular-nums text-white">
            {current + 1} / {count}
          </span>
        </Link>
      )}
    </CollapsibleCard>
  );
}
