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

const Quote: IconComponent = (props) => (
  <svg {...shared} {...props}>
    <path d="M10 7H6a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h3v1c0 1.7-1 3-3 3.7" />
    <path d="M19 7h-4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h3v1c0 1.7-1 3-3 3.7" />
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

const TREE_ICONS = {
  sliders: Sliders,
  list: ListRows,
  chart: Chart,
  upload: Upload,
  quote: Quote,
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
