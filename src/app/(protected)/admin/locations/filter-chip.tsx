"use client";

// Two small presentational helpers shared by every screen that lists saved
// places: the Location Manager and Map under Admin, and the journal entry
// form's "add from the location database" tab.
//
// Their own file rather than exports off the Manager's view, because the entry
// form imports them: pulling them from there would drag the Manager's modals,
// its dedup dialog and its whole action surface into the entry form's bundle
// for the sake of a chip and a number format.

/** `40.48268, -74.43705` -- five decimals is ~1m, past what any pin here means. */
export function formatCoords(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

/**
 * A toggleable filter chip.
 *
 * Chips rather than a multi-select: the lists are short, and the whole point of
 * the filters is to be one tap away on a phone, which a native multiple-select
 * is not.
 */
export function FilterChip({
  label,
  count,
  isActive,
  onToggle,
  iconUrl,
}: {
  label: string;
  count?: number;
  isActive: boolean;
  onToggle: () => void;
  /** The category's or tag's icon, when it has one. */
  iconUrl?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isActive}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
        isActive
          ? "border-brass bg-brass-soft text-ink"
          : "border-line bg-paper text-muted hover:text-ink"
      }`}
    >
      {iconUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- icon bytes are served from our own DB-backed route, not a static asset next/image can optimize.
        <img src={iconUrl} alt="" loading="lazy" className="h-3.5 w-3.5 shrink-0 rounded-sm" />
      )}
      {label}
      {count !== undefined && <span className="ml-1.5 font-mono opacity-70">{count}</span>}
    </button>
  );
}
