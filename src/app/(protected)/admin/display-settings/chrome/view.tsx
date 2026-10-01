"use client";

// The Chrome Style picker: four cards, each previewing the treatment it selects.
//
// A draft field on the admin shell rather than a screen with its own Save
// button, matching the color theme and icon set pickers — `useAdminSettings()`
// holds the pick and the shell's "Save Settings" commits it. That is why this
// file has no `actions.ts` beside it.
//
// **Each card previews itself by scoping the real CSS, not by copying it.** The
// preview markup carries `.chrome-bar`, `.chrome-frame` and `.chrome-slab` inside
// a wrapper with its own `data-chrome-style`, so the rules in globals.css that
// style the actual chrome are the rules that draw these thumbnails. A second
// hand-written copy of four bevels is exactly the kind of thing that drifts.
//
// **Only those three hooks, never `.shell-tree`.** `.shell-tree` is the real
// column's LAYOUT — `position: fixed; inset 0 auto 0 0; width: 260px;
// z-index: 31`. The first version of this file reused it for the preview column,
// and the eight thumbnails below each escaped their card, stacked at the
// viewport's left edge at full height, and covered the real navigation tree the
// moment this page loaded. The hooks exist precisely so a preview can be styled
// like the chrome without being positioned like it.

import type { ChromeStyle } from "@/lib/settings";
import { CHROME_STYLES } from "@/lib/settings";
import { useAdminSettings } from "../../admin-shell";

/**
 * A miniature of the shell: the header bar above, the tree column beside a
 * scrap of page. Deliberately not a real `AppHeader`/`NavTree` — those need a
 * breadcrumb, a navigation tree, a router and a viewport, and all this has to
 * show is which surfaces are lit and which are shaded.
 *
 * `data-chrome-style` on the wrapper is what makes the globals.css rules apply
 * here: they are written tag-less — `[data-chrome-style="…"] .chrome-bar`, not
 * `html[…]` — precisely so this wrapper matches them too. If someone adds an
 * `html` prefix back to those rules, these previews silently go flat.
 */
function ChromePreview({ style }: { style: ChromeStyle }) {
  return (
    <div
      data-chrome-style={style}
      aria-hidden
      className="mt-3 overflow-hidden rounded-lg border border-line bg-paper"
    >
      {/* The header. `chrome-bar` is the whole of what the real header shares
          with this — the sticky/margin utilities stay behind, and inside a
          120px thumbnail they would only get in the way. */}
      <div className="chrome-bar flex h-7 items-center gap-1.5 border-b border-line bg-paper-raised px-2">
        <span className="h-1.5 w-1.5 rounded-full bg-brass-dark" />
        <span className="h-1 w-10 rounded-full bg-muted/50" />
        <span className="ml-auto h-3 w-3 rounded-full bg-line" />
      </div>

      <div className="flex h-[4.5rem]">
        {/* The tree column, at a miniature of its 260px. `chrome-frame` only —
            NOT `shell-tree`, which would make this `position: fixed` and send it
            to the viewport's left edge over the real navigation. */}
        <div className="chrome-frame flex w-[4.5rem] shrink-0 flex-col gap-1 border-r border-line bg-paper-raised p-1.5">
          {/* Two module slabs, carrying both hooks the real ones do:
              `card-embossed` is the `current` look, `chrome-slab` is what the
              inset/outset/emboss rules override. A preview missing either would
              show the column's bevel but not the slabs'. */}
          <div className="chrome-slab card-embossed rounded border border-line bg-paper-raised px-1 py-1">
            <span className="block h-1 w-8 rounded-full bg-brass-dark" />
          </div>
          <div className="chrome-slab card-embossed rounded border border-line bg-paper-raised px-1 py-1">
            <span className="block h-1 w-6 rounded-full bg-muted/40" />
          </div>
        </div>

        {/* A scrap of page, so the chrome has something to sit against. */}
        <div className="flex-1 space-y-1 p-2">
          <span className="block h-1 w-12 rounded-full bg-muted/40" />
          <span className="block h-1 w-16 rounded-full bg-muted/25" />
          <span className="block h-1 w-10 rounded-full bg-muted/25" />
        </div>
      </div>
    </div>
  );
}

export function ChromeStyleView({
  /** The style currently live — not the shell's draft pick. */
  savedStyle,
}: {
  savedStyle: ChromeStyle;
}) {
  const { chromeStyle, setChromeStyle } = useAdminSettings();

  const hasUnsavedChange = chromeStyle !== savedStyle;

  return (
    <>
      {/* The picker is a draft, and this screen's previews follow the draft while
          the app's own chrome still shows the saved style. Saying so beats
          leaving an admin to wonder why the header above hasn't changed. */}
      {hasUnsavedChange && (
        <p className="mt-6 rounded-lg border border-brass/40 bg-brass-soft px-3 py-2 text-sm text-ink">
          <span className="font-medium">Not saved yet.</span> The previews below show your
          pick; the application&apos;s own header and tree keep the saved style until you
          press <span className="font-medium">Save Settings</span>.
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CHROME_STYLES.map((style) => {
          const active = style.id === chromeStyle;
          return (
            <button
              key={style.id}
              type="button"
              onClick={() => setChromeStyle(style.id)}
              aria-pressed={active}
              className={`rounded-xl border bg-paper-raised p-4 text-left transition ${
                active ? "border-brass ring-2 ring-brass" : "border-line hover:border-brass/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-display text-base font-semibold text-ink">
                  {style.label}
                </span>
                {style.id === savedStyle && (
                  <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                    Saved
                  </span>
                )}
                {active && (
                  <span className="ml-auto shrink-0 rounded-full bg-brass px-2 py-0.5 text-xs font-medium text-paper">
                    Selected
                  </span>
                )}
              </div>

              <ChromePreview style={style.id} />

              <p className="mt-3 text-sm text-muted">{style.description}</p>
              <p className="mt-2 text-xs text-muted-inverse">{style.tradeoff}</p>
            </button>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-muted">
        The navigation tree is a desktop surface — on a phone the bottom bar takes its
        place, so only the header treatment is visible there. Every style is built from the
        theme&apos;s own tokens, so each one follows the color theme rather than fighting it.
      </p>
    </>
  );
}
