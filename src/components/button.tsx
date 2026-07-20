// Reusable button: a hard offset shadow that collapses on press, reading as a
// physical 3D switch. Promoted from the one-off Administration CTA on the home
// page — see components.md before adding another bespoke button treatment.

import Link from "next/link";
import { type ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger";
type Size = "sm" | "md";

export interface ButtonProps {
  /** Button label/content. */
  children: ReactNode;
  /** Visual style. Defaults to "primary". */
  variant?: Variant;
  /** Defaults to "md". */
  size?: Size;
  /** Renders as a `next/link` when set, otherwise a `<button>`. */
  href?: string;
  /** Ignored when `href` is set. Defaults to "button". */
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

const sizeClasses: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs gap-1.5",
  md: "px-4 py-2 text-sm gap-2",
};

// Same hard-offset/collapse-on-press mechanic for every variant, just a
// different shadow/fill color per variant — all theme-token-driven except
// danger, which stays a fixed semantic red across every color theme.
const variantClasses: Record<Variant, string> = {
  primary:
    "bg-brass text-paper shadow-[0_4px_0_0_var(--brass-dark)] hover:-translate-y-0.5 hover:shadow-[0_5px_0_0_var(--brass-dark)] active:translate-y-1 active:shadow-[0_0px_0_0_var(--brass-dark)] focus-visible:ring-brass",
  secondary:
    "bg-paper-raised text-ink border border-line shadow-[0_4px_0_0_var(--line)] hover:-translate-y-0.5 hover:shadow-[0_5px_0_0_var(--line)] active:translate-y-1 active:shadow-[0_0px_0_0_var(--line)] focus-visible:ring-brass",
  danger:
    "bg-transparent text-red-400 border border-red-800/60 shadow-[0_4px_0_0_rgba(127,29,29,0.7)] hover:-translate-y-0.5 hover:shadow-[0_5px_0_0_rgba(127,29,29,0.7)] active:translate-y-1 active:shadow-[0_0px_0_0_rgba(127,29,29,0.7)] focus-visible:ring-red-500",
};

const baseClasses =
  "inline-flex shrink-0 items-center justify-center rounded-full font-semibold transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-paper motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0";

export function Button({
  children,
  variant = "primary",
  size = "md",
  href,
  type = "button",
  onClick,
  disabled,
  className = "",
}: ButtonProps) {
  const classes = `${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`;

  if (href) {
    return (
      <Link href={href} className={classes} onClick={onClick}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} onClick={onClick} disabled={disabled} className={classes}>
      {children}
    </button>
  );
}
