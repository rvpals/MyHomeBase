// The glyphs a student action can be drawn with.
//
// Deliberately a small registry of its own, separate from `ModuleIcon` and
// `TreeIcon`, and outside the reader's icon-set choice. `modules.md` records the
// cost of adding to either of those: a hand-drawn glyph for the `classic` set
// *plus* a named candidate for all 12 generated sets in
// `scripts/gen-icon-glyphs.mjs`, or the generator fails. That price buys
// consistency for a module's identity glyph; it is the wrong trade for a menu a
// teacher picks from at runtime, and no general icon set carries a tortoise or a
// `$+` anyway.
//
// Not registered in `components.md`: this has one caller (the Attendance
// module), and the registry is for components with more than one. If a second
// module ever wants a per-row glyph menu, that's the moment to generalise it.
//
// Monochrome and `currentColor` throughout, so a chip's own text color drives
// the glyph — the same contract `TreeIcon`'s hand-drawn set honours.

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

// A tortoise, for "Late". A domed shell with one plate line, four stubby legs and
// a head reaching forward. The dome is a half-ellipse rather than a circle
// because at 16px a round shell reads as a beetle.
const Turtle: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M3.5 15.5a8.5 6.5 0 0 1 17 0" />
    <path d="M3.5 15.5h17" />
    <path d="M9 15.5c0-2.2.6-4.2 1.6-5.6" />
    <path d="M15 15.5c0-2.2-.6-4.2-1.6-5.6" />
    <path d="M6 15.5v2" />
    <path d="M9.5 15.5v2.5" />
    <path d="M14.5 15.5v2.5" />
    <path d="M18 15.5v2" />
    <path d="M20.5 14.5c1.2 0 2-.7 2-1.6s-.8-1.4-1.6-1.4" />
  </svg>
);

// A dollar sign with a plus, for "Extra Credit" — credit earned on top of the
// day's work. The plus sits top-right where a superscript would, so the pair
// reads as one mark rather than two symbols sharing a box.
const DollarPlus: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M12.5 5.5v13" />
    <path d="M15.5 8.5c0-1.4-1.3-2.2-3-2.2s-3 .8-3 2.2c0 1.5 1.4 2 3 2.4s3 .9 3 2.5c0 1.5-1.3 2.3-3 2.3s-3-.8-3-2.3" />
    <path d="M18.5 4.5v4" />
    <path d="M16.5 6.5h4" />
  </svg>
);

const Clock: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

const Star: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M12 4l2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8z" />
  </svg>
);

// A medal: a disc on a ribbon. For an award that outranks a star.
const Medal: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M8 3l2.5 5" />
    <path d="M16 3l-2.5 5" />
    <circle cx="12" cy="14.5" r="5.5" />
    <path d="M12 11.5l1 2 2.2.3-1.6 1.5.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.5 2.2-.3z" />
  </svg>
);

const Warning: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M12 4.5l8.5 15h-17z" />
    <path d="M12 10v4" />
    <circle cx="12" cy="16.8" r="0.7" fill="currentColor" stroke="none" />
  </svg>
);

const Check: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 12.3l2.4 2.4 4.6-5" />
  </svg>
);

// A sheet with a folded corner — a jotting about the student, matching the
// "note" concept `Comments` already uses for the same idea.
const Note: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M6 3.5h8L19 8.5v12H6z" />
    <path d="M14 3.5v5h5" />
    <path d="M9 13h7" />
    <path d="M9 16.5h5" />
  </svg>
);

// A raised hand — volunteering, answering, participating.
const Hand: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M9 12V5.5a1.3 1.3 0 0 1 2.6 0V11" />
    <path d="M11.6 11V4.8a1.3 1.3 0 0 1 2.6 0V11" />
    <path d="M14.2 11V6.5a1.3 1.3 0 0 1 2.6 0V14a6.5 6.5 0 0 1-6.5 6.5A6 6 0 0 1 5 15l-.6-2.3a1.3 1.3 0 0 1 2.3-1.1L9 14" />
  </svg>
);

const Heart: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M12 19.5S4.5 15 4.5 9.8A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8c0 5.2-7.5 9.7-7.5 9.7Z" />
  </svg>
);

const ACTION_ICONS: Record<string, IconComponent> = {
  turtle: Turtle,
  "dollar-plus": DollarPlus,
  clock: Clock,
  star: Star,
  medal: Medal,
  warning: Warning,
  check: Check,
  note: Note,
  hand: Hand,
  heart: Heart,
};

/**
 * Whether a glyph exists for this key.
 *
 * `AttendanceActionIcon` renders `null` for an unknown one, which is right beside
 * a code (the code carries the meaning). Where the glyph is the only content, the
 * caller needs to check first and fall back — the same contract `hasTreeIcon`
 * provides.
 */
export function hasAttendanceActionIcon(name?: string): boolean {
  return name !== undefined && name !== "" && name in ACTION_ICONS;
}

/**
 * One student-action glyph.
 *
 * Renders nothing for a blank or unknown key rather than throwing: a stored icon
 * key can outlive the glyph it names, and an action is perfectly usable as its
 * code alone. Same forgiveness `resolveAttendanceSettings` applies to a stale
 * class id.
 */
export function AttendanceActionIcon({
  name,
  className,
}: {
  name?: string;
  className?: string;
}) {
  if (!hasAttendanceActionIcon(name)) return null;

  const Icon = ACTION_ICONS[name as string];
  return <Icon className={className} aria-hidden="true" />;
}
