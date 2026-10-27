"use client";

// The Clips home screen: what is kept here, and the most recent few.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MasonryBoard } from "@/components/masonry-board";
import { dealClipsIntoColumns, type ClipSummary } from "@/lib/clips";
import { ClipsCard } from "./clips-card";
import { ClipsViewer } from "./clips-viewer";
import { setClipPinnedAction, toggleClipItemAction } from "./clips-actions";

export function ClipsMainView({ clips, total }: { clips: ClipSummary[]; total: number }) {
  const router = useRouter();
  const [viewing, setViewing] = useState<number | undefined>(undefined);

  async function handleTogglePin(id: number, isPinned: boolean) {
    await setClipPinnedAction(id, isPinned);
    router.refresh();
  }

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
          // The same card the board and the list draw, in two columns. Editing and
          // recolouring deliberately live on All Clips — this screen is a glance at
          // what is here, and a colour picker on it would make it a second editor.
          <MasonryBoard
            items={clips}
            deal={dealClipsIntoColumns}
            renderItem={(clip) => (
              <ClipsCard
                clip={clip}
                onOpen={setViewing}
                onDelete={() => router.push("/modules/clips/all")}
                onTogglePin={(id, isPinned) => void handleTogglePin(id, isPinned)}
                onToggleItem={(itemId, isDone) => void toggleClipItemAction(itemId, isDone)}
                onRecolour={() => router.push("/modules/clips/all")}
              />
            )}
            itemKey={(clip) => clip.id}
            columns={{ compact: 1, wide: 2 }}
          />
        )}
      </div>

      {viewing !== undefined && (
        <ClipsViewer clipId={viewing} onClose={() => setViewing(undefined)} />
      )}
    </div>
  );
}
