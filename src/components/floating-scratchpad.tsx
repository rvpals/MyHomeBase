"use client";

// The Floating Scratchpad: the third floating component, and the first whose content is
// something the reader *types*.
//
// Thin, like the clock and the calculator. The domain rules are `src/lib/scratchpad`
// (what a note is called, what a saved file contains, which tab opens), the chrome is
// `FloatingWindow` / `FloatingPuck`, the tab strip is the registered `Tabs`, and the
// layer owns open/minimized/closed. What is left here is the wiring, the autosave timer,
// and the two browser-only gestures — clipboard and download.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { FloatingPuck, FloatingWindow } from "@/components/floating-window";
import { useFloatingLayer } from "@/components/floating-layer";
import { SlotIcon } from "@/components/slot-icon";
import { Tabs, type TabItem } from "@/components/tabs";
import { getIconSlot } from "@/lib/icons";
import {
  categoryToTextFile,
  noteLabel,
  noteToTextFile,
  type Note,
  type NoteCategory,
} from "@/lib/scratchpad";

// Resolved once at module scope — `getIconSlot` reads the static registry, no I/O. The
// guard is for the registry, not the user: a removed id costs the window its glyph
// rather than crashing.
const SCRATCHPAD_SLOT = getIconSlot("floating_scratchpad_window");

/**
 * How long after the last keystroke a note is written.
 *
 * 800ms is the usual "user has paused" figure: long enough that typing a sentence is one
 * write rather than thirty, short enough that a reader who types and immediately
 * minimizes has already been saved. The remaining gap is closed by flushing on blur,
 * on a tab switch and on minimize/close, so the timer is an optimisation rather than the
 * only thing standing between a note and the database.
 */
const AUTOSAVE_DELAY_MS = 800;

/**
 * What the scratchpad needs from the server.
 *
 * Injected as props for the reason `components.md` gives: a file under `src/components/`
 * must not import from `src/app/`.
 *
 * **Every signature matches its server action exactly**, so the mount site can assign
 * the action itself rather than wrapping it. A `"use server"` function crosses into a
 * client component because React recognises *that* function; an arrow around it is an
 * ordinary closure and serializing it fails at request time with "Functions cannot be
 * passed directly to Client Components". That is why these return `{ ok, notes? }`
 * rather than a tidier `Note[]` — the port mirrors the action and this component
 * unwraps. Same rule as `CalculatorActions` and `MusicQueueActions`.
 */
export interface ScratchpadActions {
  /** This reader's notes in one tab, for a tab switch. */
  listNotes: (categoryId: number) => Promise<{ ok: boolean; error?: string; notes?: Note[] }>;
  /** Creates an empty note in a tab and returns the tab's notes. */
  createNote: (categoryId: number) => Promise<{ ok: boolean; error?: string; notes?: Note[] }>;
  /**
   * Writes a note's title and/or body — what autosave calls.
   *
   * Returns the tab's notes so the list reorders (most recently edited first) without a
   * second round trip.
   */
  saveNote: (input: {
    id: number;
    title?: string;
    body?: string;
  }) => Promise<{ ok: boolean; error?: string; notes?: Note[] }>;
  /** Deletes one note and returns what is left in the tab. */
  deleteNote: (id: number) => Promise<{ ok: boolean; error?: string; notes?: Note[] }>;
}

/**
 * The puck's image: the active tab's name over a count of its notes.
 *
 * This is the scratchpad's answer to "a puck is an image, not a label" — not a miniature
 * of the window, and not the note text, which is illegible at 56px and would put someone's
 * private notes permanently on screen over every page. The tab name plus a count is the
 * one glanceable fact: *which notebook is open, and is there anything in it.*
 */
