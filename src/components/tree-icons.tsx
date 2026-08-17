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

const TREE_ICONS = {
  note: Note,
  clip: Clip,
  shield: Shield,
  refresh: Refresh,
  pencil: Pencil,
  trash: Trash,
  sliders: Sliders,
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

export function TreeIcon({
  name,
  className,
}: {
  name?: string;
  className?: string;
}) {
  const Icon = TREE_ICONS[name as TreeIconName];
  if (!Icon) return null;
  return <Icon className={className} aria-hidden="true" />;
}
