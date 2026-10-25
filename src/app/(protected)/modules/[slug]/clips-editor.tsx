"use client";

// The write-a-clip panel: title, body, categories and tags.
//
// Route-local presentation, not a shared component — the editor *control* is shared
// (`@/components/rich-text-editor`), and this is the Clips-specific form around it.
//
// ## Where the sanitising happens
//
// The editor raises `onSanitize` for a pasted fragment and this component answers it
// with `sanitizeClipHtml` — the **same function the use-case runs** before storing.
// That is deliberate: a different cleanup in the browser would mean what the reader
// sees after pasting and what is saved could disagree. The server runs it again on
// save regardless, because a client-side pass is a convenience and never a control.

import { useState } from "react";
import { Button } from "@/components/button";
import { RichTextEditor } from "@/components/rich-text-editor";
import { TokenPicker } from "@/components/token-picker";
import { sanitizeClipHtml, toClipSummary, type ClipSummary } from "@/lib/clips";
import { addClipImageAction, createClipAction, updateClipAction } from "./clips-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export interface ClipsEditorProps {
  /** Editing an existing clip, or undefined when writing a new one. */
  clipId?: number;
  initialTitle?: string;
  initialContentHtml?: string;
  initialCategories?: string[];
  initialTags?: string[];
  /** The managed lists, so the pickers offer what already exists. */
  categoryOptions: string[];
  tagOptions: string[];
  onSaved?: () => void;
  /**
   * Raised with the saved clip, for a caller that needs the row itself rather
   * than just "it saved" — the entry form's "+ New clip" adds it straight onto
   * the entry. Fires alongside `onSaved`, not instead of it.
   */
  onSavedClip?: (clip: ClipSummary) => void;
  onCancel?: () => void;
}

export function ClipsEditor({
  clipId,
  initialTitle = "",
  initialContentHtml = "",
  initialCategories = [],
  initialTags = [],
  categoryOptions,
  tagOptions,
  onSaved,
  onSavedClip,
  onCancel,
}: ClipsEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [contentHtml, setContentHtml] = useState(initialContentHtml);
  const [categories, setCategories] = useState<string[]>(initialCategories);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<string[]>([]);
  // Set when a paste forced an early save (an image needs a clip to belong to), so
  // the next save updates that row rather than creating a second clip.
  const [savedId, setSavedId] = useState<number | undefined>(undefined);

  /**
   * Stores each pasted image and hands back its URL for the editor to insert.
   *
   * Needs a clip to attach to, so a brand-new clip is saved first — otherwise there
   * is no row to own the image. That save is silent: the reader pasted a screenshot,
   * they did not ask to save, so the only visible effect is the image appearing.
   */
  async function handlePasteImages(files: File[]): Promise<string[]> {
    let targetId = clipId ?? savedId;

    if (targetId === undefined) {
      const created = await createClipAction({ title, contentHtml, categories, tags });
      if (!created.ok || !created.clip) {
        setError(created.error ?? "Could not save that image.");
        return [];
      }
      targetId = created.clip.id;
      setSavedId(targetId);
    }

    const urls: string[] = [];
    for (const file of files) {
      const base64Data = await fileToBase64(file);
      const result = await addClipImageAction(targetId, { mimeType: file.type as never, base64Data });
      // A refused image is reported and skipped rather than failing the whole
      // paste: the text alongside it is usually the part worth keeping.
      if (result.ok && result.url) urls.push(result.url);
      else setError(result.error ?? "One image could not be saved.");
    }
    return urls;
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    setNotice([]);

    const id = clipId ?? savedId;
    const result = id
      ? await updateClipAction({ id, title, contentHtml, categories, tags })
      : await createClipAction({ title, contentHtml, categories, tags });

    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save that clip.");
      return;
    }

    // What the server's sanitiser removed, which can differ from the browser's pass
    // if the markup changed in between. Reported rather than silent.
    if (result.removed && result.removed.length > 0) setNotice(result.removed);
    if (result.clip && id === undefined) setSavedId(result.clip.id);
    // Built here rather than re-fetched: `toClipSummary` is the same pure
    // projection the list uses, so a caller gets exactly the row it would have
    // seen under All Clips. Image and link counts are 0 — correct for a clip
    // this save just created, and stale only for an edit, which is why the
    // entry form only uses this on a new one.
    if (result.clip && onSavedClip) onSavedClip(toClipSummary(result.clip, 0, 0));
    onSaved?.();
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="clip-title" className="mb-1 block text-sm font-medium text-ink">
          Title
        </label>
        <input
          id="clip-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Optional"
          className={INPUT_CLASS}
        />
      </div>

      <RichTextEditor
        value={contentHtml}
        onChange={setContentHtml}
        onPasteImages={handlePasteImages}
        onSanitize={(html) => sanitizeClipHtml(html).html}
        placeholder="Write, or paste an email here…"
      />

      {/* Two pickers, two vocabularies: a category says what KIND of thing this is,
          a tag says what it is ABOUT. Both create inline, so writing a clip never
          has to leave the screen to add a name. */}
      <div className="grid gap-3 lg:grid-cols-2">
        <TokenPicker
          label="Categories"
          value={categories}
          onChange={setCategories}
          options={categoryOptions}
          allowCreate
          createPlaceholder="Add a category…"
          hint="What kind of thing this is."
        />
        <TokenPicker
          label="Tags"
          value={tags}
          onChange={setTags}
          options={tagOptions}
          allowCreate
          createPlaceholder="Add a tag…"
          hint="What it is about."
        />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {notice.length > 0 && (
        <div className="rounded-md border border-line bg-paper-raised p-3 text-sm text-muted">
          <p className="font-medium text-ink">Some of the pasted formatting was removed:</p>
          <ul className="mt-1 list-disc pl-5">
            {notice.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save clip"}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * A pasted file as base64, without the `data:…;base64,` prefix.
 *
 * `FileReader` rather than `arrayBuffer()` + manual encoding: the latter needs a
 * byte-to-binary-string loop that blows the call stack on a multi-megabyte image.
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That image could not be read."));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}
