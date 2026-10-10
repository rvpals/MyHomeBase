"use client";

// The toolbar texture card: which library picture the navigation draws behind
// its rows, and how strongly.
//
// Route-local rather than a registered component, the same as its sibling
// `DashboardTextureControl` on this screen: it is one admin control bound to
// this screen's action, and `components.md` keeps page-specific UI out of the
// registry.
//
// ## Pictures are not uploaded here
//
// This card points at a picture already in the library above it. That is the
// whole reason it can sit on this screen without a migration: the pointer
// resolves through the library's own serving route, which is already
// session-gated and already cache-busted. So an empty library is a normal state
// and gets a sentence pointing up the page rather than a second upload control.
// Same division `ToolbarTextureField` and `ModuleTextureControl` observe.
//
// ## Why there is a strength slider here
//
// A module drawing a library picture reuses that picture's own tuning (migration
// 0117), which is right for something that fills a viewport. The navigation is a
// 260px column — and shorter still as the compact bar — so a background tuned to
// 0.10 for a whole page reads as nothing at all in it. Migration 0130 made the
// same call for personal toolbars, and the reasoning carries over unchanged.
//
// NARROW SCREENS: the thumbnail grid steps 4 -> 6 -> 8 columns with plain
// responsive variants, so it is the same component at every width — the rule in
// design.md. The save row wraps.

import { useState } from "react";
import { Button } from "@/components/button";
import type { DashboardTextureItem } from "@/lib/dashboard-texture";
import { saveNavTextureAction } from "../../actions";

export function NavTextureControl({
  textures,
  textureId: savedId,
  opacity: savedOpacity,
}: {
  /** The app texture library — the same rows the gallery above renders. */
  textures: DashboardTextureItem[];
  /** The saved picture id, or `undefined` for a plain navigation. */
  textureId?: number;
  /** The saved strength, already resolved to a number in 0..1. */
  opacity: number;
}) {
  // Draft state, committed by Save. The picture tiles apply instantly to the
  // draft but not to the server: choosing a texture and tuning its strength is
  // one decision made while looking at the preview, and writing on every drag
  // would be a request per pixel. Same split the gallery above uses for its
  // three knobs.
  const [textureId, setTextureId] = useState(savedId);
  const [opacity, setOpacity] = useState(savedOpacity);

  // What is actually on the server, mirrored locally so Save can move it. The
  // props are the values this screen was *rendered* with, and the revalidate the
  // action fires does not rewrite them under a client component that is already
  // mounted — so comparing the draft against the props would leave the button
  // enabled forever after one save.
  const [saved, setSaved] = useState({ textureId: savedId, opacity: savedOpacity });

  const [error, setError] = useState<string | undefined>(undefined);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);

  const dirty = textureId !== saved.textureId || opacity !== saved.opacity;

  // `id` is in the URL so each tile shows its own picture, and `v=` busts the
  // serving route's 5-minute cache. Same URL shape the other pickers build.
  const thumbnail = (item: DashboardTextureItem) =>
    `/api/dashboard/texture?id=${item.id}&v=${encodeURIComponent(item.updatedAt)}`;

  const selected = textures.find((item) => item.id === textureId);

  async function handleSave() {
    setIsBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      const result = await saveNavTextureAction({ textureId, opacity });
      if (result.ok) {
        setSaved({ textureId, opacity });
        setNote("Toolbar texture saved.");
      } else {
        setError(result.error);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line p-3 sm:p-4">
      <p className="text-sm font-medium text-ink">Toolbar texture</p>
      <p className="mt-0.5 text-xs text-muted">
        A picture drawn behind the navigation — the tree down the left on a desktop, and
        the bar along the bottom on a phone. One choice covers both, so the navigation
        reads the same whichever you are on. It always tiles: a 260px column is too narrow
        to show a stretched photograph.
      </p>

      {textures.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
          No pictures in the library yet. Add one above, then pick it here.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
            {/* "None" is a tile rather than a Clear button beside the grid, so
                turning the texture off is the same gesture as choosing one. */}
            <button
              type="button"
              onClick={() => setTextureId(undefined)}
              disabled={isBusy}
              title="No texture"
              aria-pressed={textureId === undefined}
              className={`flex aspect-square items-center justify-center rounded-md border bg-paper text-xs text-muted transition-colors ${
                textureId === undefined
                  ? "border-brass ring-2 ring-brass"
                  : "border-line hover:border-brass/50"
              }`}
            >
              None
            </button>

            {textures.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTextureId(item.id)}
                disabled={isBusy}
                // The picture's name, because a tile of an abstract texture at
                // 48px is not something a reader can identify by sight.
                title={item.name}
                aria-pressed={textureId === item.id}
                className={`overflow-hidden rounded-md border transition-colors ${
                  textureId === item.id
                    ? "border-brass ring-2 ring-brass"
                    : "border-line hover:border-brass/50"
                }`}
              >
                {/* A plain `img`, not `next/image`: these are session-gated bytes
                    from a route that already sets its own caching, and the
                    optimizer cannot read them. Same choice every other texture
                    picker on this screen makes. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbnail(item)}
                  alt={item.name}
                  className="aspect-square w-full object-cover"
                />
              </button>
            ))}
          </div>

          {/* Shown only with a picture chosen — a strength slider for no texture
              is a control that does nothing, and hiding it says so more clearly
              than disabling it would. */}
          {textureId !== undefined && (
            <div className="mt-4">
              <label
                htmlFor="nav-texture-opacity"
                className="flex items-baseline justify-between text-xs font-medium text-ink"
              >
                Strength
                <span className="font-mono text-muted">{Math.round(opacity * 100)}%</span>
              </label>
              <input
                id="nav-texture-opacity"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={opacity}
                onChange={(event) => setOpacity(Number(event.target.value))}
                disabled={isBusy}
                className="mt-2 w-full accent-brass"
              />
              <p className="mt-1 text-xs text-muted">
                The navigation&apos;s own strength, not the picture&apos;s. A narrow column
                shows so little of a picture that a full-page setting reads as nothing — so
                this one starts higher and is tuned here.
              </p>
            </div>
          )}

          {/* The preview. A miniature of the column with two rows on top, for the
              reason the gallery's own preview gives: judging a background without
              the thing that sits on it is guesswork. `.chrome-frame` is deliberately
              absent — it would drag the admin's bevel in, and this card is about
              the picture. */}
          {selected && (
            <div className="mt-5">
              <p className="text-xs font-medium text-ink">Preview</p>
              <div className="relative mt-2 h-32 w-40 overflow-hidden rounded-lg border border-line bg-paper-raised">
                <span
                  aria-hidden
                  className="absolute inset-0"
                  style={{
                    backgroundImage: `url("${thumbnail(selected)}")`,
                    backgroundRepeat: "repeat",
                    backgroundPosition: "center",
                    opacity,
                  }}
                />
                <div className="relative space-y-1.5 p-2">
                  <div className="h-2 w-2/3 rounded-sm bg-ink/25" />
                  <div className="h-2 w-5/6 rounded-sm bg-ink/15" />
                  <div className="h-2 w-1/2 rounded-sm bg-ink/15" />
                  <div className="h-2 w-4/6 rounded-sm bg-ink/15" />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      {!error && note && <p className="mt-3 text-xs text-brass">{note}</p>}

      {textures.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <Button onClick={() => void handleSave()} disabled={isBusy || !dirty}>
            {isBusy ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}
