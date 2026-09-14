// A small picture of what a compact navigation style looks like on a phone.
//
// Pure presentation: it takes a style id and draws a thumbnail. No data
// fetching, no state, and the only `lib` import is the style type.
//
// Drawn with divs and theme tokens rather than shipped as an image, for three
// reasons: it follows the reader's colour theme (a PNG would be wrong on every
// theme but the one it was captured under), it stays legible at any zoom, and it
// costs no upload — which also means no icon slot, since nothing here is a glyph
// standing for a place.
//
// It is a *diagram*, not a live render of `SectionPanel`. Keeping it separate is
// deliberate: embedding the real shell in a settings card would drag a router, a
// module list and the whole sheet state into a preview, and the preview needs to
// show the *closed* bar — which is exactly the state the real one hides.

import type { CompactNavStyle } from "@/lib/user-preferences";

export interface NavStylePreviewProps {
  /** Which style to draw. */
  style: CompactNavStyle;
  /** Drawn as the chosen one: brass bar, brighter frame. */
  selected?: boolean;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/** One greyed line of pretend page content. */
function ContentLine({ width }: { width: string }) {
  return <div className="h-1.5 rounded-full bg-line" style={{ width }} />;
}

/**
 * The bar at the foot of the thumbnail — the part that differs between styles.
 *
 * `selected` tints it brass so the picture itself shows which option is active,
 * rather than relying on the card's ring alone.
 */
function PreviewBar({ style, selected }: { style: CompactNavStyle; selected: boolean }) {
  const tint = selected ? "bg-brass-soft" : "bg-paper";
  // Matches the real bar's `.shell-accent-text` (see globals.css) rather than
  // `--brass-dark`, so the picture shows the green the reader will actually get.
  const glyph = selected ? "bg-brass" : "bg-muted";
  const label = selected ? "bg-brass-dark" : "bg-line";

  if (style === "segmented") {
    return (
      <div className={`flex items-stretch border-t border-line ${tint}`}>
        {/* Left: the module half — an icon and a caret, deliberately narrow, which
            is the trade this style makes. */}
        <div className="flex items-center gap-1 border-r border-line px-1.5 py-2">
          <div className={`h-2 w-2 rounded-sm ${glyph}`} />
          <div className={`h-1 w-1 rounded-full ${label}`} />
        </div>
        {/* Right: the section half, taking the rest of the width. */}
        <div className="flex flex-1 items-center gap-1 px-1.5 py-2">
          <div className={`h-1.5 flex-1 rounded-full ${label}`} />
          <div className={`h-1 w-1 rounded-full ${label}`} />
        </div>
      </div>
    );
  }

  // drill-in: one undivided bar carrying module › section.
  return (
    <div className={`flex items-center gap-1 border-t border-line px-1.5 py-2 ${tint}`}>
      <div className={`h-2 w-2 rounded-sm ${glyph}`} />
      {/* Two runs with a gap between them: the module name, then the section
          name — the "Module › Section" path this style shows while closed. */}
      <div className={`h-1.5 w-3 rounded-full ${label}`} />
      <div className={`h-1.5 flex-1 rounded-full ${label}`} />
      <div className={`h-1 w-1 rounded-full ${label}`} />
    </div>
  );
}

export function NavStylePreview({ style, selected = false, className = "" }: NavStylePreviewProps) {
  return (
    <div
      // `aria-hidden`: the label, description and trade-off next to it already say
      // all of this in words, so a screen reader gains nothing but noise here.
      aria-hidden
      className={`flex h-24 w-16 shrink-0 flex-col overflow-hidden rounded-md border bg-paper-raised ${
        selected ? "border-brass-dark" : "border-line"
      } ${className}`}
    >
      {/* The utility header. Shorter than the bar and carrying no module
          switcher — on compact both styles move that to the bottom edge. */}
      <div className="flex items-center gap-1 border-b border-line px-1.5 py-1.5">
        <div className="h-1 flex-1 rounded-full bg-line" />
        <div className="h-1.5 w-1.5 rounded-full bg-line" />
      </div>

      {/* Page content, so the bar reads as sitting at the bottom of a screen. */}
      <div className="flex flex-1 flex-col gap-1 px-1.5 py-2">
        <ContentLine width="80%" />
        <ContentLine width="55%" />
        <ContentLine width="70%" />
      </div>

      <PreviewBar style={style} selected={selected} />
    </div>
  );
}
