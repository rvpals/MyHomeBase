"use client";

// Pick the glyph a module shows on the module rail, the home grid, and as its
// carousel fallback — or upload artwork to use instead.
//
// Route-local rather than a registered component, matching `CarouselImageControl`
// beside it: it's one admin control bound to this screen's action, and
// `components.md` keeps page-specific UI out of the registry.
//
// A grid of glyphs, not `IconSelect`. That component shows an option's icon from
// a URL, and these icons aren't URLs — they're inline SVG bodies resolved
// through the reader's chosen icon set. A grid also suits the job better: there
// are seventeen names, all of them visual, so showing them at once is faster than
// opening a dropdown to read words for pictures.
//
// The write happens on pick rather than on the page's Save button, because this
// same value draws the rail and the home grid — a glyph chosen but unsaved would
// leave the card disagreeing with the chrome around it. The upload saves the same
// way, for the same reason.
//
// ## Why the upload lives here and not in Display Settings > Icons
//
// That screen replaces an icon in one *position* (`ICON_SLOTS`). A module's icon
// is not a position — it is one value drawn in nine of them. `slots.ts` rules it
// out explicitly, so the upload extends the value that already exists, right
// beside the picker it replaces. See migrations/0150_module_custom_icon.md.

import { useRef, useState } from "react";
import { Button } from "@/components/button";
import { ModuleIcon } from "@/components/module-icons";
import { MAX_MODULE_ICON_BYTES, MODULE_ICON_NAMES } from "@/lib/modules";
import {
  removeModuleCustomIconAction,
  saveModuleCustomIconAction,
  saveModuleIconAction,
} from "../../actions";

/** Sentence-case for the button's label — the stored names are lowercase. */
function labelFor(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function ModuleIconControl({
  slug,
  moduleName,
  icon,
  hasCustomIcon = false,
  customIconKind,
  iconVersion,
}: {
  slug: string;
  moduleName: string;
  icon: string;
  /** Whether artwork has been uploaded. The glyph grid is inert while it is. */
  hasCustomIcon?: boolean;
  /** `"svg"` tints with the theme; `"image"` cannot, which this control says. */
  customIconKind?: "svg" | "image";
  /** The module's `updatedAt`, for the preview's cache-buster. */
  iconVersion?: string;
}) {
  // Owned here, not in the admin form's draft: this control persists its own
  // writes, so the form has no say in the value after first render.
  const [selected, setSelected] = useState(icon);
  const [custom, setCustom] = useState(hasCustomIcon);
  const [customKind, setCustomKind] = useState(customIconKind);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function choose(name: string) {
    if (name === selected || isBusy) return;
    // Shown immediately and rolled back on failure. The alternative — waiting
    // for the round trip — makes every pick feel like it didn't register.
    const previous = selected;
    setSelected(name);
    setIsBusy(true);
    setError(undefined);
    const result = await saveModuleIconAction(slug, name);
    if (!result.ok) {
      setSelected(previous);
      setError(result.error);
    }
    setIsBusy(false);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;

    // Checked here as well as in the lib for the reason the carousel control
    // gives: an oversized file otherwise gets read and posted, and what comes
    // back is a framework body-limit error rather than something actionable.
    if (file.size > MAX_MODULE_ICON_BYTES) {
      setError(
        `That file is ${Math.round(file.size / 1024)} KB — keep it under ${Math.round(
          MAX_MODULE_ICON_BYTES / 1024,
        )} KB.`,
      );
      if (fileInput.current) fileInput.current.value = "";
      return;
    }

    setIsBusy(true);
    setError(undefined);
    try {
      const body = new FormData();
      body.set("slug", slug);
      body.set("icon", file);

      const result = await saveModuleCustomIconAction(body);
      if (result.ok) {
        // The page revalidates, but this keeps the control honest until it does.
        setCustom(true);
        setCustomKind(
          file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")
            ? "svg"
            : "image",
        );
      } else {
        setError(result.error);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read that file.");
    } finally {
      setIsBusy(false);
      // Cleared so re-picking the *same* file still fires a change event.
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleRemove() {
    setIsBusy(true);
    setError(undefined);
    const result = await removeModuleCustomIconAction(slug);
    if (result.ok) {
      setCustom(false);
      setCustomKind(undefined);
    } else {
      setError(result.error);
    }
    setIsBusy(false);
  }

  return (
    <div className="mt-4 rounded-lg border border-line p-3">
      <p className="text-sm font-medium text-ink">Icon</p>
      <p className="mt-0.5 text-xs text-muted">
        Drawn on the module rail, the navigation tree, the breadcrumb, the home screen grid,
        and the carousel when there&apos;s no graphic. Saved as soon as you pick or upload
        one.
      </p>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}

      {/* Wraps rather than using a fixed column count, so seventeen 44px targets
          reflow down to a phone without any `max-lg:` override. 44px is the
          minimum comfortable tap target. */}
      <div
        role="radiogroup"
        aria-label={`Icon for ${moduleName}`}
        className={`mt-3 flex flex-wrap gap-2 ${custom ? "opacity-50" : ""}`}
      >
        {MODULE_ICON_NAMES.map((name) => {
          const active = name === selected;
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={labelFor(name)}
              title={labelFor(name)}
              disabled={isBusy}
              onClick={() => void choose(name)}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition disabled:opacity-50 ${
                active
                  ? "border-brass bg-brass-soft text-brass-dark ring-2 ring-brass"
                  : "border-line bg-paper text-muted hover:border-brass/50 hover:text-ink"
              }`}
            >
              {/* No `slug` — these are the seventeen built-in glyphs to choose
                  between, not this module's current icon. Passing it would make
                  every square show the upload. */}
              <ModuleIcon name={name} className="h-5 w-5" />
            </button>
          );
        })}
      </div>

      {/* The upload sits under the grid rather than beside it: it *replaces* the
          grid's answer, so reading top-to-bottom ("pick one — or use your own")
          is the order the two controls actually relate in. */}
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-paper text-brass-dark"
          title="How this module's icon looks right now"
        >
          {custom && customKind === "image" ? (
            // Read straight from the route rather than through `ModuleIcon`: the
            // provider map is built by the protected layout and will not have
            // this upload until the page revalidates, so the preview would lag a
            // beat behind the thing it is previewing.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/modules/${encodeURIComponent(slug)}/icon${
                iconVersion ? `?v=${encodeURIComponent(iconVersion)}` : ""
              }`}
              alt=""
              aria-hidden="true"
              className="h-5 w-5 object-contain"
            />
          ) : (
            <ModuleIcon slug={slug} name={selected} className="h-5 w-5" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">
            {custom
              ? "Showing uploaded artwork. The glyphs above are ignored until you remove it."
              : "Or upload your own — an SVG, PNG, JPEG, WebP or GIF, under 256 KB."}
          </p>
          {/* Said before the upload rather than after, because it is the one
              thing about a raster icon that surprises people: it keeps its own
              colours while the label beside it goes brass. */}
          {custom && customKind === "image" && (
            <p className="mt-0.5 text-xs text-brass-dark">
              A picture can&apos;t follow the theme colour — it stays as uploaded, including
              in the active navigation row. Upload an SVG if you want it to tint.
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 max-lg:w-full">
          <input
            ref={fileInput}
            type="file"
            accept="image/svg+xml,image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={isBusy}
            onClick={() => fileInput.current?.click()}
          >
            {custom ? "Replace" : "Upload"}
          </Button>
          {custom && (
            <Button size="sm" variant="secondary" disabled={isBusy} onClick={handleRemove}>
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
