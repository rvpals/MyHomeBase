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
// A SMALL CARD, SIZED TO THE PICTURE. The thumbnail is THUMBNAIL_SIZE (160px) on its
// short side, so stretching it across a ~700px desktop grid column blew it up ~3x and
// it read as fuzzy. The card is capped at 18rem instead -- about the width of the
// widest thumbnail plus the card's own padding -- and the picture sits inside at its
// own size (max-h/max-w only, never h-full w-full), so it is downscaled at most and
// never enlarged. A small card with a sharp photo, rather than a big card with a
// blurred one.
//
// THAT CAP IS WHY THE PICKER SITS IN THE BODY. A <select> in the header's headerAction
// slot puts a ~400px floor under the card's width, beside the title and the Open link,
// which is wider than the whole card is now allowed to be. Under the picture it gets
// the full content width and costs the header nothing.
//
// The 12rem band is fixed rather than shrink-to-fit, so the card does not resize itself
// every few seconds as portrait and landscape slides alternate.
//
// NARROW: the cap applies at every width, so this is the same object in the phone's
// single stack as in either desktop column. The picker is a native <select>, which is
// the phone-friendly control anyway.
//
// IT ALSO OWNS ITS ✕ (`ownsClose`, as Daily Quote does). The grid's own corner button
// is positioned against the *cell*, which stays a full grid column wide -- so against
// an 18rem card it would hover in the empty space beside it, attached to nothing. The
// header slot the picker just vacated is exactly where it belongs instead. The grid
// still owns the confirmation and the hidden state; only the button's position moves.

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
import { useHomeWidgetClose } from "./home-widget-grid";
import { selectHomeAlbumAction } from "./photo-albums-widget-actions";

// Resolved once at module scope — `getIconSlot` reads the static registry, so this is
// not I/O. A removed id costs the card its glyph rather than crashing it.
const CARD_SLOT = getIconSlot("homescreen_card_photo_albums");

const ALBUMS_HREF = "/modules/picture-gallery/albums";

/** Local rather than shared: Daily Quote keeps its own copy too, and twelve lines of
  * path data is not worth a registered component until a third card wants one. */
function CloseIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

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
  // Opens the grid's "close this card?" confirmation. Undefined wherever the widget is
  // drawn outside the grid, and the button is then simply not rendered.
  const onClose = useHomeWidgetClose();
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
        className="w-full truncate rounded-md border border-line bg-paper px-2 py-1 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-60"
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
      headerAction={
        onClose ? (
          <button
            type="button"
            draggable={false}
            onClick={onClose}
            title="Close Photo Albums"
            aria-label="Close Photo Albums"
            // `xl:` only, matching the grid's own button: the layout controls do not
            // exist below that width, so neither does closing a card.
            className="hidden rounded-md p-1 text-muted transition-colors hover:bg-brass-soft hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass motion-reduce:transition-none xl:inline-flex"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        ) : undefined
      }
      className={`w-full max-w-[18rem] ${className ?? ""}`}
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
          className="relative flex h-48 w-full items-center justify-center overflow-hidden rounded-lg bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          {/* A plain <img>, not next/image: the bytes come from an authenticated
              route that already serves a small rendition, so the optimiser has
              nothing to add. Keyed by path so each slide is a fresh element. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={paths[current]}
            src={thumbUrl(paths[current])}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
          <span className="absolute bottom-2 right-2 rounded bg-black/55 px-1.5 py-0.5 text-xs tabular-nums text-white">
            {current + 1} / {count}
          </span>
        </Link>
      )}

      {picker && <div className="mt-3">{picker}</div>}
    </CollapsibleCard>
  );
}
