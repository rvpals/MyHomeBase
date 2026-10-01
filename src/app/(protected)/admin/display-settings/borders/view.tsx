"use client";

// The Border Weight controls: three number inputs, each with a live preview.
//
// Draft fields on the admin shell rather than a screen with its own Save button,
// matching Chrome Style and the theme and icon pickers — `useAdminSettings()`
// holds the values and the shell's "Save Settings" commits them. That is why
// this file has no `actions.ts` beside it.
//
// **The previews set the CSS variables locally rather than reimplementing the
// borders.** Each row renders miniature markup wearing the real hook classes
// (`chrome-bar`, `chrome-frame`, `chrome-slab`, `nav-divider`) inside a wrapper
// whose inline `style` overrides the three width variables — so the rules in
// globals.css that draw the real chrome are the rules that draw these
// thumbnails, at the drafted width, before anything is saved.
//
// As in the Chrome Style picker, the preview never wears `.shell-tree`: that
// class is `position: fixed` layout, and reusing it there once sent eight
// preview columns to the viewport's left edge on top of the real navigation.

import type { CSSProperties, ReactElement } from "react";
import type { BorderWidths } from "@/lib/settings";
import { BORDER_WIDTH_KEYS, MAX_BORDER_WIDTH, MIN_BORDER_WIDTH } from "@/lib/settings";
import { useAdminSettings } from "../../admin-shell";

/**
 * The variable overrides for one preview row.
 *
 * Only the axis being previewed moves; the other two stay at 1px so the row
 * shows that axis in isolation rather than whatever the other drafts happen to
 * be. `CSSProperties` doesn't type custom properties, hence the cast — the same
 * one every other custom-property style object in this app uses.
 */
function previewStyle(axis: keyof BorderWidths, width: number): CSSProperties {
  const px = (key: keyof BorderWidths) => `${key === axis ? width : 1}px`;
  return {
    "--chrome-outline-width": px("outline"),
    "--chrome-divider-width": px("divider"),
    "--line-width": px("line"),
  } as CSSProperties;
}

/** The chrome's outer edges: a header bar above a column beside a scrap of page. */
function OutlinePreview() {
  return (
    <div className="overflow-hidden rounded-lg border-line bg-paper" aria-hidden>
      <div className="chrome-bar flex h-6 items-center gap-1.5 border-line bg-paper-raised px-2">
        <span className="h-1.5 w-1.5 rounded-full bg-brass-dark" />
        <span className="h-1 w-8 rounded-full bg-muted/50" />
      </div>
      <div className="flex h-14">
        <div className="chrome-frame flex w-14 shrink-0 flex-col gap-1 border-line bg-paper-raised p-1.5">
          <div className="chrome-slab rounded border-line bg-paper-raised px-1 py-1">
            <span className="block h-1 w-6 rounded-full bg-brass-dark" />
          </div>
          <div className="chrome-slab rounded border-line bg-paper-raised px-1 py-1">
            <span className="block h-1 w-5 rounded-full bg-muted/40" />
          </div>
        </div>
        <div className="flex-1 space-y-1 p-2">
          <span className="block h-1 w-10 rounded-full bg-muted/40" />
          <span className="block h-1 w-14 rounded-full bg-muted/25" />
        </div>
      </div>
    </div>
  );
}

