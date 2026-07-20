import Link from "next/link";
import { ModuleIcon } from "./module-icons";

export interface ModuleCardProps {
  /** Module display name. */
  name: string;
  /** Optional short description shown under the name. */
  description?: string;
  /** Route the card links to. */
  href: string;
  /** Short reference code shown on the card's tab, e.g. "REI". */
  code: string;
  /** Module icon key, e.g. "building". */
  icon: string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function ModuleCard({
  name,
  description,
  href,
  code,
  icon,
  className = "",
}: ModuleCardProps) {
  return (
    <Link
      href={href}
      className={`group relative block rounded-xl border border-line bg-paper-raised p-5 pt-6 transition-all hover:-translate-y-1 hover:border-brass/50 hover:shadow-[0_0_0_1px_var(--brass),0_20px_32px_-12px_rgba(0,0,0,0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass focus-visible:ring-offset-2 focus-visible:ring-offset-paper motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${className}`}
    >
      <span className="absolute -top-2 left-5 rounded-t-md bg-brass-soft px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide text-brass-dark">
        {code}
      </span>
      <div className="flex items-center gap-2">
        <ModuleIcon name={icon} className="h-5 w-5 shrink-0 text-brass" />
        <h2 className="font-display text-lg font-semibold text-ink">{name}</h2>
      </div>
      {description ? <p className="mt-1.5 text-sm text-muted">{description}</p> : null}
      <span
        className="mt-4 block h-px w-8 bg-brass transition-all group-hover:w-full motion-reduce:transition-none"
        aria-hidden
      />
    </Link>
  );
}
