// Full-detail view of one journal entry: every stored field, plus optional
// Print / Lock / Delete actions. Pure presentation — props in, events out. The
// caller owns what Lock and Delete actually do (server actions); this component
// only raises the intent and guards Delete behind a confirm step.
//
// This is the shared viewer for a journal entry — the single registered
// component to reach for anywhere an entry is shown, the way `TickerViewer` is
// for a ticker. The entry screen and any future print/export view share it.
//
// Carries the `print-sheet` class, which the print stylesheet in globals.css
// uses to print this card alone as a clean ink-on-white page.

"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import type { EntryLocation, JournalEntry } from "@/lib/journal";

export interface JournalViewerProps {
  entry: JournalEntry;
  /** Omit to hide the Print button. */
  onPrint?: () => void;
  /** Omit to hide the Edit button. Disabled while the entry is locked. */
  onEdit?: () => void;
  /**
   * Called with a saved location when its "Map" button is pressed. Omit to hide
   * those buttons. The caller decides how to show it (this component stays free
   * of any mapping dependency).
   */
  onShowLocation?: (location: EntryLocation) => void;
  /** Called with the lock state to move to. Omit to hide the Lock button. */
  onToggleLock?: (nextLocked: boolean) => void;
  /** Called after the user confirms. Omit to hide the Delete button. */
  onDelete?: () => void;
  /**
   * Link to the previous (older) entry, and its date for the caption below the
   * button. Omit both to hide the Previous button — the caller computes the
   * href so this component stays free of routing knowledge.
   */
  previousHref?: string;
  previousDate?: string;
  /** Link to the next (newer) entry, and its date. Omit both to hide the Next button. */
  nextHref?: string;
  nextDate?: string;
  /** Disables the actions while the caller is working. */
  isBusy?: boolean;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted sm:w-32 sm:pt-0.5">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm text-ink">{children}</dd>
    </div>
  );
}

function Chips({ values }: { values: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span
          key={value}
          className="rounded-full bg-brass-soft px-2 py-0.5 font-mono text-xs font-semibold text-brass-dark"
        >
          {value}
        </span>
      ))}
    </div>
  );
}

function CalendarIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}

function ClockIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

