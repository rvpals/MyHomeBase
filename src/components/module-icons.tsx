import type { ReactElement, SVGProps } from "react";
import type { ModuleIconName } from "@/lib/modules";

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
};

export function ModuleIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = ICONS[name as ModuleIconName] ?? Building;
  return <Icon className={className} aria-hidden="true" />;
}
