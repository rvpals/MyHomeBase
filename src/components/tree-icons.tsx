"use client";

import type { ReactElement, SVGProps } from "react";
import { useIconSet } from "./icon-set-context";
import type { ModuleIconSetId } from "./module-icon-sets.generated";
import { TREE_ICON_GLYPHS } from "./tree-icon-sets.generated";

type IconComponent = (props: SVGProps<SVGSVGElement>) => ReactElement;

const shared = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

// A lightning bolt, filled. The mark for "do this for me automatically" — it leads
// the generate-an-icon row action in the journal's Categories & Tags editor.
//
// Filled rather than outlined: at 16px an outlined bolt is two zig-zag strokes that
// read as noise, while the solid shape stays legible. That makes it the one row
// action that isn't line art, which is deliberate — it *acts* rather than opening
// something, like `trash` does.
const Flash: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M13 2L4.5 13.2h5.2L10 22l8.5-11.2h-5.2z" fill="currentColor" stroke="none" />
  </svg>
);

const Sliders: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <line x1="4" y1="6" x2="20" y2="6" />
    <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
    <line x1="4" y1="18" x2="20" y2="18" />
    <circle cx="11" cy="18" r="2" fill="currentColor" stroke="none" />
  </svg>
);

// A cog. The near-universal mark for settings, and the counterpart to `sliders`
// — reach for this when the section *is* configuration, and for `sliders` when it
// is a set of adjustable values.
//
// Eight teeth drawn as one path rather than eight rotated rects: at 16px the
// rects render as mush, and a single outline stays legible.
const Gear: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M12 3.5l1.6 1.1 1.9-.5.9 1.7 1.9.6-.1 2 1.4 1.4-1.1 1.6.5 1.9-1.7.9-.6 1.9-2-.1-1.4 1.4-1.6-1.1-1.9.5-.9-1.7-1.9-.6.1-2L5.4 12l1.1-1.6-.5-1.9 1.7-.9.6-1.9 2 .1z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

// A classroom: a teaching board on a stand. Distinct from `users` (a roster of
// people) and `list` (a generic list) so "Classes" and "Rosters" don't read as
// the same idea in one nav.
const Classroom: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <rect x="3" y="4" width="18" height="12" rx="1.5" />
    <path d="M7 9.5h6" />
    <path d="M7 12.5h4" />
    <path d="M12 16v4" />
    <path d="M8.5 20h7" />
  </svg>
);

const Grid: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <rect x="4" y="4" width="7" height="7" rx="1" />
    <rect x="13" y="4" width="7" height="7" rx="1" />
    <rect x="4" y="13" width="7" height="7" rx="1" />
    <rect x="13" y="13" width="7" height="7" rx="1" />
  </svg>
);

const Window: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <circle cx="6.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="9" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

const Palette: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M12 3a9 8 0 1 0 0 16c1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H16a5 5 0 0 0 5-5c0-3.9-4-6-9-6Z" />
    <circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="9.5" cy="7" r="1" fill="currentColor" stroke="none" />
    <circle cx="14" cy="6.7" r="1" fill="currentColor" stroke="none" />
    <circle cx="17" cy="9.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

const Info: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="11" x2="12" y2="16" />
    <circle cx="12" cy="7.5" r="0.75" fill="currentColor" stroke="none" />
  </svg>
);

const History: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </svg>
);

const Users: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <circle cx="17" cy="9" r="2.2" />
    <path d="M15.5 14.2c2.3.4 4 2.1 4 4.8" />
  </svg>
);

const Database: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />
    <path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" />
  </svg>
);

const Shapes: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M8.5 3.5l4.5 7H4Z" />
    <circle cx="16.5" cy="7" r="3.2" />
    <rect x="4" y="14" width="7" height="6.5" rx="1" />
    <rect x="13.5" y="14" width="6.5" height="6.5" rx="1" />
  </svg>
);

// A magician's top hat with a baton laid across it, plus two sparks. The mark for
// "conjure me a playlist" -- the criteria form takes a few constraints and pulls a
// result out of the hat.
//
// The hat is a brim line plus a tapered crown rather than an outlined silhouette:
// at 16px a closed hat shape fills in and reads as a solid blob, whereas the open
// crown-over-brim keeps two distinct strokes. The baton is one diagonal with a
// contrasting tip, and the sparks are 4-point stars -- at nav-row size a 6-point
// star loses its points, so 4 is the honest maximum.
const MagicHat: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M8 12.5V6.2c0-1 .8-1.7 1.8-1.7h2.4c1 0 1.8.7 1.8 1.7v6.3" />
    <path d="M5.2 12.6h11.6" />
    <path d="M14.6 16.8l5.6-6.2" />
    <path d="M19.4 11.5l1.6 1.4" />
    <path d="M4.6 17.6l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5Z" />
    <path d="M18.7 3.2l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4Z" />
  </svg>
);

