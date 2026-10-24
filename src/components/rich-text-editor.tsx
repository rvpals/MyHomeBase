"use client";

// A small rich-text editor over `contentEditable`, with a paste handler that keeps
// an email's formatting and hands its images back to the caller.
//
// ## Why no editor library
//
// TipTap and Lexical were both considered and declined for this. The deciding
// question was whether tables need *editing* or only *preserving*: a clip is
// archival — the table arrives already made in a pasted email, and the reader edits
// the text around it. Preserving a table is a storage-and-rendering problem, which
// `contentEditable` handles for free. Building one is an interaction problem, which
// is where a hand-rolled editor stops being worth it.
//
// So this component cannot insert or restructure a table, and that is a deliberate
// limit rather than an oversight. If that changes, this is the component to replace
// with TipTap — the props are shaped to make that swap possible without touching any
// caller.
//
// ## Props in, events out
//
// No fetching and no business logic, per ARCHITECTURE.md. The sanitizer and the
// image upload both live in the caller: this component reports "the reader pasted
// this HTML" and "the reader pasted these image files", and the page decides what
// that means. That is what keeps the same sanitising pass running for the CLI and
// the browser.

import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react";
import type { TreeIconConcept } from "@/lib/icons/tree-icon-names";
import { TreeIcon } from "./tree-icons";

export interface RichTextEditorProps {
  /** The current HTML. Sanitized by the caller before it arrives here. */
  value: string;
  /** Raised when the reader types, formats, or pastes. */
  onChange: (html: string) => void;
  /**
   * Raised when a paste carried image files. The caller uploads them and returns
   * each one's served URL, in the same order; this component then inserts them.
   *
   * Returning fewer URLs than files is allowed and expected — an image the server
   * refused simply is not inserted.
   */
  onPasteImages?: (files: File[]) => Promise<string[]>;
  /**
   * Raised when a paste carried HTML, so the caller can run the real sanitizer over
   * it. Returning the cleaned markup is what gets inserted. Without this the paste
   * is inserted as plain text — the safe default, never raw HTML.
   */
  onSanitize?: (html: string) => string;
  placeholder?: string;
  /** Read-only rendering: no toolbar, no editing. Used by the viewer. */
  readOnly?: boolean;
  className?: string;
}

/** One toolbar button. `command` is passed to `document.execCommand`. */
interface ToolbarAction {
  command: string;
  value?: string;
  label: string;
  /** A name from `TREE_ICON_NAMES` — `TreeIcon` renders nothing for anything else. */
  icon: TreeIconConcept;
}

/**
 * The toolbar, as data.
 *
 * `document.execCommand` is formally deprecated and still the only thing every
 * browser implements for `contentEditable` formatting — the standards replacement
 * never shipped. Using it here is a deliberate, contained bet: every call is in this
 * one file, so a future replacement is one component's worth of work.
 */
const ACTIONS: ToolbarAction[] = [
  { command: "bold", label: "Bold", icon: "pencil" },
  { command: "italic", label: "Italic", icon: "quote" },
  { command: "insertUnorderedList", label: "Bullet list", icon: "list" },
  { command: "insertOrderedList", label: "Numbered list", icon: "list" },
  { command: "formatBlock", value: "<h2>", label: "Heading", icon: "newspaper" },
  { command: "formatBlock", value: "<blockquote>", label: "Quote", icon: "quote" },
  { command: "removeFormat", label: "Clear formatting", icon: "refresh" },
];

