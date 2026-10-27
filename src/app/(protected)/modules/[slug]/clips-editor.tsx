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
import {
  sanitizeClipHtml,
  toClipSummary,
  type ClipCardColor,
  type ClipItem,
  type ClipSummary,
} from "@/lib/clips";
import { ClipsColorPicker } from "./clips-color-picker";
import {
  addClipImageAction,
  createClipAction,
  saveClipItemsAction,
  updateClipAction,
} from "./clips-actions";

/** One line in the checklist editor, before it has been saved. */
interface DraftItem {
  /** Absent for a line the reader just typed; present when it already exists. */
  id?: number;
  text: string;
  isDone: boolean;
}

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export interface ClipsEditorProps {
  /** Editing an existing clip, or undefined when writing a new one. */
  clipId?: number;
  initialTitle?: string;
  initialContentHtml?: string;
  initialCategories?: string[];
  initialTags?: string[];
  /** The card tint. A `CLIP_CARD_COLORS` key, or `""` for the default surface. */
  initialColor?: ClipCardColor | "";
  /** The clip's existing checklist, when editing one that has items. */
  initialItems?: ClipItem[];
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
  initialColor = "",
  initialItems = [],
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
  // Typed as the union rather than `string`, so an unknown key cannot reach the
  // action: the picker only ever hands back one of these.
  const [color, setColor] = useState<ClipCardColor | "">(initialColor);
  const [items, setItems] = useState<DraftItem[]>(
    initialItems.map((item) => ({ id: item.id, text: item.text, isDone: item.isDone })),
  );
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
      const created = await createClipAction({ title, contentHtml, categories, tags, color });
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
      ? await updateClipAction({ id, title, contentHtml, categories, tags, color })
      : await createClipAction({ title, contentHtml, categories, tags, color });

    if (!result.ok) {
      setSaving(false);
      setError(result.error ?? "Could not save that clip.");
      return;
    }

    // The checklist is a second write, because items are their own rows — see
    // `ClipItem` for why they are not markup in the body. It goes after the clip's
    // own save so a brand-new clip has an id to hang them on.
    //
    // Blank lines are dropped here rather than refused: a reader who left an empty
    // row at the bottom of the editor meant nothing by it, and an error message
    // about it would be noise.
    const savedClipId = id ?? result.clip?.id;
    const kept = items.filter((item) => item.text.trim() !== "");

    // The second clause is what makes *clearing* a checklist work: with no items
    // left there is nothing to write, but the stored rows still have to be removed.
    // It tests the editor's own list rather than `initialItems`, which never changes
    // and so would stop being true of a clip whose items were added this session.
    const hadItems = items.length > 0 || initialItems.length > 0;

    if (savedClipId !== undefined && (kept.length > 0 || hadItems)) {
      const itemResult = await saveClipItemsAction(savedClipId, kept);
      if (!itemResult.ok) {
        setSaving(false);
        setError(itemResult.error ?? "The clip saved, but its checklist did not.");
        return;
      }

      // Adopt the stored rows, so lines that were new now carry their ids. Without
      // this, a reader who saves twice without closing the panel would send those
      // lines as new again and get duplicates — the clip's own id is remembered in
      // `savedId` for exactly the same reason.
      if (itemResult.items) {
        setItems(
          itemResult.items.map((item) => ({
            id: item.id,
            text: item.text,
            isDone: item.isDone,
          })),
        );
      }
    }

    setSaving(false);

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

      <ClipItemsEditor items={items} onChange={setItems} />

      <div>
        <p className="mb-1 text-sm font-medium text-ink">Card colour</p>
        <ClipsColorPicker value={color} onChange={setColor} />
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
 * The checklist editor: a line per item, plus a blank one to type into.
 *
 * Deliberately plain — text inputs and a tick, no drag handles. Order is the order
 * of the rows, and a reader who wants to move a line retypes it; adding a drag
 * library to a feature whose lists are usually under ten items would be gold-plating
 * the simple version.
 *
 * The trailing blank row is what makes it feel like a list rather than a form: typing
 * in it adds a real item and a fresh blank row appears beneath.
 */
function ClipItemsEditor({
  items,
  onChange,
}: {
  items: DraftItem[];
  onChange: (items: DraftItem[]) => void;
}) {
  function update(index: number, patch: Partial<DraftItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  return (
    <div>
      <p className="mb-1 text-sm font-medium text-ink">Checklist</p>
      <p className="mb-2 text-xs text-muted">
        Optional. Tickable lines that live beside the body, not inside it.
      </p>

      <ul className="space-y-1">
        {items.map((item, index) => (
          // Keyed by stored id where there is one, by position otherwise. A new line
          // has no id until it is saved, and keying every row by index would be worse:
          // removing a row would make React reuse the wrong input's state.
          <li key={item.id ?? `new-${index}`} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={item.isDone}
              onChange={(event) => update(index, { isDone: event.target.checked })}
              aria-label={`Mark "${item.text || "this item"}" as done`}
              className="h-4 w-4 shrink-0 accent-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
            />
            <input
              value={item.text}
              onChange={(event) => update(index, { text: event.target.value })}
              aria-label="Item text"
              className={`${INPUT_CLASS} ${item.isDone ? "line-through" : ""}`}
            />
            <button
              type="button"
              onClick={() => remove(index)}
              aria-label="Remove this item"
              title="Remove this item"
              className="shrink-0 rounded-md px-2 py-1 text-xs text-muted hover:text-red-400"
            >
              ✕
            </button>
          </li>
        ))}

        <NewItemRow onAdd={(text) => onChange([...items, { text, isDone: false }])} />
      </ul>
    </div>
  );
}

/**
 * The trailing blank row: type a line, press Enter, and it joins the list.
 *
 * It holds its own text rather than pushing every keystroke into the parent's array.
 * The obvious version — a controlled input bound to `""` that appends on change —
 * re-renders this row back to empty on the first character and the field loses
 * focus, so the reader types one letter per click. Committing on Enter (or on blur,
 * so a typed line is not silently lost when they tab away) keeps the caret where it
 * is and makes "add an item" one deliberate action.
 */
function NewItemRow({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState("");

  function commit() {
    if (text.trim() === "") return;
    onAdd(text.trim());
    setText("");
  }

  return (
    <li className="flex items-center gap-2">
      {/* A spacer the width of the checkbox above, so the blank row's input lines up
          with the real ones rather than sitting a box to the left. */}
      <span aria-hidden className="h-4 w-4 shrink-0" />
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // The editor sits inside a panel with a Save button; without this an
            // Enter meant for "add this line" would submit the surrounding form.
            event.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        placeholder="Add an item…"
        aria-label="Add a checklist item"
        className={INPUT_CLASS}
      />
      <span aria-hidden className="w-7 shrink-0" />
    </li>
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
