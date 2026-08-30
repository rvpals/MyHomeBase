"use client";

import type { ReactElement, SVGProps } from "react";
import type { ModuleIconName } from "@/lib/modules";
import { useIconSet } from "./icon-set-context";
import { MODULE_ICON_GLYPHS, type ModuleIconSetId } from "./module-icon-sets.generated";

type IconComponent = (props: SVGProps<SVGSVGElement>) => ReactElement;

const shared = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const Building: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <rect x="5" y="3" width="14" height="18" rx="1" />
    <circle cx="9" cy="8" r="0.75" fill="currentColor" stroke="none" />
    <circle cx="15" cy="8" r="0.75" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="0.75" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="0.75" fill="currentColor" stroke="none" />
    <circle cx="9" cy="16" r="0.75" fill="currentColor" stroke="none" />
    <circle cx="15" cy="16" r="0.75" fill="currentColor" stroke="none" />
  </svg>
);

const Home: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M4 11l8-7 8 7" />
    <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" />
    <rect x="10" y="14" width="4" height="6" />
  </svg>
);

const Briefcase: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <rect x="3" y="8" width="18" height="12" rx="1.5" />
    <path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="3" y1="13" x2="21" y2="13" />
  </svg>
);

const Wallet: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M3 10h18" />
    <circle cx="16" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

const Chart: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <line x1="4" y1="20" x2="20" y2="20" />
    <rect x="6" y="12" width="3" height="8" fill="currentColor" stroke="none" />
    <rect x="11" y="8" width="3" height="12" fill="currentColor" stroke="none" />
    <rect x="16" y="4" width="3" height="16" fill="currentColor" stroke="none" />
  </svg>
);

const Folder: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </svg>
);

const Shield: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3Z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

const Heart: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M12 20s-7-4.5-9.5-9C.8 7.3 2.3 4 5.5 4 8 4 10 5.5 12 8c2-2.5 4-4 6.5-4 3.2 0 4.7 3.3 3 7-2.5 4.5-9.5 9-9.5 9Z" />
  </svg>
);

const Book: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M12 6c-1.5-1.3-3.5-2-6-2-1 0-2 .15-3 .4v13c1-.25 2-.4 3-.4 2.5 0 4.5.7 6 2 1.5-1.3 3.5-2 6-2 1 0 2 .15 3 .4V4.4c-1-.25-2-.4-3-.4-2.5 0-4.5.7-6 2Z" />
    <line x1="12" y1="6" x2="12" y2="19" />
  </svg>
);

const Tool: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M14.7 6.3a4 4 0 1 0-5.66 5.66L3 18v3h3l6.04-6.04a4 4 0 0 0 5.66-5.66l-2.83 2.83-2-2 2.83-2.83Z" />
  </svg>
);

// A bound journal, closed, with a quill laid across it. The spine band and the
// diagonal are the whole read at 16px: a plain rectangle is a book (or a card, or
// a note), so the two raised bands plus the pen crossing the cover is what says
// "journal you write in" rather than "book you read".
const Journal: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5Z" />
    <path d="M7.5 3.5v17" />
    <path d="M19.5 7.5c1.2 2.6-.4 5.6-3.1 7.6l-1.6 1.1.7-1.8c1.1-2.8 2.6-5.2 4-6.9Z" />
    <path d="M15.4 13.6l1.2 1.1" />
  </svg>
);

// A class register: a clipboard whose rows are names, each with a tick in the
// margin. The ticks are what separate this from `list` — a row of plain lines is
// any list at all, and the check is what makes it attendance.
const Roster: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <rect x="4" y="4.5" width="16" height="16" rx="1.5" />
    <path d="M9 4.5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
    <path d="M7.5 9.5l1.2 1.2 2-2.2" />
    <path d="M7.5 14.5l1.2 1.2 2-2.2" />
    <line x1="13" y1="9.5" x2="16.5" y2="9.5" />
    <line x1="13" y1="14.5" x2="16.5" y2="14.5" />
  </svg>
);

// A beamed pair of eighth notes. Filled noteheads and a solid beam are what make
// this survive 16px in the app bar: a single note's stem is one hairline, which
// reads as a stray tick or disappears altogether, and the beam is the shape the
// eye actually recognises as "music".
const Music: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M9.5 17.5V6.6l8.5-1.9v10.8" />
    <path d="M9.5 10.1l8.5-1.9" />
    <ellipse cx="7.25" cy="17.6" rx="2.3" ry="1.8" fill="currentColor" stroke="none" />
    <ellipse cx="15.75" cy="15.5" rx="2.3" ry="1.8" fill="currentColor" stroke="none" />
  </svg>
);

// A gamepad: a rounded body with a D-pad cross on the left and two buttons on the
// right. The buttons are filled for the same reason Music's noteheads are — a
// hairline circle at the 16px the app bar draws this at either disappears or reads
// as a stray tick. The waisted body (the two curves pinching in at top and bottom)
// is what separates this from a plain rounded rectangle at small sizes.
const Game: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M7.5 7.5h9a4.5 4.5 0 0 1 4.5 4.5v.6a4 4 0 0 1-7.3 2.25l-.35-.52h-3.7l-.35.52A4 4 0 0 1 3 12.6V12a4.5 4.5 0 0 1 4.5-4.5Z" />
    <line x1="8.4" y1="10.6" x2="8.4" y2="13" />
    <line x1="7.2" y1="11.8" x2="9.6" y2="11.8" />
    <circle cx="15.4" cy="11" r="1" fill="currentColor" stroke="none" />
    <circle cx="17.4" cy="13" r="1" fill="currentColor" stroke="none" />
  </svg>
);

const ICONS: Record<ModuleIconName, IconComponent> = {
  building: Building,
  home: Home,
  briefcase: Briefcase,
  wallet: Wallet,
  chart: Chart,
  folder: Folder,
  shield: Shield,
  heart: Heart,
  book: Book,
  tool: Tool,
  journal: Journal,
  roster: Roster,
  music: Music,
  game: Game,
};

// The original hand-drawn set, kept as the "classic" option and the fallback for any
// concept a generated set happens to lack.
function ClassicModuleIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name as ModuleIconName] ?? Building;
  return <Icon className={className} aria-hidden="true" />;
}

/**
 * Renders a module icon in the user-selected icon set (read from `IconSetProvider`).
 * "classic" (and any missing glyph) falls back to the hand-drawn set above; every other
 * set is a baked SVG body from `module-icon-sets.generated.ts`. Monochrome sets inherit
 * `currentColor` from `className`; color sets carry their own fills.
 */
export function ModuleIcon({ name, className }: { name: string; className?: string }) {
  const { id } = useIconSet();
  return <ModuleIconPreview setId={id} name={name} className={className} />;
}

/**
 * Renders a module icon for an explicit set id, ignoring the active-set context. Used by
 * the Admin icon picker, which must preview every set at once (not just the active one).
 */
export function ModuleIconPreview({
  setId,
  name,
  className,
}: {
  setId: ModuleIconSetId;
  name: string;
  className?: string;
}) {
  const glyph = MODULE_ICON_GLYPHS[setId]?.[name];
  if (!glyph) return <ClassicModuleIcon name={name} className={className} />;
  return (
    <svg
      viewBox={`0 0 ${glyph.w} ${glyph.h}`}
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: glyph.body }}
    />
  );
}
