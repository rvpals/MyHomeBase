"use client";

// "+ Clip" on the journal entry form: write a new clip for this entry, or find and
// attach an existing one.
//
// ## Two modes, because a new entry has no row to attach to
//
// **Writing a new entry** (`entryId` omitted): the entry does not exist until Save,
// so this field keeps a *pending* list and `journal-entry-form.tsx` writes the links
// in `attachPendingClips` once the save returns an id.
//
// **Editing an existing entry** (`entryId` given): there is a row already, so a pick
// is linked immediately and a removal detaches immediately. Nothing waits for Save —
// which also means the clips are unaffected if the reader then cancels the edit.
// That is deliberate: attaching a clip is its own act, not a pending change to the
// entry's text.
//
// The second mode loads what is already attached on mount; the first starts empty.
//
// Named `journal-*` rather than `clips-*` because it renders on the journal's entry
// form and is wired into that form's lifecycle. It still reads only through
// `clips-actions`, so `src/lib/journal` stays ignorant of clips.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { TreeIcon } from "@/components/tree-icons";
import type { ClipSummary } from "@/lib/clips";
import { ClipsEditor } from "./clips-editor";
import { ClipsViewer } from "./clips-viewer";
import {
  linkClipAction,
  listClipLinksAction,
  listClipsForEntryAction,
  searchClipsForEntryAction,
  unlinkClipAction,
} from "./clips-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export interface JournalEntryClipsFieldProps {
  /**
   * The clips chosen for this entry. On a new entry these are *pending* — nothing
   * is linked until the form saves and calls `attachPendingClips`.
   */
  value: ClipSummary[];
  onChange: (next: ClipSummary[]) => void;
  /**
   * The entry these belong to, when it already exists (the edit form). Given one,
   * picking a clip links it immediately and removing one detaches it; without one
   * the picks are held until the new entry is saved.
   */
  entryId?: number;
  /** Category and tag names, so a clip written here offers the same vocabulary. */
  categoryOptions: string[];
  tagOptions: string[];
}

