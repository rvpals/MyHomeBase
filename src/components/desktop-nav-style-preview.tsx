// A small picture of what a full-layout navigation shape looks like on a desktop.
//
// The full-layout counterpart of `nav-style-preview.tsx`, and deliberately a
// separate component rather than a mode of it: the compact preview is a 16x24
// portrait thumbnail whose interesting part is the bottom bar, and this one is a
// landscape thumbnail whose interesting part is where the navigation *is*. One
// component drawing both would be two diagrams behind a branch.
//
// Same three reasons it is drawn with divs rather than shipped as an image: it
// follows the reader's colour theme, it stays legible at any zoom, and it costs
// no upload — and so no icon slot, since nothing here is a glyph standing for a
// place.
//
// It is a *diagram*, not a live render of `NavTree` or `NavTabs`.

import type { DesktopNavStyle } from "@/lib/user-preferences";

export interface DesktopNavStylePreviewProps {
  /** Which shape to draw. */
  style: DesktopNavStyle;
  /** Drawn as the chosen one: brass navigation, brighter frame. */
  selected?: boolean;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/** One greyed line of pretend page content. */
function ContentLine({ width }: { width: string }) {
  return <div className="h-1.5 rounded-full bg-line" style={{ width }} />;
}

export function DesktopNavStylePreview({
  style,
  selected = false,
  className = "",
}: DesktopNavStylePreviewProps) {
  // The navigation surface is tinted brass when chosen, so the picture itself
  // shows which option is active rather than relying on the card's ring alone.
  const navTint = selected ? "bg-brass-soft" : "bg-paper";
  const markTint = selected ? "bg-brass-dark/60" : "bg-line";

  return (
    <div
      // `aria-hidden`: the label, description and trade-off beside it already say
      // all of this in words, so a screen reader gains nothing but noise here.
      aria-hidden
      className={`flex h-24 w-32 shrink-0 overflow-hidden rounded-md border bg-paper-raised ${
        selected ? "border-brass-dark" : "border-line"
      } ${className} ${style === "horizontal" ? "flex-col" : "flex-row"}`}
    >
      {style === "tree" ? (
        <>
          {/* The 260px column, drawn to scale: a quarter of the frame's width,
              carrying modules and their indented sections. */}
          <div className={`flex w-1/3 flex-col gap-1 border-r border-line p-1.5 ${navTint}`}>
            <div className={`h-1 w-full rounded-full ${markTint}`} />
            <div className={`h-1 w-full rounded-full ${markTint}`} />
            <div className={`ml-1.5 h-1 w-2/3 rounded-full ${markTint} opacity-60`} />
            <div className={`ml-1.5 h-1 w-2/3 rounded-full ${markTint} opacity-60`} />
            <div className={`ml-1.5 h-1 w-2/3 rounded-full ${markTint} opacity-60`} />
            <div className={`h-1 w-full rounded-full ${markTint}`} />
          </div>
          <div className="flex flex-1 flex-col gap-1.5 p-1.5">
            {/* The utility header the tree shape keeps. */}
            <div className="flex items-center gap-1 border-b border-line pb-1">
              <div className="h-1 flex-1 rounded-full bg-line" />
              <div className="h-1.5 w-1.5 rounded-full bg-line" />
            </div>
            <ContentLine width="85%" />
            <ContentLine width="60%" />
            <ContentLine width="75%" />
          </div>
        </>
      ) : (
        <>
          {/* Tier 1: the module tabs, with the utility cluster at the far end. */}
          <div className={`flex items-center gap-1 border-b border-line px-1.5 py-1 ${navTint}`}>
            <div className={`h-1.5 w-1.5 rounded-full ${markTint}`} />
            <div className={`h-1 w-4 rounded-full ${markTint}`} />
            <div className={`h-1 w-4 rounded-full ${markTint} opacity-60`} />
            <div className={`h-1 w-3 rounded-full ${markTint} opacity-60`} />
            <div className="ml-auto h-1.5 w-1.5 rounded-full bg-line" />
          </div>
          {/* Tier 2: the section chips. */}
          <div className="flex items-center gap-1 border-b border-line px-1.5 py-1">
            <div className="h-1 w-3 rounded-full bg-line" />
            <div className="h-1 w-4 rounded-full bg-line" />
            <div className="h-1 w-3 rounded-full bg-line" />
          </div>
          {/* Content runs the full width — the point of this shape. */}
          <div className="flex flex-1 flex-col gap-1.5 px-1.5 py-2">
            <ContentLine width="92%" />
            <ContentLine width="70%" />
            <ContentLine width="84%" />
          </div>
        </>
      )}
    </div>
  );
}