/** The column's inner rules: the filter row's underline and a grouped box. */
function DividerPreview() {
  return (
    <div className="overflow-hidden rounded-lg border-line bg-paper" aria-hidden>
      {/* `chrome-frame` so the `.chrome-frame .nav-*` rules match — they are
          scoped to the column on purpose, so an unscoped preview shows nothing. */}
      <div className="chrome-frame w-full border-line bg-paper-raised p-1.5">
        <div className="nav-divider flex items-center gap-1 border-line pb-1.5">
          <span className="nav-field flex-1 rounded border-line bg-paper px-1 py-1">
            <span className="block h-1 w-10 rounded-full bg-muted/40" />
          </span>
        </div>
        <div className="nav-group mt-1.5 overflow-hidden rounded border-line bg-paper">
          <div className="nav-group-head border-line px-1 py-1">
            <span className="block h-1 w-8 rounded-full bg-muted/50" />
          </div>
          <div className="space-y-1 p-1">
            <span className="block h-1 w-12 rounded-full bg-muted/25" />
            <span className="block h-1 w-9 rounded-full bg-muted/25" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Everything else: two cards and a small table, the shapes this axis reaches. */
function LinePreview() {
  return (
    <div className="space-y-2" aria-hidden>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-line bg-paper-raised p-2">
          <span className="block h-1 w-8 rounded-full bg-muted/40" />
          <span className="mt-1.5 block h-2 w-10 rounded-full bg-brass-dark/60" />
        </div>
        <div className="rounded-lg border border-line bg-paper-raised p-2">
          <span className="block h-1 w-9 rounded-full bg-muted/40" />
          <span className="mt-1.5 block h-2 w-8 rounded-full bg-muted/40" />
        </div>
      </div>
      {/* A single-side rule, which is the case the app-wide selector has to get
          right: 120 call sites draw only a `border-b`, and a blanket
          `border-width` would turn every one of them into a full box. */}
      <div className="rounded-lg border border-line bg-paper-raised p-2">
        <div className="border-b border-line pb-1">
          <span className="block h-1 w-12 rounded-full bg-muted/50" />
        </div>
        <div className="border-b border-line py-1">
          <span className="block h-1 w-16 rounded-full bg-muted/25" />
        </div>
        <div className="pt-1">
          <span className="block h-1 w-10 rounded-full bg-muted/25" />
        </div>
      </div>
    </div>
  );
}

const PREVIEWS: Record<keyof BorderWidths, () => ReactElement> = {
  outline: OutlinePreview,
  divider: DividerPreview,
  line: LinePreview,
};

export function BorderWeightView({
  /** The weights currently live — not the shell's drafts. */
  savedWidths,
}: {
  savedWidths: BorderWidths;
}) {
  const { borderWidths, setBorderWidth } = useAdminSettings();

  const hasUnsavedChange = BORDER_WIDTH_KEYS.some(
    (axis) => borderWidths[axis.key] !== savedWidths[axis.key],
  );

  return (
    <>
      {hasUnsavedChange && (
        <p className="mt-6 rounded-lg border border-brass/40 bg-brass-soft px-3 py-2 text-sm text-ink">
          <span className="font-medium">Not saved yet.</span> The previews below show your
          values; the application itself keeps the saved weights until you press{" "}
          <span className="font-medium">Save Settings</span>.
        </p>
      )}

      <div className="mt-8 space-y-4">
        {BORDER_WIDTH_KEYS.map((axis) => {
          const value = borderWidths[axis.key];
          const Preview = PREVIEWS[axis.key];
          const inputId = `border-width-${axis.key}`;

          return (
            <div
              key={axis.key}
              className="rounded-xl border border-line bg-paper-raised p-4 sm:flex sm:items-start sm:gap-6"
            >
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={inputId}
                  className="font-display text-base font-semibold text-ink"
                >
                  {axis.label}
                </label>
                <p className="mt-1 text-sm text-muted">{axis.description}</p>
                <p className="mt-1.5 text-xs text-muted-inverse">{axis.where}</p>

                <div className="mt-3 flex items-center gap-2">
                  <input
                    id={inputId}
                    type="number"
                    min={MIN_BORDER_WIDTH}
                    max={MAX_BORDER_WIDTH}
                    step={1}
                    value={value}
                    // `valueAsNumber` rather than parsing `value`: an empty input
                    // gives NaN, which `parseBorderWidth` floors to the minimum
                    // instead of leaving the field in an uncontrolled state.
                    onChange={(event) =>
                      setBorderWidth(axis.key, event.target.valueAsNumber)
                    }
                    className="w-20 rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink focus:border-brass focus:outline-none focus:ring-2 focus:ring-brass-soft"
                  />
                  <span className="text-sm text-muted">
                    px{" "}
                    <span className="text-muted-inverse">
                      ({MIN_BORDER_WIDTH}&ndash;{MAX_BORDER_WIDTH})
                    </span>
                  </span>
                  {value !== savedWidths[axis.key] && (
                    <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                      saved: {savedWidths[axis.key]}px
                    </span>
                  )}
                </div>
              </div>

              {/* The preview, at this axis's drafted width with the other two
                  pinned to 1px so the row shows one axis at a time. */}
              <div className="mt-4 w-full shrink-0 sm:mt-0 sm:w-56" style={previewStyle(axis.key, value)}>
                <Preview />
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-muted">
        &ldquo;Everything else&rdquo; is the widest-reaching of the three — it touches
        cards, tables, inputs and panels on every screen. Worth a look at a few screens,
        and on a phone, before settling above 2px: a weight that reads as crisp on a
        monitor can read as heavy on a narrow layout.
      </p>
    </>
  );
}
