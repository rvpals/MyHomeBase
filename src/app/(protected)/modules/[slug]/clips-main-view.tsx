"use client";

// The Clips home screen: what is kept here, and the most recent few.

import Link from "next/link";
import { useState } from "react";
import { TreeIcon } from "@/components/tree-icons";
import type { ClipSummary } from "@/lib/clips";
import { ClipsViewer } from "./clips-viewer";

export function ClipsMainView({ clips, total }: { clips: ClipSummary[]; total: number }) {
  const [viewing, setViewing] = useState<number | undefined>(undefined);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Clips kept</p>
        <p className="font-display text-xl text-ink">{total}</p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-lg text-ink">Most recent</h2>
          <Link href="/modules/clips/all" className="text-sm text-muted hover:text-ink">
            All clips
          </Link>
        </div>

        {clips.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing yet. Paste an email or write a note under All Clips.
          </p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {clips.map((clip) => (
              <li key={clip.id}>
                <button
                  type="button"
                  onClick={() => setViewing(clip.id)}
                  className="w-full rounded-xl border border-line bg-paper-raised p-4 text-left hover:border-brass"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display text-base text-ink">
                      {clip.title || "(untitled)"}
                    </h3>
                    {clip.isEncrypted && (
                      <TreeIcon name="lock" className="h-4 w-4 shrink-0 text-muted" />
                    )}
                  </div>
                  {clip.excerpt && <p className="mt-1 text-sm text-muted">{clip.excerpt}</p>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {viewing !== undefined && (
        <ClipsViewer clipId={viewing} onClose={() => setViewing(undefined)} />
      )}
    </div>
  );
}
