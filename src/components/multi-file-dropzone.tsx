// Drag-and-drop picker for SEVERAL files at once, with the chosen list shown and each
// row removable.
//
// A sibling of `FileDropzone` rather than a flag on it: that one is `onFile(file)` and
// holds no state, and every existing caller wants exactly that. Widening it to N files
// would have changed its callback shape for all of them. This one owns the *list* —
// which is the whole reason it exists, since choosing several files is an editing
// exercise (drop some, spot a wrong one, remove it, drop more) rather than a single
// event.
//
// Still "props in, events out": it never reads a file's contents. The caller decides
// how to read them, exactly as with `FileDropzone`.

"use client";

import { useRef, useState, type DragEvent } from "react";
import { Button } from "./button";

export interface MultiFileDropzoneProps {
  /** The current list. Controlled by the caller — this component stores no files. */
  files: File[];
  /** Called with the next list, after a drop/browse adds or an × removes. */
  onFilesChange: (files: File[]) => void;
  /** Forwarded to the file input, e.g. ".csv". */
  accept?: string;
  label?: string;
  disabled?: boolean;
  /** Refuse a file whose name is already in the list. Default `true`. */
  dedupeByName?: boolean;
  className?: string;
}

export function MultiFileDropzone({
  files,
  onFilesChange,
  accept,
  label = "Drag CSV files here, or click to browse",
  disabled = false,
  dedupeByName = true,
  className = "",
}: MultiFileDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(incoming: FileList | null) {
    if (disabled || !incoming || incoming.length === 0) return;
    const added = Array.from(incoming);
    if (!dedupeByName) {
      onFilesChange([...files, ...added]);
      return;
    }
    // Dropping the same file twice would import its rows twice under one source name,
    // which reads as a device with double the readings — worth refusing by default.
    const seen = new Set(files.map((file) => file.name));
    const unique = added.filter((file) => {
      if (seen.has(file.name)) return false;
      seen.add(file.name);
      return true;
    });
    if (unique.length > 0) onFilesChange([...files, ...unique]);
  }

  function removeAt(index: number) {
    onFilesChange(files.filter((_, i) => i !== index));
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onDragOver={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          if (!disabled) setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          setIsDragOver(false);
          addFiles(event.dataTransfer.files);
        }}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={[
          "flex min-h-24 cursor-pointer items-center justify-center rounded-md border-2 border-dashed p-6 text-center text-sm transition-colors",
          isDragOver ? "border-brass bg-paper-raised text-ink" : "border-line text-muted",
          disabled ? "cursor-not-allowed opacity-60" : "hover:border-brass hover:text-ink",
        ].join(" ")}
      >
        {label}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          disabled={disabled}
          onChange={(event) => {
            addFiles(event.target.files);
            // Reset so re-picking the same file still fires a change event.
            event.target.value = "";
          }}
          className="hidden"
        />
      </div>

      {files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper px-3 py-1.5 text-sm"
            >
              <span className="truncate text-ink" title={file.name}>
                {file.name}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => removeAt(index)}
                disabled={disabled}
                ariaLabel={`Remove ${file.name}`}
                title={`Remove ${file.name}`}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