function PuckNotes({ categoryName, count }: { categoryName?: string; count: number }) {
  if (categoryName === undefined) {
    // No categories at all, so nothing to name. The glyph keeps the puck reading as a
    // notepad rather than as an empty circle — the same fallback the calculator's `=`
    // makes before its first sum.
    return (
      <span className="flex h-full w-full items-center justify-center text-brass">
        {SCRATCHPAD_SLOT ? <SlotIcon slot={SCRATCHPAD_SLOT} className="h-5 w-5" /> : "≡"}
      </span>
    );
  }

  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1">
      {/* The name is clipped rather than shrunk to fit: at 56px a font small enough for
          "Shopping list" in full is unreadable anyway, and the full name is in the
          button's title and accessible name. */}
      <span className="max-w-full truncate text-[0.5rem] font-medium uppercase tracking-wide text-muted">
        {categoryName}
      </span>
      <span className="font-mono text-base font-semibold tabular-nums leading-none text-ink">
        {count}
      </span>
    </span>
  );
}

/**
 * One note in the list: its label, and the row actions.
 *
 * The three per-note controls are **bare glyph buttons, not `Button`s**, per
 * `coding-guide.md` → *Icons: use a slot, not a bare glyph name*: row actions and state
 * glyphs deliberately stay as they are, and three hard offset shadows on every row of a
 * list would be visually deafening — the same call the calculator's keypad makes.
 */
