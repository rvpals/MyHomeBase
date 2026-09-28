"use client";

// Choose what one module draws behind its screens: the app-wide background, a
// picture from the texture library, its own upload, or nothing.
//
// Route-local rather than a registered component, like its two neighbours
// (`carousel-image-control.tsx`, `icon-control.tsx`): it's one admin control
// bound to this screen's action, and `components.md` keeps page-specific UI out
// of the registry.
//
// Saves on pick rather than on the page's Save button — again matching the
// neighbours. There is nothing to batch: one radio, one write.
//
// NARROW SCREENS: the thumbnail grid steps 3 -> 4 -> 6 columns with plain
// responsive variants, so it's the same component at every width. No
// `useIsCompact()` branch, which is the rule in design.md.

import { useState } from "react";
import type { DashboardTextureItem } from "@/lib/dashboard-texture";
import type { ModuleTextureSource } from "@/lib/module-texture";
import { setModuleTextureChoiceAction } from "../../actions";

export function ModuleTextureControl({
  slug,
  moduleName,
  source: initialSource,
  textureId: initialTextureId,
  hasOwnImage,
  textures,
}: {
  slug: string;
  moduleName: string;
  source: ModuleTextureSource;
  /** The library picture this module points at, when `source` is `'library'`. */
  textureId?: number;
  /**
   * Whether this module has a picture uploaded from its own configuration
   * screen. Only then is "its own picture" an option worth offering — the
   * upload itself lives on that module's screen, not here.
   */
  hasOwnImage: boolean;
  /** The app texture library. Empty is normal: nothing has been uploaded yet. */
  textures: DashboardTextureItem[];
}) {
  const [source, setSource] = useState(initialSource);
  const [textureId, setTextureId] = useState(initialTextureId);
  const [error, setError] = useState<string | undefined>(undefined);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);

  /** Writes a choice, rolling the local state back if the server refuses it. */
  async function choose(
    nextSource: ModuleTextureSource,
    nextTextureId: number | undefined,
    successNote: string,
  ) {
    const previous = { source, textureId };
    // Optimistic: the radio should respond to the click, not to the round trip.
    setSource(nextSource);
    setTextureId(nextTextureId);
    setIsBusy(true);
    setError(undefined);
    setNote(undefined);

    try {
      const result = await setModuleTextureChoiceAction(slug, {
        source: nextSource,
        textureId: nextTextureId,
      });
      if (result.ok) {
        setNote(successNote);
      } else {
        setSource(previous.source);
        setTextureId(previous.textureId);
        setError(result.error);
      }
    } catch (caught) {
      setSource(previous.source);
      setTextureId(previous.textureId);
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setIsBusy(false);
    }
  }

  /** A library thumbnail. `id` is in the URL, so each tile shows its own picture. */
  const imageUrl = (item: DashboardTextureItem) =>
    `/api/dashboard/texture?id=${item.id}&v=${encodeURIComponent(item.updatedAt)}`;

  const radioClass = "h-4 w-4 shrink-0 accent-brass";

  return (
    <div className="mt-4 rounded-lg border border-line p-3">
      <p className="text-sm font-medium text-ink">Background texture</p>
      <p className="mt-0.5 text-xs text-muted">
        What sits behind {moduleName}&apos;s screens. Pictures come from Configuration →
        App&nbsp;Texture.
      </p>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {!error && note && <p className="mt-2 text-xs text-brass">{note}</p>}

      <div className="mt-3 space-y-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            name={`texture-source-${slug}`}
            checked={source === "inherit"}
            disabled={isBusy}
            onChange={() => void choose("inherit", undefined, "Now uses the app background.")}
            className={radioClass}
          />
          <span className="text-ink">Use the app background</span>
        </label>

        {/* Offered only when there is one to point at: a module that has never
            had an upload would otherwise get a radio that cannot be chosen. The
            picture itself is managed on that module's own screen. */}
        {hasOwnImage && (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name={`texture-source-${slug}`}
              checked={source === "own"}
              disabled={isBusy}
              onChange={() => void choose("own", undefined, "Now uses its own picture.")}
              className={radioClass}
            />
            <span className="text-ink">Its own uploaded picture</span>
          </label>
        )}

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            name={`texture-source-${slug}`}
            checked={source === "none"}
            disabled={isBusy}
            onChange={() => void choose("none", undefined, "Now shows plain paper.")}
            className={radioClass}
          />
          <span className="text-ink">
            None — plain paper
            <span className="ml-1 text-xs text-muted">(even if the app has one)</span>
          </span>
        </label>
      </div>

      {textures.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-3 text-center text-xs text-muted">
          The texture library is empty. Add a picture in Configuration → App Texture to pick
          one here.
        </p>
      ) : (
        <>
          <p className="mt-4 text-xs font-medium text-ink">Or pick one from the library</p>
          {/* Three columns on a phone, six on a desktop — the tile is the same
              at every width, only the column count changes. */}
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {textures.map((item) => {
              const isChosen = source === "library" && textureId === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={isBusy}
                  onClick={() => void choose("library", item.id, `Now uses ${item.name}.`)}
                  className={`overflow-hidden rounded-lg border text-left transition ${
                    isChosen ? "border-brass ring-2 ring-brass" : "border-line hover:border-brass"
                  }`}
                >
                  {/* A plain <img>, not next/image: these are private bytes
                      behind a session-checked route, so the optimizer has
                      nothing to add and would need the route allow-listed. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl(item)}
                    alt={item.name}
                    className="h-12 w-full object-cover"
                  />
                  <span className="block truncate px-1.5 py-1 text-[0.65rem] text-muted">
                    {item.name}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
