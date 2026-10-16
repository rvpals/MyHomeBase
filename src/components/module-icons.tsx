"use client";

import type { ReactElement, SVGProps } from "react";
import type { ModuleIconName } from "@/lib/modules";
import { useIconSet } from "./icon-set-context";
import { useModuleCustomIcons } from "./module-icon-context";
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

// A photograph: a landscape frame with a sun and a mountain horizon. The mountain
// is what makes this read as a *picture* rather than as a plain window or card at
// the 16px the app bar draws it — an empty rectangle with a dot is a UI chrome
// shape, a rectangle with a skyline in it is a photo. The sun is filled for the
// same reason Music's noteheads are: a hairline circle that small either vanishes
// or reads as a stray tick.
const Photo: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="8.2" cy="9.8" r="1.35" fill="currentColor" stroke="none" />
    <path d="M3.4 16.5l4.4-4.1a1.6 1.6 0 0 1 2.2 0l2.7 2.6" />
    <path d="M11.4 16.9l3.6-3.9a1.6 1.6 0 0 1 2.3 0l3.3 3.5" />
  </svg>
);

// A house with a chimney — the Household module.
//
// Its whole job is to be legibly NOT `Home` two rows above, which is the same
// subject drawn plainly (roof, walls, door). Two things separate them, and both
// were chosen because they survive 16px where finer detail does not:
//
//   the CHIMNEY breaks the roofline's silhouette, so the two differ in outline
//   and not only in interior detail — which is all the eye gets at app-bar size;
//   the WINDOW beside the door fills the wall that `Home` leaves empty.
//
// The door is drawn shorter than `Home`'s to make room for the window without
// crowding it. Smoke was drawn above the chimney first and removed after
// rendering: three curls at this size are three stray ticks floating over the
// roof, and the chimney alone already carries the difference.
const Household: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M3.5 11L12 4l8.5 7" />
    {/* The chimney, on the right slope so it clears the roof's apex. */}
    <path d="M16.5 6.85V4.5h2.2v4.2" />
    <path d="M5.75 10v9a1 1 0 0 0 1 1h10.5a1 1 0 0 0 1-1v-9" />
    {/* Door, then the window beside it. */}
    <path d="M10 20v-4.5h2.75V20" />
    <rect x="14.5" y="13.5" width="2.5" height="2.5" />
  </svg>
);

// A schoolhouse — the Classroom module.
//
// This list already holds three buildings (`Building`, `Home`, `Household`), so the
// difficulty here is not drawing a school, it is drawing one that is not mistaken for
// those at 16px. Interior detail is no help at that size; only the SILHOUETTE is. So
// the distinguishing marks both break the outline:
//
//   the CUPOLA (bell tower) sits on the roof's centre, where `Household` puts its
//   chimney off to one side — a centred peak above a flat roof reads as civic, not
//   domestic, and nothing else in this list has anything above the roofline centre;
//   the ROOF is a shallow pediment over the full width rather than the steep pitched
//   roof `Home` and `Household` share, which is the other half of the "institution,
//   not house" read.
//
// The double door is centred and full-height — schools have entrances, not front
// doors — and flanked by two windows. A flagpole was drawn beside the cupola first
// and removed after rendering: at app-bar size it is a stray hairline tick that reads
// as a rendering artefact, the same reason `Household` lost its smoke curls.
const Classroom: IconComponent = (props) => (
  <svg {...shared} {...props}>
    {/* The cupola, centred above the roofline — the civic giveaway. */}
    <path d="M12 2.25v2" />
    <path d="M10.6 6.5V5.1a1.4 1.4 0 0 1 2.8 0V6.5" />
    {/* Shallow pediment roof across the full width. */}
    <path d="M3.25 10.25 12 6.75l8.75 3.5" />
    <path d="M5.5 10.6V20h13v-9.4" />
    {/* Centred double door, floor to lintel. */}
    <path d="M9.9 20v-5.4h4.2V20" />
    <path d="M12 14.6V20" />
    {/* A window either side of the entrance. */}
    <rect x="6.9" y="12.6" width="1.9" height="1.9" />
    <rect x="15.2" y="12.6" width="1.9" height="1.9" />
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
  photo: Photo,
  household: Household,
  classroom: Classroom,
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
 *
 * Pass `slug` wherever the icon stands for *that module* — a nav row, a breadcrumb, a
 * card badge. An admin can upload artwork per module in Admin > Configuration > Module
 * Configuration, and the upload is only found by slug.
 *
 * Resolution order:
 *   1. the module's uploaded icon, if `slug` is given and one exists,
 *   2. the active set's glyph for `name`,
 *   3. the hand-drawn classic glyph.
 *
 * Steps 2 and 3 are what this component always did, so **a module with no upload renders
 * exactly as before, and omitting `slug` keeps the old behaviour outright.** That is what
 * made it safe to add `slug` to the call sites one at a time.
 *
 * Unlike a slot override, a custom module icon is *not* keyed by icon set: it is the
 * module's identity rather than a note in a visual style, so switching sets leaves it
 * alone. See migrations/0150_module_custom_icon.md.
 */
export function ModuleIcon({
  name,
  className,
  slug,
}: {
  name: string;
  className?: string;
  /** The module this icon stands for. Omit where the icon is a sample or a preview. */
  slug?: string;
}) {
  const { id } = useIconSet();
  const customIcons = useModuleCustomIcons();
  const custom = slug ? customIcons[slug] : undefined;

  if (custom?.kind === "svg" && custom.svgBody) {
    return (
      <svg
        viewBox={`0 0 ${custom.svgWidth ?? 24} ${custom.svgHeight ?? 24}`}
        className={className}
        aria-hidden="true"
        // Sanitized on write by `sanitizeSvg` — an allowlist of drawing elements and
        // presentation attributes, so there is no script or external reference left to
        // inline. Inlining (rather than an <img>) is the point: the markup inherits
        // `currentColor`, so a custom glyph still goes brass in an active nav row.
        dangerouslySetInnerHTML={{ __html: custom.svgBody }}
      />
    );
  }

  // `slug` is narrowed rather than asserted: `custom` is only ever set when `slug`
  // was, but the compiler can't see that through the lookup, and an assertion here
  // would be a claim a later edit could quietly falsify.
  if (slug && custom?.kind === "image") {
    return (
      // Raster can't inherit `currentColor`, so this never tints — the admin control
      // warns about that at upload time. `?v=` busts the route's immutable cache when
      // the icon is replaced.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/modules/${encodeURIComponent(slug)}/icon${
          custom.version ? `?v=${encodeURIComponent(custom.version)}` : ""
        }`}
        alt=""
        aria-hidden="true"
        className={`object-contain ${className ?? ""}`}
      />
    );
  }

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