export function RichTextEditor({
  value,
  onChange,
  onPasteImages,
  onSanitize,
  placeholder = "Write, or paste an email here…",
  readOnly = false,
  className = "",
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(value === "");

  /**
   * Writes `value` into the DOM only when it differs from what is already there.
   *
   * This is the central contentEditable problem: React re-rendering the node on
   * every keystroke would reset the caret to the start of the field. So the node is
   * written to imperatively, and only when the incoming value genuinely differs from
   * the DOM's own — which is false during normal typing, because the DOM is where
   * that value came from.
   */
  useEffect(() => {
    const node = editorRef.current;
    if (!node) return;
    if (node.innerHTML !== value) node.innerHTML = value;
    setIsEmpty(node.textContent?.trim() === "" && !node.querySelector("img, table"));
  }, [value]);

  const emit = useCallback(() => {
    const node = editorRef.current;
    if (!node) return;
    setIsEmpty(node.textContent?.trim() === "" && !node.querySelector("img, table"));
    onChange(node.innerHTML);
  }, [onChange]);

  const run = useCallback(
    (action: ToolbarAction) => {
      // Focus first: execCommand acts on the document's selection, and a click on a
      // toolbar button has already moved focus off the editable node.
      editorRef.current?.focus();
      document.execCommand(action.command, false, action.value);
      emit();
    },
    [emit],
  );

  /**
   * The paste handler — the reason this component exists.
   *
   * Three kinds of paste, in priority order:
   *
   *  1. **Image files** (a screenshot, or an image dragged out of an email). Handed
   *     to the caller to store, then inserted as `<img>` pointing at the stored URL.
   *  2. **HTML** (an email). Run through the caller's sanitizer and inserted.
   *  3. **Anything else** — inserted as plain text.
   *
   * The default is always the *safest* branch: with no `onSanitize` the HTML path
   * degrades to plain text rather than inserting unsanitized markup.
   */
  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (readOnly) return;

      const clipboard = event.clipboardData;
      const files = Array.from(clipboard.files).filter((file) => file.type.startsWith("image/"));

      if (files.length > 0 && onPasteImages) {
        event.preventDefault();
        void onPasteImages(files).then((urls) => {
          editorRef.current?.focus();
          for (const url of urls) {
            // `insertHTML` rather than building a node: it respects the caret and
            // the undo stack, which a manual DOM insertion does not.
            document.execCommand("insertHTML", false, `<img src="${url}" alt="">`);
          }
          emit();
        });
        return;
      }

      const html = clipboard.getData("text/html");
      if (html && onSanitize) {
        event.preventDefault();
        document.execCommand("insertHTML", false, onSanitize(html));
        emit();
        return;
      }

      // Plain text, explicitly. Without this branch the browser would insert the
      // clipboard's own HTML unsanitized, which is the exact thing this component
      // must never do.
      event.preventDefault();
      document.execCommand("insertText", false, clipboard.getData("text/plain"));
      emit();
    },
    [emit, onPasteImages, onSanitize, readOnly],
  );

  if (readOnly) {
    return (
      <div
        className={`clip-content text-sm text-ink ${className}`}
        dangerouslySetInnerHTML={{ __html: value }}
      />
    );
  }

  return (
    <div className={`rounded-md border border-line bg-paper ${className}`}>
      {/* Wraps to a second row below 1024px rather than scrolling sideways — a
          toolbar that has to be scrolled to reach "bold" is not a toolbar. */}
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        {ACTIONS.map((action) => (
          <button
            key={`${action.command}-${action.value ?? ""}`}
            type="button"
            title={action.label}
            aria-label={action.label}
            // `onMouseDown` with preventDefault, not `onClick`: a click would blur
            // the editable node first, collapsing the selection the command needs.
            onMouseDown={(event) => {
              event.preventDefault();
              run(action);
            }}
            className="rounded p-1.5 text-muted hover:bg-paper-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            <TreeIcon name={action.icon} className="h-4 w-4" />
          </button>
        ))}
      </div>

      <div className="relative">
        {isEmpty && (
          <span className="pointer-events-none absolute left-3 top-3 text-sm text-muted">
            {placeholder}
          </span>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          onInput={emit}
          onBlur={emit}
          onPaste={handlePaste}
          className="clip-content min-h-[12rem] px-3 py-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass max-lg:min-h-[8rem]"
        />
      </div>
    </div>
  );
}
