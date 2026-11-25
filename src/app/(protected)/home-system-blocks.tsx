"use client";

// The Systems card's richer panel blocks: random recipes (Household), the most-played
// songs and a random photo (Media).
//
// One-off home-screen pieces, beside `home-systems-widget.tsx`, which is their only
// caller. Split out because each one owns client state — a re-roll, the player, a
// draw after mount — and the panel file is otherwise pure layout.
//
// No logic here: the draws are `pickRandomRecipes` / `listTopPlayedTracks` /
// `pickRandomPhoto` in `src/lib`, reached through server actions that authorise on
// their own module.

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useMusicPlayer, type PlayableTrack } from "@/components/music-player-provider";
import { TreeIcon } from "@/components/tree-icons";
// The leaf file, not the `@/lib/journal-photos` barrel: that barrel re-exports a
// Node file store, which a client component must not pull in.
import type { RandomPhotoPick } from "@/lib/journal-photos/random";
import { drawRandomRecipesAction } from "./modules/[slug]/household-actions";
import { drawRandomPhotoAction } from "./modules/[slug]/gallery-photo-actions";

/** One recipe row, as the page hands it over. */
export interface HomeRecipePick {
  id: number;
  name: string;
  category: string;
  hasPicture: boolean;
  /** Cache-buster for the picture route. */
  updatedAt: string;
}

/** One most-played song. Carries what the player needs to start it. */
export interface HomeTopTrack {
  id: number;
  title: string;
  artist: string;
  album: string;
  albumId?: number;
  durationSeconds?: number;
  playCount: number;
}

const RECIPE_COUNT = 4;

function recipeHref(id: number): string {
  return `/modules/household/recipes?recipe=${id}`;
}

function BlockHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-1 flex items-center justify-between gap-2">
      <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h4>
      {action}
    </div>
  );
}

/** The small re-roll glyph button. A row action, so a bare glyph rather than a slot. */
function RerollButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={label}
      aria-label={label}
      className="rounded-full p-1 text-muted hover:bg-paper-raised hover:text-ink disabled:opacity-50"
    >
      <TreeIcon name="refresh" className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
    </button>
  );
}

/** Household: four recipes drawn at random, each opening its own viewer. */
export function SystemRecipes({ initial }: { initial: HomeRecipePick[] }) {
  const [recipes, setRecipes] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function reroll() {
    setBusy(true);
    const result = await drawRandomRecipesAction(RECIPE_COUNT);
    setBusy(false);
    if (result.ok && result.recipes) {
      setRecipes(
        result.recipes.map((recipe) => ({
          id: recipe.id,
          name: recipe.name,
          category: recipe.category,
          hasPicture: recipe.hasPicture,
          updatedAt: recipe.updatedAt,
        })),
      );
    }
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <BlockHeading
        title="Recipes to try"
        action={<RerollButton label="Draw other recipes" busy={busy} onClick={reroll} />}
      />
      <ul className="space-y-1 text-sm">
        {recipes.map((recipe) => (
          <li key={recipe.id}>
            <Link
              href={recipeHref(recipe.id)}
              className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-paper-raised"
            >
              {recipe.hasPicture ? (
                // A plain <img>: the picture route is session-guarded and already resized.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/household/recipes/${recipe.id}/picture?v=${encodeURIComponent(recipe.updatedAt)}`}
                  alt=""
                  className="h-7 w-7 shrink-0 rounded object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="h-7 w-7 shrink-0 rounded bg-brass-soft" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate">{recipe.name}</span>
              {recipe.category && (
                <span className="shrink-0 text-xs text-muted">{recipe.category}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Media: the three most-played songs. A click plays the song now, in the shared player. */
export function SystemTopTracks({ tracks }: { tracks: HomeTopTrack[] }) {
  const player = useMusicPlayer();

  const playable: PlayableTrack[] = tracks.map((track) => ({
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumId: track.albumId,
    durationSeconds: track.durationSeconds,
  }));

  return (
    <div className="mt-3 border-t border-line pt-3">
      <BlockHeading title="Most played" />
      <ul className="space-y-1 text-sm">
        {tracks.map((track, index) => (
          <li key={track.id}>
            <button
              type="button"
              // The three become the queue, starting at the one clicked, so the next
              // song after it is the next most-played rather than silence.
              onClick={() => {
                const target = playable[index];
                if (target) player?.play(target, playable);
              }}
              disabled={!player}
              title={`Play ${track.title}`}
              className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-paper-raised disabled:opacity-50"
            >
              <TreeIcon name="player" className="h-4 w-4 shrink-0 text-brass" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{track.title}</span>
                {track.artist && (
                  <span className="block truncate text-xs text-muted">{track.artist}</span>
                )}
              </span>
              <span className="shrink-0 text-xs text-muted">
                {track.playCount} {track.playCount === 1 ? "play" : "plays"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Media: one small photograph from anywhere in the archive.
 *
 * Drawn after mount, not on the server: the draw walks the NAS share (three directory
 * reads, more on a re-roll), and the home screen must not wait on that to render.
 * Draws nothing at all when the archive is unset or unreachable — the Picture Gallery
 * module is where that gets diagnosed, not a corner of the home screen.
 */
export function SystemRandomPhoto() {
  const [pick, setPick] = useState<RandomPhotoPick>();
  const [busy, setBusy] = useState(true);

  async function draw() {
    setBusy(true);
    try {
      setPick(await drawRandomPhotoAction());
    } catch {
      setPick(undefined);
    }
    setBusy(false);
  }

  useEffect(() => {
    void draw();
  }, []);

  if (!busy && (!pick?.isAvailable || !pick.relativePath)) return null;

  return (
    <div className="mt-3 border-t border-line pt-3">
      <BlockHeading
        title="From the archive"
        action={<RerollButton label="Draw another photo" busy={busy} onClick={draw} />}
      />
      {pick?.relativePath ? (
        <Link href="/modules/picture-gallery" className="block" title={pick.folderName}>
          {/* The thumbnail route, not the original: a few KB for a 96px strip. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/journal/photos/thumb?path=${encodeURIComponent(pick.relativePath)}`}
            alt={pick.folderName ?? "A photo from the archive"}
            className="h-24 w-full rounded-lg object-cover"
          />
          {pick.folderName && (
            <span className="mt-1 block truncate text-xs text-muted">{pick.folderName}</span>
          )}
        </Link>
      ) : (
        <div className="h-24 w-full animate-pulse rounded-lg bg-paper-raised" aria-hidden="true" />
      )}
    </div>
  );
}