export function JournalViewer({
  entry,
  onPrint,
  onEdit,
  onShowLocation,
  onToggleLock,
  onDelete,
  previousHref,
  previousDate,
  nextHref,
  nextDate,
  isBusy = false,
  className = "",
}: JournalViewerProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const hasActions = Boolean(onPrint || onEdit || onToggleLock || onDelete);
  const hasNeighborNav = Boolean(previousHref || nextHref);

  // Blank fields are omitted rather than shown as an empty placeholder, so an
  // entry only displays what it actually recorded. The detail list itself is
  // dropped when none of its fields have a value.
  const hasPlaceName = entry.placeName !== "";
  const hasLocations = entry.locations.length > 0;
  const hasDetails = hasPlaceName || Boolean(entry.weather) || hasLocations;

  return (
    <article className={`print-sheet rounded-xl border border-line bg-paper-raised p-6 ${className}`}>
      <header className="border-b border-line pb-4">
        {hasNeighborNav && (
          <div className="no-print mb-4 flex flex-wrap items-center gap-4 border-b border-line pb-4">
            <div className="flex shrink-0 items-center gap-2">
              {/* With no neighbour, href is undefined so Button renders a real
                  disabled <button> (its base classes dim it and block clicks). */}
              <Button size="sm" variant="secondary" href={previousHref} disabled={!previousHref}>
                &larr; Previous
              </Button>
              <Button size="sm" variant="secondary" href={nextHref} disabled={!nextHref}>
                Next &rarr;
              </Button>
            </div>
            <p className="min-w-0 flex-1 text-xs text-muted">
              {previousHref ? `Previous (older): ${previousDate}` : "This is the oldest entry."}
              {" · "}
              {nextHref ? `Next (newer): ${nextDate}` : "This is the newest entry."}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 font-mono text-xl text-brass-dark">
            <CalendarIcon className="h-5 w-5 shrink-0" />
            {entry.date}
            {entry.time !== "" && (
              <>
                <ClockIcon className="ml-1 h-5 w-5 shrink-0" />
                {entry.time}
              </>
            )}
          </span>
          {entry.isPinned && (
            <span className="rounded-full bg-brass-soft px-2 py-0.5 text-xs font-semibold text-brass-dark">
              Pinned
            </span>
          )}
          {entry.isLocked && (
            <span className="rounded-full bg-brass-soft px-2 py-0.5 text-xs font-semibold text-brass-dark">
              Locked
            </span>
          )}
        </div>
        {entry.title !== "" && (
          <h2 className="mt-2 font-display text-2xl font-semibold text-ink">{entry.title}</h2>
        )}
      </header>

      {hasDetails && (
        <dl className="flex flex-col gap-3 py-4">
          {hasPlaceName && <Field label="Place">{entry.placeName}</Field>}
          {entry.weather && (
            <Field label="Weather">
              <span>
                {entry.weather.temp}
                {entry.weather.unit} · {entry.weather.description}{" "}
                <span className="font-mono text-xs text-muted">(code {entry.weather.code})</span>
              </span>
            </Field>
          )}
          {hasLocations && (
            <Field label="Locations">
              <ul className="flex flex-col gap-1">
                {entry.locations.map((location) => (
                  <li key={location.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted">
                      {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                    </span>
                    {location.locationName !== "" && <span>{location.locationName}</span>}
                    {onShowLocation && (
                      <button
                        type="button"
                        onClick={() => onShowLocation(location)}
                        className="no-print text-xs text-brass-dark hover:underline"
                      >
                        Map
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </Field>
          )}
        </dl>
      )}

      {entry.content !== "" && (
        <div className="border-t border-line py-4">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Content</h3>
          {/* Imported entries keep their original line breaks. */}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{entry.content}</p>
        </div>
      )}

      <div className="border-t border-line py-4">
        <CollapsibleCard title="Misc Info">
          <dl className="flex flex-col gap-3">
            {entry.categories.length > 0 && (
              <Field label="Categories">
                <Chips values={entry.categories} />
              </Field>
            )}
            {entry.tags.length > 0 && (
              <Field label="Tags">
                <Chips values={entry.tags} />
              </Field>
            )}
            <Field label="Entry #">
              <span className="font-mono text-xs text-muted">
                {entry.id} · created {entry.createdAt} · updated {entry.updatedAt}
              </span>
            </Field>
          </dl>
        </CollapsibleCard>
      </div>

      {hasActions && (
        <footer className="border-t border-line pt-4">
          <div className="no-print flex flex-wrap items-center gap-2">
            {onPrint && (
              <Button size="sm" variant="secondary" onClick={onPrint} disabled={isBusy}>
                Print / Save PDF
              </Button>
            )}
            {onEdit && (
              // Editing a locked entry is rejected by the updateEntry use-case,
              // so the button is disabled rather than failing after the click.
              <Button size="sm" onClick={onEdit} disabled={isBusy || entry.isLocked}>
                Edit
              </Button>
            )}
            {onToggleLock && (
              <Button size="sm" variant="secondary" onClick={() => onToggleLock(!entry.isLocked)} disabled={isBusy}>
                {entry.isLocked ? "Unlock" : "Lock"}
              </Button>
            )}
            {onDelete && !isConfirmingDelete && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => setIsConfirmingDelete(true)}
                // A locked entry can't be deleted (the use-case rejects it), so the
                // button is disabled rather than failing after the click.
                disabled={isBusy || entry.isLocked}
              >
                Delete
              </Button>
            )}
            {onDelete && isConfirmingDelete && (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-ink">Delete this entry permanently?</span>
                <Button size="sm" variant="danger" onClick={onDelete} disabled={isBusy}>
                  {isBusy ? "Deleting…" : "Yes, delete"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setIsConfirmingDelete(false)} disabled={isBusy}>
                  Cancel
                </Button>
              </span>
            )}
            {entry.isLocked && (onDelete || onEdit) && !isConfirmingDelete && (
              <span className="text-xs text-muted">Unlock the entry to edit or delete it.</span>
            )}
          </div>
        </footer>
      )}
    </article>
  );
}
