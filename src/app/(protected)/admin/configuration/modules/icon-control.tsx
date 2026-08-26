"use client";

// Pick the glyph a module shows on the module rail, the home grid, and as its
// carousel fallback.
//
// Route-local rather than a registered component, matching `CarouselImageControl`
// beside it: it's one admin control bound to this screen's action, and
// `components.md` keeps page-specific UI out of the registry.
//
// A grid of glyphs, not `IconSelect`. That component shows an option's icon from
// a URL, and these icons aren't URLs — they're inline SVG bodies resolved
// through the reader's chosen icon set. A grid also suits the job better: there
// are thirteen names, all of them visual, so showing them at once is faster than
// opening a dropdown to read words for pictures.
//
// The write happens on pick rather than on the page's Save button, because this
// same value draws the rail and the home grid — a glyph chosen but unsaved would
// leave the card disagreeing with the chrome around it.

import { useState } from "react";
import { ModuleIcon } from "@/components/module-icons";
import { MODULE_ICON_NAMES } from "@/lib/modules";
import { saveModuleIconAction } from "../../actions";

/** Sentence-case for the button's label — the stored names are lowercase. */
function labelFor(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function ModuleIconControl({
  slug,
  moduleName,
  icon,
}: {
  slug: string;
  moduleName: string;
  icon: string;
}) {
  // Owned here, not in the admin form's draft: this control persists its own
  // writes, so the form has no say in the value after first render.
  const [selected, setSelected] = useState(icon);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);

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

  return (
    <div className="mt-4 rounded-lg border border-line p-3">
      <p className="text-sm font-medium text-ink">Icon</p>
      <p className="mt-0.5 text-xs text-muted">
        Drawn on the module rail, the home screen grid, and the carousel when there&apos;s no
        graphic. Shown in the icon set chosen under Configuration &rarr; Icons. Saved as soon
        as you pick one.
      </p>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}

      {/* Wraps rather than using a fixed column count, so thirteen 44px targets
          reflow down to a phone without any `max-lg:` override. 44px is the
          minimum comfortable tap target. */}
      <div
        role="radiogroup"
        aria-label={`Icon for ${moduleName}`}
        className="mt-3 flex flex-wrap gap-2"
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
              <ModuleIcon name={name} className="h-5 w-5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
