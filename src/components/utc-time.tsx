"use client";

// A stored UTC timestamp, shown as itself and as the reader's local time:
//
//     2026-08-16 14:48:00 UTC (10:48 AM EDT)
//
// Used by every admin screen that prints a `datetime('now')` column. Those screens
// used to print the bare UTC stamp with a "(UTC)" label, which is unambiguous and
// also makes the reader do timezone arithmetic to answer "was that this morning?".

import { useEffect, useState } from "react";

import { describeLocalInstant, parseUtcStamp } from "@/lib/shared/utc-display";

export interface UtcTimeProps {
  /**
   * The stamp as stored: `YYYY-MM-DD HH:MM:SS`, UTC. `null`/`undefined` renders
   * `fallback`, so callers can pass a nullable column straight through.
   */
  stamp: string | null | undefined;
  /** Shown when `stamp` is absent. */
  fallback?: string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/**
 * The local half, or `undefined` until the browser has mounted.
 *
 * Never computed during render, for the same reason `clock-face.tsx` starts empty:
 * this is a client component, so Next.js renders it on the server *first*, and the
 * server sits in the NAS's timezone while the reader does not. Formatting a local
 * time on both passes produces two different strings for the same markup — a
 * hydration mismatch, which React warns about and does not reliably repair.
 *
 * Starting empty makes the server's markup and the client's first render identical
 * by construction. The parenthetical appears a frame later, which is invisible on a
 * timestamp that is not ticking.
 */
function useLocalLabel(stamp: string | null | undefined): string | undefined {
  const [label, setLabel] = useState<string | undefined>(undefined);

  useEffect(() => {
    const instant = stamp ? parseUtcStamp(stamp) : null;
    // A stamp the parser rejects gets no parenthetical at all. Printing the raw text
    // alone is honest; "(Invalid Date)" beside it is noise.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing state to a prop or to browser-only data that is unknowable during render; runs on mount or when that input changes, not in a loop.
    setLabel(instant ? describeLocalInstant(instant) : undefined);
  }, [stamp]);

  return label;
}

export function UtcTime({ stamp, fallback = "—", className = "" }: UtcTimeProps) {
  const local = useLocalLabel(stamp);

  if (!stamp) return <span className={className}>{fallback}</span>;

  return (
    <span className={`whitespace-nowrap ${className}`}>
      {stamp} UTC
      {local && <span className="text-muted"> ({local})</span>}
    </span>
  );
}