// A turntable: platter, spindle, record groove and tonearm. The player section is
// "the current track with artwork", and a record player is the one object that says
// that without a music glyph in the set.
//
// The tonearm crosses onto the platter rather than stopping at its edge -- an arm
// that stops short reads as a stray tick at 16px. The pivot dot is filled so the
// arm has an anchor when the strokes thin out.
const RecordPlayer: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
    <circle cx="10.5" cy="12" r="5" />
    <circle cx="10.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <path d="M18.4 7.6v4.2c0 1.4-1.1 2.6-2.5 3.4l-1.6.9" />
    <circle cx="18.4" cy="7.2" r="1" fill="currentColor" stroke="none" />
  </svg>
);

// An open book with a quill laid across it. At 16px the book is a plain
// silhouette and the quill a single stroke — a feathered nib turns to mush at
// nav-row size, so the diagonal plus the split tip is what reads as "quill".
const Quote: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M3.5 6.2c2.6-1 5.2-1 7.8.6v11c-2.6-1.6-5.2-1.6-7.8-.6Z" />
    <path d="M11.3 6.8c1.2-.7 2.4-1.1 3.6-1.2" />
    <path d="M11.3 17.8v-11" />
    <path d="M20.5 3.5c-1.2 3.4-3.4 6.2-6.4 8.4l-1.7 1.2 1-1.9c1.8-3.4 4.2-6 7.1-7.7Z" />
    <path d="M14.7 10.3l1.4 1.5" />
  </svg>
);

// A stock quote: the price board with an up-tick running across it. Distinct from
// `quote` (a quotation — book and quill) on purpose; they used to share that key
// and read as the wrong sense of the word in this module.
const StockQuote: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="M6.5 14.5l3.5-3.5 2.5 2.5 4.5-4.5" />
    <path d="M14 9h3v3" />
  </svg>
);

const ListRows: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="14" y2="17" />
  </svg>
);

const Chart: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M4 20V4" />
    <path d="M4 20h16" />
    <rect x="8" y="12" width="3" height="5" />
    <rect x="14" y="8" width="3" height="9" />
  </svg>
);

const Upload: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M12 16V5" />
    <path d="M8 9l4-4 4 4" />
    <path d="M5 19h14" />
  </svg>
);

const Newspaper: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M4 5.5h12a1 1 0 0 1 1 1V19H5.5A1.5 1.5 0 0 1 4 17.5Z" />
    <path d="M17 8.5h2a1 1 0 0 1 1 1v8a1.5 1.5 0 0 1-3 0" />
    <line x1="7" y1="9" x2="14" y2="9" />
    <line x1="7" y1="12" x2="14" y2="12" />
    <line x1="7" y1="15" x2="11" y2="15" />
  </svg>
);

const Plus: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

// A sticky note with the corner turned up. The fold is the whole read at 16px —
// a plain rounded square is a card, a button, or anything else; the clipped
// corner plus the diagonal is what says "note stuck onto something".
const Note: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M5 4.5h9.5L19.5 9.5V19a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5Z" />
    <path d="M14.5 4.5v5h5" />
    <line x1="7.5" y1="13" x2="14" y2="13" />
    <line x1="7.5" y1="16" x2="12" y2="16" />
  </svg>
);

// A paper clip. Drawn as one open stroke rather than a closed loop: at nav-row
// size the inner gap of a true double-bend fills in and the glyph turns into a
// solid blob.
const Clip: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M16.5 8.2 9.3 15.4a2.4 2.4 0 0 0 3.4 3.4l7.1-7.2a4.3 4.3 0 0 0-6.1-6.1l-7.1 7.2a6.2 6.2 0 0 0 8.7 8.7" />
  </svg>
);

const Shield: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M12 3l7 3v5.5c0 4.2-2.9 8-7 9.5-4.1-1.5-7-5.3-7-9.5V6l7-3Z" />
    <path d="M9.5 12l1.8 1.8 3.2-3.6" />
  </svg>
);

// A circular arrow. Drawn as a three-quarter arc with a gap at the top right
// and a chevron head closing it: a full circle plus an arrowhead reads as a
// clock at 16px, and the open gap is what makes the direction legible.
const Refresh: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 4v4.5h-4.5" />
  </svg>
);

