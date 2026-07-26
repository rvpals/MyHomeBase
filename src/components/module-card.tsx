"use client";

import Link from "next/link";
import { useIconSet } from "./icon-set-context";
import { ModuleIcon } from "./module-icons";

export interface ModuleCardProps {
  /** Module display name. */
  name: string;
  /** Optional short description shown under the name. */
  description?: string;
  /** Route the card links to. */
  href: string;
  /** Module icon key, e.g. "building". */
  icon: string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function ModuleCard({ name, description, href, icon, className = "" }: ModuleCardProps) {
  const { colorful } = useIconSet();
  // Monochrome sets sit in a solid-accent badge with a knocked-out (paper) glyph; color
  // sets carry their own fills, so they get a neutral tile that lets the artwork read.
  const badgeClass = colorful
    ? "bg-paper text-ink border border-line shadow-[0_4px_10px_-4px_rgba(0,0,0,0.4)]"
    : "bg-brass text-paper shadow-[0_4px_10px_-3px_var(--brass-dark)]";
  return (
    <Link
      href={href}
      className={`group block rounded-xl border border-line bg-paper-raised p-5 transition-all hover:-translate-y-1 hover:border-brass/50 hover:shadow-[0_0_0_1px_var(--brass),0_20px_32px_-12px_rgba(0,0,0,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass focus-visible:ring-offset-2 focus-visible:ring-offset-paper motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${className}`}
    >
      <div className="flex items-center gap-4">
        <span
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${badgeClass}`}
        >
          <ModuleIcon name={icon} className="h-8 w-8" />
        </span>
        <h2 className="font-display text-xl font-semibold leading-snug text-ink">{name}</h2>
      </div>
      {description ? <p className="mt-4 text-sm leading-relaxed text-muted">{description}</p> : null}
    </Link>
  );
}
