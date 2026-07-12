// Template for a reusable UI component.
// Copy this to src/components/<kebab-name>.tsx, rename, then register it in components.md.
//
// Rules (see ARCHITECTURE.md → "Reusable UI components"):
//   - Pure presentation: props in, events out.
//   - No data fetching, no business logic, no `lib` imports beyond types.
//   - Accept a `className` passthrough so callers can extend without forking.
//   - Data comes from props; the page that fetched it passes it down.

import { type ReactNode } from "react";

// Keep variants as a small, named union — not free-form strings.
type Variant = "default" | "muted";

export interface ComponentNameProps {
  /** Primary content. */
  children: ReactNode;
  /** Visual style. Add variants here as the design system grows. */
  variant?: Variant;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
  /**
   * Example event. Components raise intent; they never decide domain outcomes.
   * The parent (page/action) handles what actually happens.
   */
  onAction?: () => void;
}

const variantClasses: Record<Variant, string> = {
  default: "bg-white border border-gray-200",
  muted: "bg-gray-50 border border-gray-100",
};

export function ComponentName({
  children,
  variant = "default",
  className = "",
  onAction,
}: ComponentNameProps) {
  return (
    <div
      className={`rounded-lg p-4 ${variantClasses[variant]} ${className}`}
      onClick={onAction}
    >
      {children}
    </div>
  );
}

// Larger projects usually swap the string-concat above for `cva` + `clsx`/`tailwind-merge`.
// Keep the shape identical (typed props, variant map, className passthrough) so every
// component in src/components/ reads the same way.
