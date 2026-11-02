// The glyphs the Document Library's row actions are drawn with.
//
// A small registry of its own rather than entries in `TREE_ICONS`, for the reason
// `attendance-action-icon.tsx` records: a name added there costs a hand-drawn glyph
// for the `classic` set *plus* a named candidate for all 12 generated sets in
// `scripts/gen-icon-glyphs.mjs`, or the generator fails. That price buys consistency
// for a module's identity glyph. These are row actions — `coding-guide.md` →
// *What must NOT become a slot* puts pencil/trash/refresh/search in exactly this
// category and keeps them hand-drawn, so an inline delete can't become full-colour
// artwork that weakens the destructive read. No icon slot points at any of them.
//
// `pencil` and `x` deliberately duplicate nothing: `TREE_ICONS` has a `pencil`, and
// this file does not redraw it — `RowActionBar` callers pass whichever node they
// like. What lives here are the two concepts the tree table has no name for
// (`FilesGlyph`, `DownloadAllGlyph`) and the `XGlyph` the delete button asks for,
// which is a cross rather than the app's usual `trash`.
//
// Monochrome and `currentColor` throughout, so the button's own text colour drives
// them — the same contract `TreeIcon`'s hand-drawn set honours.

import type { ReactElement, SVGProps } from "react";

type IconComponent = (props: SVGProps<SVGSVGElement>) => ReactElement;

const shared = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/**
 * A folder with a sheet of paper rising out of it — "show files and folders".
 *
 * Both halves are needed: a folder alone reads as "a place to put things" (which is
 * what the module's tree view means), and a sheet alone reads as one document. The
 * pair is what says *the files inside this record*. The sheet is offset right and
 * sits above the folder's front flap so the two shapes stay separable at 16px
 * instead of merging into one blob.
 */
const FilesGlyph: IconComponent = (props) => (
  <svg {...shared} {...props}>
    {/* The folder: back panel with a tab, then the front flap across it. */}
    <path d="M2.5 19.5V6.2a1 1 0 0 1 1-1h5l1.8 2.2h5.2a1 1 0 0 1 1 1v1.3" />
    <path d="M2.5 19.5h14.3a1 1 0 0 0 1-1V13" />
    {/* The sheet, folded corner top-right, standing proud of the folder. */}
    <path d="M14.5 3.5h4l3 3v8h-7z" />
    <path d="M18.5 3.5v3h3" />
  </svg>
);

/**
 * A stack of sheets with an arrow coming down out of it — "download all".
 *
 * The *stack* is the whole point and is what separates this from a plain download:
 * two offset edges behind the front sheet say "more than one file". The arrow
 * leaves the stack downward and lands on a short baseline, which is the shape every
 * download control in a browser already uses, so it needs no learning.
 */
const DownloadAllGlyph: IconComponent = (props) => (
  <svg {...shared} {...props}>
    {/* The two sheets behind, drawn as edges only — a full outline each would be
        three nested rectangles of near-identical size and read as noise at 16px. */}
    <path d="M7.5 4.5h7l3 3v1" />
    <path d="M5.5 7.5h6l3 3v1" />
    {/* The front sheet. */}
    <path d="M3.5 10.5h6.5l2.5 2.5v6.5h-9z" />
    {/* The arrow out of the stack, onto its baseline. */}
    <path d="M18 11v6" />
    <path d="M15.5 14.5 18 17l2.5-2.5" />
    <path d="M15 20h6" />
  </svg>
);

/**
 * A pen nib on a stroke — "edit".
 *
 * A nib rather than the tree table's `pencil`: the two sit in the same bar as a
 * drawn `x`, and a pencil's body and a cross's arms are the same two diagonals at
 * 16px. The nib's split tip and the ink stroke under it are what keep this
 * legibly *not* the delete button beside it.
 */
const PenGlyph: IconComponent = (props) => (
  <svg {...shared} {...props}>
    {/* The barrel, running up to the right. */}
    <path d="M8.5 16.5 17 8a2.1 2.1 0 1 1 3 3l-8.5 8.5-4 1z" />
    {/* The split in the nib, which is what makes it a pen and not a pencil. */}
    <path d="M15.5 9.5 18.5 12.5" />
    <path d="M11.5 19.5 7.5 15.5" />
  </svg>
);

/**
 * A cross — "delete".
 *
 * Two strokes, drawn to the same 24px box as the rest so it carries the same
 * optical weight as the glyphs beside it; a bare `×` character would sit smaller
 * and lighter than the three drawn icons and read as a dismiss, not a delete.
 */
const XGlyph: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M6.5 6.5 17.5 17.5" />
    <path d="M17.5 6.5 6.5 17.5" />
  </svg>
);

export { FilesGlyph, DownloadAllGlyph, PenGlyph, XGlyph };
