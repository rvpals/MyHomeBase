"use client";

// One BLOB cell in a data grid: what it is, how big, and what you can do with it.
//
// Pure presentation. The bytes are never a prop — the grid is handed a small
// descriptor (type, size, and the address the bytes live at) and this component
// points an `<img>` or a download link at the serving route. That is the whole
// reason it exists: a grid over `sys_users` or `mus_albums` would otherwise
// carry a whole file per row.
//
// Built for the SQL Explorer, which cannot know its columns in advance. A module
// screen showing a known image column should keep using its own route and an
// `<img>` directly; this is for the case where "there is a BLOB here" is all
// anyone knows.

import { useState, type ReactNode } from "react";
import { Modal } from "@/components/modal";

/** The address of the bytes, as the serving route's query string wants them. */
export interface BlobCellSource {
  tableName: string;
  columnName: string;
  rowId: number;
}

export interface BlobCellProps {
  /** Sniffed mime type, e.g. `image/png` or `application/octet-stream`. */
  mimeType: string;
  byteLength: number;
  /**
   * Where the bytes can be fetched. Omit for a blob with no address — a computed
   * value from an arbitrary SELECT — and the actions render disabled with a
   * tooltip saying why, rather than offering a download that cannot work.
   */
  source?: BlobCellSource;
  /**
   * True when the caller judges this renderable inline (an image, under the
   * caller's size cap). Preview is offered only then.
   */
  isPreviewable?: boolean;
  /** Human-readable size, e.g. "24 KB". The caller formats it. */
  sizeLabel: string;
  /**
   * Builds the URL for the bytes. Kept a prop so this component knows nothing
   * about any particular route.
   */
  buildUrl: (source: BlobCellSource, options: { download: boolean }) => string;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/** Why an action is unavailable, for the disabled buttons' tooltip. */
const NO_SOURCE_REASON =
  "These bytes have no row to fetch them from — browse the table instead of using a computed query.";

export function BlobCell({
  mimeType,
  byteLength,
  source,
  isPreviewable = false,
  sizeLabel,
  buildUrl,
  className = "",
}: BlobCellProps) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // An empty BLOB is a real stored value and worth distinguishing from NULL,
  // which the grid renders as a dash. Nothing to save, so no actions.
  if (byteLength === 0) {
    return <span className={`text-xs italic text-muted ${className}`}>empty blob</span>;
  }

  const canAct = source !== undefined;

  return (
    <>
      {/* Wraps rather than truncates: in a narrow column the size matters more
          than keeping the row one line tall, and the compact card view gives
          this the full width anyway. */}
      <span className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
        <span className="font-mono text-xs text-muted">
          {mimeType} · {sizeLabel}
        </span>

        {isPreviewable && (
          <CellAction
            disabled={!canAct}
            title={canAct ? undefined : NO_SOURCE_REASON}
            onClick={() => setIsPreviewOpen(true)}
          >
            Preview
          </CellAction>
        )}

        {canAct ? (
          // A plain anchor, because the route answers with
          // `Content-Disposition: attachment` — no fetch-to-blob dance needed,
          // and it keeps a multi-megabyte file out of the JS heap.
          <a
            href={buildUrl(source, { download: true })}
            download
            className="text-xs font-medium text-brass-dark hover:underline max-lg:py-1"
          >
            Save
          </a>
        ) : (
          <CellAction disabled title={NO_SOURCE_REASON}>
            Save
          </CellAction>
        )}
      </span>

      {isPreviewOpen && source && (
        <Modal title={`${source.columnName} · row ${source.rowId}`} size="lg" onClose={() => setIsPreviewOpen(false)}>
          <div className="flex flex-col items-center gap-3">
            {/* A plain <img>, not next/image: the bytes are an arbitrary DB cell
                behind an admin-only route, so there is nothing for the image
                optimiser to usefully do and a loader would need the route
                allowlisted. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={buildUrl(source, { download: false })}
              alt={`${source.tableName}.${source.columnName}, row ${source.rowId}`}
              className="max-h-[70vh] w-auto max-w-full rounded-md border border-line bg-paper object-contain"
            />
            <p className="font-mono text-xs text-muted">
              {mimeType} · {sizeLabel}
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * A text button sized for a grid cell.
 *
 * Separate from `Button` on purpose: this sits inside a table cell next to a
 * mime type, where a real button's padding would set the row height. Matches the
 * "Open in SQL" / "Truncate" text actions already in the SQL Explorer's panels.
 * The `max-lg:py-1` gives it a tappable box in the compact card view without
 * touching the desktop row height.
 */
function CellAction({
  children,
  onClick,
  disabled = false,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="text-xs font-medium text-brass-dark hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline max-lg:py-1"
    >
      {children}
    </button>
  );
}