/* Row-action glyphs. Not nav keys — they live here so the app keeps one
   monochrome glyph registry rather than a pencil per view. */
const Pencil: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5z" />
    <path d="M13.5 6.5l4 4" />
  </svg>
);

const Trash: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M4 7h16" />
    <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
    <path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

const Search: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <line x1="15.2" y1="15.2" x2="20.5" y2="20.5" />
  </svg>
);

const Star: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M12 3.6l2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 17l-5.25 2.75 1-5.85L3.5 9.75l5.9-.85z" />
  </svg>
);

/* The filled twin of `Star`, for the on state of a favorite toggle. Outline vs
   solid is what carries the state here, so the two must stay the same silhouette —
   a different shape would read as a different concept rather than a different
   state. */
const StarFilled: IconComponent = (props) => (
  <svg {...shared} {...props} fill="currentColor">
    <path d="M12 3.6l2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 17l-5.25 2.75 1-5.85L3.5 9.75l5.9-.85z" />
  </svg>
);

/* A heart, for the favourite toggle on the home screen's random photo card.

   A second favourite mark alongside `star`, which is not a duplication to be tidied
   away: the star means "a symbol I want to reach quickly" in the stocks module, and
   this means "a picture I want to keep". Sharing one glyph would make the favourites
   list on one screen look like the jump list on the other. */
const Heart: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M12 20.3l-1.45-1.32C5.4 14.36 2 11.28 2 7.5A4.5 4.5 0 0 1 6.5 3c1.74 0 3.41.81 4.5 2.09A5.98 5.98 0 0 1 15.5 3 4.5 4.5 0 0 1 20 7.5c0 3.78-3.4 6.86-8.55 11.48z" />
  </svg>
);

/* The filled twin of `Heart`, for the on state. Outline vs solid is what carries the
   state here, so the two must stay the same silhouette — a different shape would read
   as a different concept rather than a different state. Same rule as `star`. */
const HeartFilled: IconComponent = (props) => (
  <svg {...shared} {...props} fill="currentColor">
    <path d="M12 20.3l-1.45-1.32C5.4 14.36 2 11.28 2 7.5A4.5 4.5 0 0 1 6.5 3c1.74 0 3.41.81 4.5 2.09A5.98 5.98 0 0 1 15.5 3 4.5 4.5 0 0 1 20 7.5c0 3.78-3.4 6.86-8.55 11.48z" />
  </svg>
);

/* A stack of photographs with a heart on the top one: the mark for "the pictures I
   have kept", on the Random Photo card's button that opens the My Favorite Photos
   screen.

   Its own glyph rather than reusing `heart`, and that distinction is the whole point.
   The heart immediately to its left is a TOGGLE whose outline-vs-solid state says
   whether THIS photograph is kept; this button is a DESTINATION. Drawn with the same
   glyph, the card's header read as two hearts doing different things, which is how it
   shipped and why it needed fixing.

   Not `photo` either: that is the card's own title mark, and a header whose title icon
   and last button are identical is no clearer than two hearts.

   The stack is what carries "several, collected" — two offset rectangles behind the
   front one. At 16px the back edges read as a thickness rather than as three countable
   frames, which is the intent: the heart is the detail that has to survive, so it sits
   in the front frame's open middle with nothing crossing it. */
const PhotoStack: IconComponent = (props) => (
  <svg {...shared} {...props}>
    {/* The two frames behind, drawn as open edges rather than whole rectangles — a
        full outline at this size closes into a grey block. */}
    <path d="M7.5 5.5h9a1.5 1.5 0 0 1 1.5 1.5" />
    <path d="M5.5 8h11.5" opacity="0.55" />
    {/* The front frame, and the kept photograph's heart inside it.

        The heart is FILLED while everything around it is stroked, which is not an
        inconsistency: at 16px it is about 5px across, and an outline heart that small
        loses its inner counter — the two strokes meet and it reads as a blob. Solid, it
        stays a heart. `HeartFilled` and `star-filled` are drawn the same way. */}
    <rect x="3.5" y="10" width="14" height="9.5" rx="1.6" />
    <path
      d="M10.5 17.2c-1.9-1.55-2.9-2.5-2.9-3.5a1.45 1.45 0 0 1 2.9-.5 1.45 1.45 0 0 1 2.9.5c0 1-1 1.95-2.9 3.5z"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);

/* A framed photograph: a rounded rect, a sun, and a hill. The mark for "show me the
   pictures", used on the journal calendar's per-day and per-month photo buttons.

   Drawn to survive 14px, which is the size it renders at inside a calendar cell: one
   frame, one circle and one ridge, with nothing else competing. A stack-of-photos
   glyph was tried first and turned to mush at that size — the offset second frame
   reads as a smudge rather than as depth. */
