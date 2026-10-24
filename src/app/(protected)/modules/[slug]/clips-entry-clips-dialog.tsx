"use client";

// The clips attached to one journal entry — what the paperclip badge on an entry
// opens.
//
// Two steps rather than one, because an entry can carry several clips: this lists
// them, and picking one opens the ordinary `ClipsViewer`. With exactly one clip it
// skips straight to the viewer, since a one-item list to click through is a step
// that earns nothing.
//
// Lives in the Clips file group though it renders on a Journal screen: Clips owns
// the concept, and the Journal only has to know how to open it.

import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { TreeIcon } from "@/components/tree-icons";
import type { ClipSummary } from "@/lib/clips";
import { listClipsForEntryAction } from "./clips-actions";
import { ClipsViewer } from "./clips-viewer";

export function EntryClipsDialog({
  entryId,
  onClose,
}: {
  entryId: number;
  onClose: () => void;
}) {
  const [clips, setClips] = useState<ClipSummary[]>([]);
  const [openClipId, setOpenClipId] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    void listClipsForEntryAction(entryId).then((result) => {
      if (cancelled) return;
      setLoading(false);

      if (!result.ok || !result.clips) {
        setError(result.error ?? "Could not load the clips on that entry.");
        return;
      }

      setClips(result.clips);
      // Straight through when there is only one — the list would be a single row
      // to click before seeing the thing the reader already asked for.
      if (result.clips.length === 1) setOpenClipId(result.clips[0].id);
    });

    return () => {
      cancelled = true;
    };
  }, [entryId]);

  // The viewer owns the screen once a clip is picked. Closing it returns to the
  // list, unless the list was skipped — then closing closes the whole thing.
  if (openClipId !== undefined) {
    return (
      <ClipsViewer
        clipId={openClipId}
        onClose={() => {
          if (clips.length <= 1) onClose();
          else setOpenClipId(undefined);
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 max-lg:p-0">
      <div className="max-h-full w-full max-w-lg overflow-auto rounded-xl border border-line bg-paper-raised p-4 max-lg:max-w-none max-lg:rounded-none">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 className="font-display text-xl text-ink">Clips on this entry</h2>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        {loading && <p className="text-sm text-muted">Loading…</p>}

        {!loading && !error && clips.length === 0 && (
          <p className="text-sm text-muted">Nothing is attached to this entry any more.</p>
        )}

        <ul className="space-y-2">
          {clips.map((clip) => (
            <li key={clip.id}>
              <button
                type="button"
                onClick={() => setOpenClipId(clip.id)}
                className="w-full rounded-lg border border-line p-3 text-left hover:border-brass"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-display text-base text-ink">
                    {clip.title || "(untitled)"}
                  </span>
                  {clip.isEncrypted && (
                    <TreeIcon name="lock" className="h-4 w-4 shrink-0 text-muted" />
                  )}
                </div>
                {clip.excerpt && <p className="mt-1 text-sm text-muted">{clip.excerpt}</p>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