function NoteRow({
  note,
  isActive,
  onSelect,
  onCopy,
  onSave,
  onDelete,
  isCopied,
}: {
  note: Note;
  isActive: boolean;
  onSelect: () => void;
  onCopy: () => void;
  onSave: () => void;
  onDelete: () => void;
  isCopied: boolean;
}) {
  const label = noteLabel(note);

  return (
    <li
      className={`flex items-center gap-1 rounded border px-1 transition-colors ${
        isActive ? "border-brass bg-brass-soft" : "border-transparent hover:bg-brass-soft"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        title={label}
        className="min-w-0 flex-1 truncate py-1.5 text-left text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      >
        {label}
      </button>

      {/* Copy. The tick is the whole feedback — a toast for a clipboard write is more
          interruption than the action deserves. */}
      <button
        type="button"
        onClick={onCopy}
        title={isCopied ? "Copied" : "Copy this note"}
        aria-label={`Copy "${label}"`}
        className="shrink-0 rounded p-1 text-muted transition-colors hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      >
        {isCopied ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5 text-brass-dark"
            aria-hidden="true"
          >
            <path d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="11" height="11" rx="1.5" />
            <path d="M6.5 15H5.5A1.5 1.5 0 0 1 4 13.5V5.5A1.5 1.5 0 0 1 5.5 4h8A1.5 1.5 0 0 1 15 5.5v1" />
          </svg>
        )}
      </button>

      {/* Save to a text file — a download arrow, not a floppy disk: what it does is
          "put this on my computer". */}
      <button
        type="button"
        onClick={onSave}
        title="Save this note as a text file"
        aria-label={`Save "${label}" as a text file`}
        className="shrink-0 rounded p-1 text-muted transition-colors hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <path d="M12 4v10" />
          <path d="M8 11l4 4 4-4" />
          <path d="M5 18.5h14" />
        </svg>
      </button>

      {/* Delete, in semantic red. Confirmation is the caller's — see `pendingDeleteId`,
          which turns this row into a confirm strip rather than opening a dialog over a
          floating window. */}
      <button
        type="button"
        onClick={onDelete}
        title="Delete this note"
        aria-label={`Delete "${label}"`}
        className="shrink-0 rounded p-1 text-muted transition-colors hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <path d="M5 7h14" />
          <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
          <path d="M6.5 7l.8 11A1.5 1.5 0 0 0 8.8 19.5h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
        </svg>
      </button>
    </li>
  );
}

export function FloatingScratchpad({
  categories,
  initialNotes,
  initialCategoryId,
  actions,
}: {
  /** The household's tab strip, resolved on the server. */
  categories: readonly NoteCategory[];
  /** The active tab's notes, resolved on the server so the window opens filled. */
  initialNotes: readonly Note[];
  /** Which tab the server resolved — already the right one on the first paint. */
  initialCategoryId?: number;
  actions: ScratchpadActions;
}) {
  const layer = useFloatingLayer();

  const [activeCategoryId, setActiveCategoryId] = useState<number | undefined>(
    initialCategoryId,
  );
  // The notes written *in this window*, or `undefined` while the server's copy still
  // stands. Deliberately not seeded from the prop and re-synced in an effect: mirroring
  // a prop into state means a `setState` in an effect body, the cascading-render pattern
  // `react-hooks/set-state-in-effect` exists to catch. So the server's prop is the
  // default and a local write overrides it — the same shape `FloatingCalculator`'s tape
  // uses, and it means a note added from the CLI arrives as a new prop.
  const [localNotes, setLocalNotes] = useState<readonly Note[] | undefined>(undefined);
  const notes = localNotes ?? initialNotes;

  const [selectedNoteId, setSelectedNoteId] = useState<number | undefined>(
    () => initialNotes[0]?.id,
  );
  // The textarea's live value. Held locally rather than read from `notes` so typing is
  // never a round trip, and so autosave can compare against what was stored.
  const [draft, setDraft] = useState(() => initialNotes[0]?.body ?? "");
  const [titleDraft, setTitleDraft] = useState(() => initialNotes[0]?.title ?? "");

  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  const [copiedNoteId, setCopiedNoteId] = useState<number | undefined>(undefined);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | undefined>(undefined);

  const activeCategory = categories.find((category) => category.id === activeCategoryId);
  const selectedNote = notes.find((note) => note.id === selectedNoteId);

  // The autosave timer, and the values it should write when it fires. Refs rather than
  // state: changing them must not re-render, and the flush path needs to read the
  // *latest* draft rather than the one captured when the timer was set.
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingRef = useRef<{ id: number; title: string; body: string } | undefined>(undefined);

  /**
   * Writes whatever is pending, now.
   *
   * Called by the timer, and directly on blur, on a tab switch and when the window is
   * minimized or closed — so the 800ms debounce is an optimisation rather than the only
   * thing standing between a note and the database.
   */
  const flush = useCallback(async () => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = undefined;

    setStatus("saving");
    const outcome = await actions.saveNote({
      id: pending.id,
      title: pending.title,
      body: pending.body,
    });

    if (!outcome.ok) {
      // Surfaced, unlike the calculator's fire-and-forget tape. The distinction is what
      // is at stake: a dropped tape row is a lost record of something still on screen,
      // but a dropped note save is the reader's own writing, and they must not close the
      // window believing it was kept.
      setStatus("idle");
      setError(outcome.error ?? "That note could not be saved.");
      return;
    }

    setStatus("saved");
    setError(undefined);
    if (outcome.notes) setLocalNotes(outcome.notes);
  }, [actions]);

  /** Queues a write for the note being edited. */
  const queueSave = useCallback(
    (fields: { title?: string; body?: string }) => {
      if (selectedNoteId === undefined) return;

      pendingRef.current = {
        id: selectedNoteId,
        // Merged with what is already queued, so a title edit followed by a body edit
        // inside one debounce window writes both rather than only the last.
        title: fields.title ?? pendingRef.current?.title ?? titleDraft,
        body: fields.body ?? pendingRef.current?.body ?? draft,
      };

      setStatus("saving");
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    },
    [draft, flush, selectedNoteId, titleDraft],
  );

  // A pending write must not be lost because the component unmounted — which is what a
  // navigation away from the page does. The cleanup fires the write rather than just
  // clearing the timer.
  useEffect(
    () => () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
      const pending = pendingRef.current;
      if (pending) {
        pendingRef.current = undefined;
        // Deliberately not awaited: an unmount cleanup cannot be async. The action is a
        // POST that survives the component, which is the most that can be done here.
        void actions.saveNote({ id: pending.id, title: pending.title, body: pending.body });
      }
    },
    [actions],
  );

  /** Moves to another note, saving the current one first. */
  const selectNote = useCallback(
    async (note: Note) => {
      await flush();
      setSelectedNoteId(note.id);
      setDraft(note.body);
      setTitleDraft(note.title);
      setStatus("idle");
      setPendingDeleteId(undefined);
    },
    [flush],
  );

  /** Switches tabs, saving first and loading the new tab's notes. */
  const selectCategory = useCallback(
    async (categoryId: number) => {
      await flush();
      setActiveCategoryId(categoryId);
      setPendingDeleteId(undefined);
      setStatus("idle");

      const outcome = await actions.listNotes(categoryId);
      if (!outcome.ok || !outcome.notes) {
        setError(outcome.error ?? "Those notes could not be loaded.");
        return;
      }
      setError(undefined);
      setLocalNotes(outcome.notes);
      // Selects the tab's most recently edited note, which is the one the reader most
      // likely wants — and leaves the editor genuinely empty for an empty tab rather
      // than showing the previous tab's note under the new tab's name.
      const first = outcome.notes[0];
      setSelectedNoteId(first?.id);
      setDraft(first?.body ?? "");
      setTitleDraft(first?.title ?? "");
    },
    [actions, flush],
  );

  const handleNewNote = useCallback(async () => {
    if (activeCategoryId === undefined) return;
    await flush();

    const outcome = await actions.createNote(activeCategoryId);
    if (!outcome.ok || !outcome.notes) {
      setError(outcome.error ?? "That note could not be created.");
      return;
    }
    setError(undefined);
    setLocalNotes(outcome.notes);
    // The new note is the newest-edited, so it is first — and it is empty, so the
    // textarea is ready to type into.
    const created = outcome.notes[0];
    setSelectedNoteId(created?.id);
    setDraft("");
    setTitleDraft("");
    setStatus("idle");
  }, [actions, activeCategoryId, flush]);

  const handleDelete = useCallback(
    async (id: number) => {
      // A queued write for the note being deleted would resurrect nothing but would
      // report a confusing failure, so it is dropped rather than flushed.
      if (pendingRef.current?.id === id) pendingRef.current = undefined;
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);

      const outcome = await actions.deleteNote(id);
      setPendingDeleteId(undefined);
      if (!outcome.ok || !outcome.notes) {
        setError(outcome.error ?? "That note could not be deleted.");
        return;
      }
      setError(undefined);
      setLocalNotes(outcome.notes);

      if (selectedNoteId === id) {
        const next = outcome.notes[0];
        setSelectedNoteId(next?.id);
        setDraft(next?.body ?? "");
        setTitleDraft(next?.title ?? "");
      }
      setStatus("idle");
    },
    [actions, selectedNoteId],
  );

  const handleCopy = useCallback(async (note: Note) => {
    try {
      // The note's text alone, not the file's header: someone copying a note is pasting
      // it into a message, where "Category: Shopping" is noise. The *file* gets the
      // header because a file is found later out of context.
      await navigator.clipboard.writeText(note.body);
      setCopiedNoteId(note.id);
      // A denied clipboard permission is not worth a dialog — the text is on screen and
      // selectable, which is the fallback either way. Same call as the AI-export view.
    } catch {
      setCopiedNoteId(undefined);
    }
  }, []);

  // The tick resets itself. A `setTimeout` in an effect keyed on the copied id, so the
  // timer is cleaned up on unmount and a second copy restarts it rather than stacking.
  useEffect(() => {
    if (copiedNoteId === undefined) return;
    const timer = setTimeout(() => setCopiedNoteId(undefined), 1500);
    return () => clearTimeout(timer);
  }, [copiedNoteId]);

  /**
   * Downloads a note, or the whole tab, as a text file.
   *
   * The filename and the contents both come from `lib` — "what should this file be
   * called" is a rule about notes, not about markup. What is left here is the four lines
   * of DOM that genuinely need a browser.
   */
  const download = useCallback((file: { fileName: string; content: string }) => {
    const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleSaveNote = useCallback(
    (note: Note) => {
      // The draft, not the stored note, when it is the one being edited: saving a file
      // must capture what is on screen even if the debounce hasn't fired yet.
      const isEditing = note.id === selectedNoteId;
      download(
        noteToTextFile(
          {
            title: isEditing ? titleDraft : note.title,
            body: isEditing ? draft : note.body,
            updatedAt: note.updatedAt,
          },
          activeCategory?.name ?? "Notes",
        ),
      );
    },
    [activeCategory, download, draft, selectedNoteId, titleDraft],
  );

  const handleSaveCategory = useCallback(() => {
    download(
      categoryToTextFile(
        notes.map((note) =>
          note.id === selectedNoteId
            ? { title: titleDraft, body: draft, updatedAt: note.updatedAt }
            : note,
        ),
        activeCategory?.name ?? "Notes",
      ),
    );
  }, [activeCategory, download, draft, notes, selectedNoteId, titleDraft]);

  /**
   * One tab's panel. Every tab renders the same editor, so the content is built once
   * and handed to whichever tab is active.
   *
   * `Tabs` takes `content` per item, so the panel is the same node for each — the strip
   * is what changes. Building it once rather than per-category also keeps the textarea
   * from being remounted (and losing its cursor) on a re-render.
   */
  const panel = (
    <div className="mt-3 flex flex-col gap-3 lg:flex-row">
      {/* The note list. Above the editor when narrow, beside it when wide — a
          `max-lg:`-first restyle, so the desktop classes are untouched. */}
      <div className="flex shrink-0 flex-col lg:w-48">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            {notes.length === 1 ? "1 note" : `${notes.length} notes`}
          </span>
          <button
            type="button"
            onClick={() => void handleNewNote()}
            disabled={activeCategoryId === undefined}
            className="rounded px-1 text-xs font-medium text-brass-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
          >
            + New note
          </button>
        </div>

        {notes.length === 0 ? (
          <p className="mt-2 text-xs text-muted">
            Nothing here yet. &ldquo;New note&rdquo; starts one — it saves as you type.
          </p>
        ) : (
          // Capped height with its own scroller, so a full tab can't push the editor
          // off a short window.
          <ul className="mt-1 flex max-h-32 flex-col gap-0.5 overflow-y-auto lg:max-h-72">
            {notes.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                isActive={note.id === selectedNoteId}
                isCopied={note.id === copiedNoteId}
                onSelect={() => void selectNote(note)}
                onCopy={() => void handleCopy(note)}
                onSave={() => handleSaveNote(note)}
                onDelete={() => setPendingDeleteId(note.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* The editor. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {selectedNote === undefined ? (
          <p className="rounded-md border border-dashed border-line px-3 py-8 text-center text-sm text-muted">
            {activeCategoryId === undefined
              ? "There are no categories yet."
              : "Select a note, or start a new one."}
          </p>
        ) : (
          <>
            <input
              type="text"
              value={titleDraft}
              onChange={(event) => {
                setTitleDraft(event.target.value);
                queueSave({ title: event.target.value });
              }}
              onBlur={() => void flush()}
              placeholder="Title (optional)"
              maxLength={120}
              className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm font-medium text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
            />

            <textarea
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                queueSave({ body: event.target.value });
              }}
              onBlur={() => void flush()}
              placeholder="Write anything…"
              // `spellCheck` on: this is prose, unlike the calculator's entry.
              spellCheck
              className="mt-2 w-full flex-1 resize-y rounded-md border border-line bg-paper px-3 py-2 font-sans text-sm leading-relaxed text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass max-lg:min-h-[9rem] lg:h-64"
            />

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {/* The three actions the request names, on the note being edited. `Button`
                  here rather than the row's bare glyphs: these are discrete,
                  panel-level actions with room for a label, which is exactly what
                  design.md reserves `Button` for. */}
              <Button size="sm" variant="secondary" onClick={() => void handleCopy(selectedNote)}>
                {copiedNoteId === selectedNote.id ? "Copied" : "Copy"}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => handleSaveNote(selectedNote)}>
                Save as file
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => setPendingDeleteId(selectedNote.id)}
              >
                Delete
              </Button>

              {/* The save indicator, not a Save button — there is nothing to submit.
                  `aria-live` so a screen reader hears it settle; `polite` because it
                  must not interrupt typing. */}
              <span className="ml-auto text-xs text-muted" aria-live="polite">
                {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
              </span>
            </div>
          </>
        )}

        {/* Deleting confirms in place rather than opening a dialog: `Modal` owns `z-50`,
            so a confirm dialog would cover the floating window it was launched from, and
            a note is a small enough thing that a strip is proportionate. */}
        {pendingDeleteId !== undefined && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-red-400/40 bg-red-400/5 px-3 py-2">
            <span className="text-xs text-ink">Delete this note? It can&rsquo;t be undone.</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPendingDeleteId(undefined)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => void handleDelete(pendingDeleteId)}
              >
                Delete
              </Button>
            </div>
          </div>
        )}

        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );

  // Deliberately **not** memoized. `panel` closes over the drafts, so it is a new node
  // on every render by design — a `useMemo` keyed on it would recompute every time
  // anyway, which is the memo that only costs. Mapping a handful of categories is
  // cheaper than the dependency check.
  //
  // The same `panel` node for every tab: the strip is what changes between tabs, and
  // building a separate panel per category would remount the textarea on a tab switch
  // and lose the cursor.
  const tabItems: TabItem[] = categories.map((category) => ({
    key: String(category.id),
    label: category.name,
    content: panel,
  }));

  if (!layer) return null;

  const floatingState = layer.states.scratchpad ?? "closed";
  if (floatingState === "closed") return null;

  if (floatingState === "minimized") {
    const puck = layer.puckSlots.find((candidate) => candidate.id === "scratchpad");
    return (
      <FloatingPuck
        label={
          activeCategory
            ? `Scratchpad — ${activeCategory.name} (${notes.length})`
            : "Scratchpad"
        }
        index={puck?.index ?? 0}
        corner={puck?.corner ?? "bottom-right"}
        onRestore={() => layer.restore("scratchpad")}
        onClose={() => layer.close("scratchpad")}
      >
        <PuckNotes categoryName={activeCategory?.name} count={notes.length} />
      </FloatingPuck>
    );
  }

  return (
    <FloatingWindow
      title="Scratchpad"
      titleIcon={
        SCRATCHPAD_SLOT ? <SlotIcon slot={SCRATCHPAD_SLOT} className="h-4 w-4" /> : undefined
      }
      // Both flush first, so minimizing or closing mid-sentence keeps the sentence.
      onClose={() => {
        void flush();
        layer.close("scratchpad");
      }}
      onMinimize={() => {
        void flush();
        layer.minimize("scratchpad");
      }}
      // Wider than the calculator's window and narrower than the cap: a list beside a
      // textarea needs the room, but `size="window"` is content-sized, so an explicit
      // width is what stops the textarea from being the thing defining it.
      className="lg:h-auto lg:max-h-[min(90vh,46rem)] lg:w-[46rem]"
    >
      {categories.length === 0 ? (
        <p className="py-6 text-sm text-muted">
          There are no note categories yet. An administrator adds them in Administration
          &rsaquo; Display Settings &rsaquo; Scratchpad Categories.
        </p>
      ) : (
        <>
          <Tabs
            items={tabItems}
            activeKey={activeCategoryId === undefined ? undefined : String(activeCategoryId)}
            onActiveKeyChange={(key) => void selectCategory(Number(key))}
            // Controlled, because switching tabs has to save the open note and load the
            // new tab's notes — work the strip itself knows nothing about.
            //
            // The strip scrolls rather than wraps when categories overflow: a wrapping
            // strip changes height as tabs are added, which on a phone would push the
            // editor around. `min-w-max` on the inner row is what `overflow-x-auto`
            // needs to actually scroll rather than compress.
            className="[&>div:first-child]:min-w-max [&>div:first-child]:overflow-x-auto"
          />

          {notes.length > 0 && (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={handleSaveCategory}
                className="rounded px-1 text-xs text-brass-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
              >
                Save all of {activeCategory?.name ?? "this tab"} as a text file
              </button>
            </div>
          )}
        </>
      )}
    </FloatingWindow>
  );
}
