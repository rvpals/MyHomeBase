"use client";

// The Clips board: a pinned band, then everything else, as balanced columns of
// variable-height cards.
//
// It owns no data. The clips arrive already ordered (pinned first — one `ORDER BY`,
// so the board and the list cannot disagree), and the arrangement rules are pure
// functions in `src/lib/clips/board.ts`.

import { MasonryBoard } from "@/components/masonry-board";
import { buildClipBoard, dealClipsIntoColumns, type ClipSummary } from "@/lib/clips";
import { ClipsCard } from "./clips-card";

export interface ClipsBoardViewProps {
  clips: ClipSummary[];
  onOpen: (id: number) => void;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onTogglePin: (id: number, isPinned: boolean) => void;
  onToggleItem: (itemId: number, isDone: boolean) => void;
  onRecolour: (id: number) => void;
}

export function ClipsBoardView({
  clips,
  onOpen,
  onEdit,
  onDelete,
  onTogglePin,
  onToggleItem,
  onRecolour,
}: ClipsBoardViewProps) {
  const board = buildClipBoard(clips);

  function renderCard(clip: ClipSummary) {
    return (
      <ClipsCard
        clip={clip}
        onOpen={onOpen}
        // A sealed clip has no plaintext to edit in place — the viewer is where it
        // is opened with its password. Omitting the handler removes the button
        // rather than showing one that explains itself only after a click.
        onEdit={clip.isEncrypted ? undefined : onEdit}
        onDelete={onDelete}
        onTogglePin={onTogglePin}
        onToggleItem={onToggleItem}
        onRecolour={onRecolour}
      />
    );
  }

  if (clips.length === 0) {
    return <p className="text-sm text-muted">No clips yet.</p>;
  }

  return (
    <div className="space-y-6">
      {board.pinned.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Pinned</h2>
          <MasonryBoard
            items={board.pinned}
            deal={dealClipsIntoColumns}
            renderItem={renderCard}
            itemKey={(clip) => clip.id}
          />
        </section>
      )}

      {board.rest.length > 0 && (
        <section>
          {/* The heading only appears when there is a pinned band above it to
              distinguish from — an "Others" label over the whole board when nothing
              is pinned would be naming the only thing on screen. */}
          {board.pinned.length > 0 && (
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Others</h2>
          )}
          <MasonryBoard
            items={board.rest}
            deal={dealClipsIntoColumns}
            renderItem={renderCard}
            itemKey={(clip) => clip.id}
          />
        </section>
      )}
    </div>
  );
}
