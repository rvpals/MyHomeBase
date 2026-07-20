// Drag-and-drop file picker with a click-to-browse fallback. Pure "props in, events
// out": it hands the caller a File and never reads its contents itself — the caller
// decides how to read it (e.g. FileReader.readAsText for CSV text).

"use client";

import { useRef, useState, type DragEvent } from "react";

export interface FileDropzoneProps {
  /** Called with the first dropped/selected file. */
  onFile: (file: File) => void;
  /** Forwarded to the underlying file input, e.g. ".csv". */
  accept?: string;
  /** Shown inside the dropzone. Defaults to a generic prompt. */
  label?: string;
  disabled?: boolean;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function FileDropzone({
  onFile,
  accept,
  label = "Drag a file here, or click to browse",
  disabled = false,
  className = "",
}: FileDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragOver(false);
    if (disabled) return;
    const file = event.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(event) => {
        if (!disabled && (event.key === "Enter" || event.key === " ")) inputRef.current?.click();
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${
        disabled
          ? "cursor-not-allowed border-line text-muted opacity-50"
          : isDragOver
            ? "border-brass bg-brass-soft text-brass-dark"
            : "border-line bg-paper text-muted hover:border-brass/50 hover:text-ink"
      } ${className}`}
    >
      <span className="text-sm font-medium">{label}</span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}
