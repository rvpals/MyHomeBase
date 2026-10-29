// An attachment editor: the files a record ALREADY holds, above a dropzone for the
// ones being added.
//
// A wrapper around `MultiFileDropzone` rather than a replacement for it. That component
// owns the *pending* list — drop some, spot a wrong one, remove it, drop more — and is
// already the picker the HSA editor and CSV import use. What it cannot know about is
// the other half of an edit: the files that are already stored somewhere, which have an
// id, a size and a download link rather than a `File` object, and whose removal is a
// server round-trip rather than a splice.
//
// So this composes the two halves into the thing an editor actually needs, and keeps
// `MultiFileDropzone` doing exactly what it already did.
//
// Still "props in, events out": it never reads a file's contents and never uploads
// anything. The caller decides what a removal means and when an upload happens.

"use client";

import { Button } from "./button";
import { MultiFileDropzone } from "./multi-file-dropzone";

/** A file the record already holds, as the server reported it. */
export interface AttachedFile {
  id: number;
  /** What to show — the name the file arrived with, not its sanitised stored name. */
  name: string;
  byteSize: number;
  /** Where to open or download it. The caller builds this; this component only links. */
  href: string;
}

export interface FileUploaderZoneProps {
  /** Files already stored. Empty renders no list at all rather than an empty box. */
  attached: AttachedFile[];
  /**
   * Remove one stored file. The caller confirms and talks to the server — this
   * component raises the intent and nothing more.
   */
  onRemoveAttached: (id: number) => void;
  /** The pending list, forwarded to `MultiFileDropzone`. Controlled by the caller. */
  pending: File[];
  onPendingChange: (files: File[]) => void;
  /**
   * The ceiling, for the message and the disabled state. Both are a **courtesy**:
   * the schema enforces them server-side, because a client check is advice and a
   * boundary check is the rule.
   */
  maxFiles?: number;
  maxFileBytes?: number;
  accept?: string;
  label?: string;
  disabled?: boolean;
  /**
   * How tall the drop target is, forwarded to `MultiFileDropzone`. Default
   * `"normal"`; pass `"tall"` on a screen where dropping files is the task rather
   * than one field of a form.
   */
  size?: "normal" | "tall";
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/** Bytes as a person reads them. View-local: the library has its own for messages. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} ${units[unit]}`;
}

export function FileUploaderZone({
  attached,
  onRemoveAttached,
  pending,
  onPendingChange,
  maxFiles,
  maxFileBytes,
  accept,
  label = "Drag files here, or click to browse",
  disabled = false,
  size = "normal",
  className = "",
}: FileUploaderZoneProps) {
  const total = attached.length + pending.length;
  const isFull = maxFiles !== undefined && total >= maxFiles;

  // Named here so the reason a file was refused is on screen rather than only in the
  // error the server would have returned after the upload.
  const oversized = maxFileBytes === undefined
    ? []
    : pending.filter((file) => file.size > maxFileBytes);

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {attached.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            Attached ({attached.length})
          </span>
          <ul className="flex flex-col gap-1">
            {attached.map((file) => (
              <li
                key={file.id}
                className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper px-3 py-1.5 text-sm"
              >
                {/* A link, not a button: opening a file is navigation, and a reader
                    expects middle-click and "save link as" to work on one. */}
                <a
                  href={file.href}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-ink underline decoration-line underline-offset-2 hover:decoration-brass"
                  title={file.name}
                >
                  {file.name}
                </a>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted">{formatSize(file.byteSize)}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onRemoveAttached(file.id)}
                    disabled={disabled}
                    ariaLabel={`Remove ${file.name}`}
                    title={`Remove ${file.name}`}
                  >
                    ×
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <MultiFileDropzone
        files={pending}
        onFilesChange={onPendingChange}
        accept={accept}
        label={isFull ? "No more files can be added" : label}
        disabled={disabled || isFull}
        size={size}
      />

      {(maxFiles !== undefined || maxFileBytes !== undefined) && (
        <p className="text-xs text-muted">
          {maxFiles !== undefined && `Up to ${maxFiles} files`}
          {maxFiles !== undefined && maxFileBytes !== undefined && ", "}
          {maxFileBytes !== undefined && `${formatSize(maxFileBytes)} each`}
          {maxFiles !== undefined && ` — ${total} of ${maxFiles} used`}.
        </p>
      )}

      {/* `text-red-400` rather than a theme token: design.md fixes error and success
          text to literal Tailwind colours, so "red means error" survives a theme whose
          accent happens to be red. */}
      {oversized.length > 0 && (
        <p className="text-xs text-red-400">
          {oversized.map((file) => file.name).join(", ")}{" "}
          {oversized.length === 1 ? "is" : "are"} over the{" "}
          {formatSize(maxFileBytes!)} limit and will be refused.
        </p>
      )}
    </div>
  );
}