const Photo: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
    <circle cx="8.75" cy="9.75" r="1.6" />
    <path d="M3.5 16.5l4.75-4.25 4 3.5 3.25-2.75 4.5 4" />
  </svg>
);

const TREE_ICONS = {
  flash: Flash,
  note: Note,
  clip: Clip,
  shield: Shield,
  refresh: Refresh,
  pencil: Pencil,
  trash: Trash,
  sliders: Sliders,
  gear: Gear,
  classroom: Classroom,
  list: ListRows,
  newspaper: Newspaper,
  plus: Plus,
  chart: Chart,
  upload: Upload,
  quote: Quote,
  "stock-quote": StockQuote,
  grid: Grid,
  window: Window,
  palette: Palette,
  info: Info,
  history: History,
  users: Users,
  database: Database,
  shapes: Shapes,
  search: Search,
  magic: MagicHat,
  player: RecordPlayer,
  star: Star,
  "star-filled": StarFilled,
  heart: Heart,
  "heart-filled": HeartFilled,
  "photo-stack": PhotoStack,
  photo: Photo,
} as const;

export type TreeIconName = keyof typeof TREE_ICONS;

/**
 * Whether `TreeIcon` will actually draw something for this key.
 *
 * `TreeIcon` renders `null` for an unknown one, which is right inside a row — the
 * label still carries the meaning. Somewhere the icon is the *only* content (the
 * compact puck) that same `null` is a blank button, so the caller needs to be
 * able to check first and fall back.
 */
export function hasTreeIcon(name?: string): name is TreeIconName {
  return name !== undefined && name in TREE_ICONS;
}

/**
 * Row-action glyphs stay hand-drawn in every icon set. They are buttons, not
 * destinations: full-color artwork on an inline edit/delete control shouts, and on
 * `trash` specifically it weakens the destructive read that the monochrome glyph carries.
 */
const ALWAYS_CLASSIC = new Set<TreeIconName>([
  "pencil",
  "trash",
  "refresh",
  "search",
  "flash",
  // A favorite star is a *state*, carried by outline vs solid. A themed set
  // redrawing it would lose that distinction, so both stay hand-drawn.
  "star",
  "star-filled",
  // A favourited photo is a *state* too, carried by outline vs solid exactly as the
  // star is — and the heart is a toggle button on a card header, not a destination.
  "heart",
  "heart-filled",
  // The calendar's photo button is a 14px control inside a grid cell. Full-color
  // artwork at that size is a coloured blob, and it would fight the day number it
  // sits beside.
  "photo",
  // Sits beside the heart toggle in the Random Photo card's header. Its job is to be
  // legibly NOT that heart, which a themed set's own "favourites" artwork — very often
  // a heart — would undo.
  "photo-stack",
]);

/**
 * Whether the active set will draw this icon in its own colors rather than inheriting
 * `currentColor`. Callers use it to drop an accent tint that would otherwise fight the
 * artwork — the same rule `ICON_SETS.colorful` already drives for the module badge.
 *
 * False for a row action, and for any concept the set doesn't cover, since both of those
 * fall through to the hand-drawn glyph and *do* tint.
 */
export function useTreeIconIsColorful(name?: string): boolean {
  const { id, colorful } = useIconSet();
  if (!colorful || !hasTreeIcon(name)) return false;
  if (ALWAYS_CLASSIC.has(name)) return false;
  return Boolean(TREE_ICON_GLYPHS[id]?.[name]);
}

/**
 * A section icon in the reader's chosen icon set.
 *
 * Resolution order mirrors `ModuleIcon`: the active set's baked glyph, then the hand-drawn
 * one above. The fallback is load-bearing rather than defensive — no set covers all 23
 * concepts (flat-color has no paperclip), and a keyword-matched near-miss looks worse than
 * the drawing it would replace.
 */
export function TreeIcon({
  name,
  className,
}: {
  name?: string;
  className?: string;
}) {
  const { id } = useIconSet();
  if (!hasTreeIcon(name)) return null;

  const glyph = ALWAYS_CLASSIC.has(name) ? undefined : TREE_ICON_GLYPHS[id as ModuleIconSetId]?.[name];
  if (glyph) {
    return (
      <svg
        viewBox={`0 0 ${glyph.w} ${glyph.h}`}
        className={className}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: glyph.body }}
      />
    );
  }

  const Icon = TREE_ICONS[name];
  return <Icon className={className} aria-hidden="true" />;
}