export function JournalEntryClipsField({
  value,
  onChange,
  entryId,
  categoryOptions,
  tagOptions,
}: JournalEntryClipsFieldProps) {
  const [picking, setPicking] = useState(false);
  const [writing, setWriting] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<ClipSummary[]>([]);
  const [viewing, setViewing] = useState<number | undefined>(undefined);
  const [error, setError] = useState("");

  // What is already attached, when editing an existing entry. A new entry has
  // nothing to load and starts from whatever the reader picks.
  //
  // `onChangeRef` keeps the handler out of the dependency list: the parent
  // re-creates it on every render, so depending on it would re-fetch on every
  // keystroke typed into the entry form.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (entryId === undefined) return;
    let cancelled = false;

    void listClipsForEntryAction(entryId).then((result) => {
      if (cancelled) return;
      if (result.ok && result.clips) onChangeRef.current(result.clips);
      else setError(result.error ?? "Could not load this entry's clips.");
    });

    return () => {
      cancelled = true;
    };
  }, [entryId]);

  useEffect(() => {
    if (!picking) return;
    let cancelled = false;

    void searchClipsForEntryAction(term).then((result) => {
      if (cancelled) return;
      if (result.ok && result.clips) setResults(result.clips);
      else setError(result.error ?? "Could not search the clips.");
    });

    return () => {
      cancelled = true;
    };
  }, [picking, term]);

  const add = useCallback(
    async (clip: ClipSummary) => {
      if (value.some((chosen) => chosen.id === clip.id)) return;

      // On an existing entry the link is written now. The list is only updated
      // once the server agrees, so a failed attach cannot leave a clip showing as
      // attached when it is not.
      if (entryId !== undefined) {
        const result = await linkClipAction(clip.id, entryId);
        if (!result.ok) {
          setError(result.error ?? "Could not attach that clip.");
          return;
        }
      }

      onChange([...value, clip]);
      setPicking(false);
      setTerm("");
      setError("");
    },
    [entryId, onChange, value],
  );

  /**
   * Takes a clip off this entry.
   *
   * On an existing entry that means detaching the link, which needs the link's own
   * id — so the links are re-read to find the one pointing at this clip. One extra
   * round trip on a rare action, against threading link ids through a list whose
   * other mode (a new entry) has none.
   */
  const remove = useCallback(
    async (clip: ClipSummary) => {
      if (entryId !== undefined) {
        const links = await listClipLinksAction(clip.id);
        if (!links.ok || !links.links) {
          setError(links.error ?? "Could not detach that clip.");
          return;
        }

        const link = links.links.find((row) => row.targetId === entryId);
        if (link) {
          const result = await unlinkClipAction(link.id);
          if (!result.ok) {
            setError(result.error ?? "Could not detach that clip.");
            return;
          }
        }
      }

      onChange(value.filter((chosen) => chosen.id !== clip.id));
      setError("");
    },
    [entryId, onChange, value],
  );

  const chosenIds = new Set(value.map((clip) => clip.id));

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">Clips</span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setWriting((open) => !open);
              setPicking(false);
            }}
          >
            {writing ? "Cancel" : "+ New clip"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setPicking((open) => !open);
              setWriting(false);
            }}
          >
            {picking ? "Done" : "+ Clip"}
          </Button>
        </div>
      </div>

      <p className="mb-2 text-xs text-muted">
        Supporting material for this entry — a pasted email, a reference. A clip is kept
        on its own and is not deleted with the entry.
        {/* Only while writing a new entry, where the picks really are pending. On
            an existing entry they are linked as they are made, so promising
            anything about Save would be wrong — and the edit's Cancel does not
            undo them. */}
        {entryId === undefined && value.length > 0 && " Attached when you save."}
        {entryId !== undefined && " Changes here take effect immediately."}
      </p>

      {error && <p className="mb-2 text-sm text-danger">{error}</p>}

      {value.length === 0 ? (
        <p className="text-sm text-muted">No clips.</p>
      ) : (
        <ul className="space-y-1">
          {value.map((clip) => (
            <li
              key={clip.id}
              className="flex items-center justify-between gap-2 rounded border border-line px-2 py-1.5"
            >
              <button
                type="button"
                onClick={() => setViewing(clip.id)}
                className="min-w-0 flex-1 text-left text-sm text-ink hover:text-brass-dark"
              >
                <span className="inline-flex items-center gap-1.5">
                  {clip.isEncrypted && <TreeIcon name="lock" className="h-3.5 w-3.5 text-muted" />}
                  {clip.title || "(untitled)"}
                </span>
              </button>
              <button
                type="button"
                // Takes it off this entry — the clip itself is never deleted. On
                // an existing entry this detaches the link now; on a new one it
                // just drops it from the pending list, where no link exists yet.
                onClick={() => void remove(clip)}
                className="shrink-0 text-xs text-muted hover:text-danger"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {writing && (
        <div className="mt-2 rounded-md border border-line p-3">
          <ClipsEditor
            categoryOptions={categoryOptions}
            tagOptions={tagOptions}
            onSavedClip={(clip) => {
              // Straight onto the entry: writing a clip from here means "this
              // belongs with what I am writing", so making the reader then find it
              // in a picker would be a step that earns nothing.
              //
              // Through `add`, not `onChange`, so that on an existing entry the
              // link is actually written — `onChange` alone would show the clip
              // attached while nothing linked it.
              void add(clip);
              setWriting(false);
            }}
            onCancel={() => setWriting(false)}
          />
        </div>
      )}

      {picking && (
        <div className="mt-2 space-y-2">
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search clips, or pick a recent one"
            className={INPUT_CLASS}
          />

          {results.length === 0 ? (
            <p className="text-sm text-muted">No clips match.</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {results.map((clip) => {
                const already = chosenIds.has(clip.id);
                return (
                  <li key={clip.id}>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => void add(clip)}
                      className="w-full rounded border border-line px-2 py-1.5 text-left text-sm text-ink hover:border-brass disabled:opacity-50 disabled:hover:border-line"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {clip.isEncrypted && (
                          <TreeIcon name="lock" className="h-3.5 w-3.5 text-muted" />
                        )}
                        {clip.title || "(untitled)"}
                      </span>
                      {already && <span className="ml-1 text-xs text-muted">— added</span>}
                      {clip.excerpt && (
                        <span className="mt-0.5 block text-xs text-muted">{clip.excerpt}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {viewing !== undefined && (
        <ClipsViewer clipId={viewing} onClose={() => setViewing(undefined)} />
      )}
    </div>
  );
}
