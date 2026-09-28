"use client";

// The dialog behind My Shortcuts' Add and Edit buttons.
//
// Reusable rather than route-local because it is a *destination picker* — icon,
// name and target — and nothing about it knows it is serving the home screen.
// Registered in components.md.
//
// Props in, events out: it raises the finished draft and never saves anything
// itself. The tree it browses arrives as a prop, already filtered to what the
// reader may see, so this component makes no access decisions either.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { TREE_ICON_NAMES } from "@/lib/icons";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/shared/image-upload";
import { MAX_SHORTCUT_ICON_BYTES, type ShortcutDraftInput, type ShortcutKind } from "@/lib/user-shortcuts";
import { Button } from "./button";
import { Modal } from "./modal";
import { TreeIcon } from "./tree-icons";

/**
 * One module the picker can browse into — a narrowing of `TreeModule`.
 *
 * No `icon`, deliberately: the module list is a native `<select>`, and an
 * `<option>` cannot render one. Carrying the field would be a prop that quietly
 * does nothing. (This is the same limitation `IconSelect` exists to work around;
 * it isn't worth a combobox here, where the labels are distinct words.)
 */
export interface ShortcutPickerModule {
  slug: string;
  name: string;
  sections: { id: string; label: string }[];
}

/**
 * What the dialog wants done with the shortcut's picture.
 *
 * Three states, not a nullable file: "upload this" and "remove what's there"
 * are different instructions, and "leave it alone" has to be distinguishable
 * from both or every edit of a name would drop the icon.
 */
export type ShortcutIconIntent =
  | { action: "keep" }
  | { action: "upload"; file: File }
  | { action: "clear" };

export interface ShortcutPickerProps {
  /** Heading — "Add a shortcut" or "Edit shortcut". */
  title: string;
  /**
   * The modules to browse, already filtered to this reader.
   *
   * The picker deliberately cannot widen this: offering a module the reader
   * can't open would let them save a shortcut that is unreachable the moment
   * it is created.
   */
  modules: ShortcutPickerModule[];
  /**
   * Pre-filled fields when editing. Omit to start blank.
   *
   * `iconImageUrl` shows the picture this shortcut already has, so the reader
   * can see what they're replacing. It is display-only — the dialog never
   * re-uploads it, it only reports whether it was removed.
   */
  initial?: Partial<ShortcutDraftInput> & { iconImageUrl?: string };
  /** An error from the last save attempt, shown above the buttons. */
  error?: string;
  /** Disables the footer while a save is in flight. */
  saving?: boolean;
  /**
   * Raised with the finished draft and what to do about its icon.
   *
   * The icon travels beside the draft rather than inside it because it is a
   * *separate write*: the shortcut row has to exist before a picture can be
   * stored against it, and clearing one is its own call. The dialog reports
   * intent — here is a new file / drop the existing one / neither — and the
   * parent sequences the writes.
   */
  onSave: (draft: ShortcutDraftInput, icon: ShortcutIconIntent) => void;
  onClose: () => void;
}

/** The glyphs a reader may choose from — every concept `TreeIcon` can draw. */
const ICON_CHOICES = TREE_ICON_NAMES;

/**
 * The file picker's filter, from the shared allowlist so the two can't drift.
 *
 * Note SVG is absent, and that is deliberate upstream: it can carry script and
 * these bytes are served from the app's own origin. The `accept` attribute is a
 * convenience, never the enforcement — `decodeImageUpload` is.
 */
const ACCEPTED_IMAGE_TYPES = IMAGE_UPLOAD_MIME_TYPES.join(",");

const FIELD =
  "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink " +
  "outline-none focus:border-brass";

const LABEL = "block text-xs font-medium uppercase tracking-wide text-muted";

export function ShortcutPicker({
  title,
  modules,
  initial,
  error,
  saving = false,
  onSave,
  onClose,
}: ShortcutPickerProps) {
  const [kind, setKind] = useState<ShortcutKind>(initial?.kind ?? "url");
  const [name, setName] = useState(initial?.name ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "rocket");
  const [url, setUrl] = useState(
    initial && initial.kind === "url" ? (initial.url ?? "") : "",
  );
  const [moduleSlug, setModuleSlug] = useState(
    initial && initial.kind === "section" ? (initial.moduleSlug ?? "") : "",
  );
  const [sectionId, setSectionId] = useState(
    initial && initial.kind === "section" ? (initial.sectionId ?? "") : "",
  );

  // The picture the reader just chose, not yet uploaded — the dialog saves the
  // shortcut first and posts the file against the row that comes back.
  const [file, setFile] = useState<File | undefined>(undefined);
  // An object URL for the chosen file, so the reader sees it before saving.
  const [filePreview, setFilePreview] = useState<string | undefined>(undefined);
  // Set when editing a shortcut that already has an upload, and cleared by
  // "Remove picture" — which is how the dialog tells the caller to drop it.
  const [existingIcon, setExistingIcon] = useState(initial?.iconImageUrl);
  const [fileError, setFileError] = useState<string | undefined>(undefined);

  const preview = filePreview ?? existingIcon;

  // An object URL is a leak if it outlives the dialog — the browser will not
  // collect one on its own. The cleanup runs both when the preview is replaced
  // and when the dialog unmounts, which covers every way one goes away.
  // (`dropUpload` revokes eagerly as well so the bytes are released on the
  // click rather than on the next render; revoking twice is a no-op.)
  useEffect(() => {
    if (!filePreview) return;
    return () => URL.revokeObjectURL(filePreview);
  }, [filePreview]);

  /**
   * Takes the chosen file, checking the size here as well as on the server.
   *
   * Client-side too because `coding-guide.md` says so and the reason is good:
   * an oversized file otherwise travels all the way to a 500 instead of being
   * refused instantly in the app's own wording.
   */
  function chooseFile(chosen: File | undefined) {
    if (!chosen) return;
    if (chosen.size > MAX_SHORTCUT_ICON_BYTES) {
      setFileError(
        `That picture is too large — keep it under ${Math.round(
          MAX_SHORTCUT_ICON_BYTES / 1024,
        )} KB.`,
      );
      return;
    }
    setFileError(undefined);
    setFile(chosen);
    setFilePreview(URL.createObjectURL(chosen));
  }

  /** Drops both a newly chosen picture and one already stored. */
  function dropUpload() {
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFile(undefined);
    setFilePreview(undefined);
    setExistingIcon(undefined);
    setFileError(undefined);
  }

  const selectedModule = useMemo(
    () => modules.find((candidate) => candidate.slug === moduleSlug),
    [modules, moduleSlug],
  );

  /**
   * Choosing a module clears the section.
   *
   * Without this, switching from Journal to Music would keep `photos`
   * selected — a section id that means nothing in the new module, and which
   * would save as an unreachable shortcut.
   */
  function chooseModule(slug: string) {
    setModuleSlug(slug);
    setSectionId("");
    // Only fill a name the reader hasn't written themselves: their own wording
    // is the point, and overwriting "Holiday pics" on a module change would be
    // the picker undoing their work.
    const chosen = modules.find((candidate) => candidate.slug === slug);
    if (chosen && name.trim() === "") setName(chosen.name);
  }

  function submit() {
    // A new file wins. Otherwise, "clear" only when there *was* a picture and
    // the reader removed it — an add with no upload is "keep", which is a no-op
    // rather than a pointless clear against a row that has nothing.
    const iconIntent: ShortcutIconIntent = file
      ? { action: "upload", file }
      : initial?.iconImageUrl && !existingIcon
        ? { action: "clear" }
        : { action: "keep" };

    onSave(
      kind === "url"
        ? { kind: "url", name, icon, url }
        : { kind: "section", name, icon, moduleSlug, sectionId },
      iconIntent,
    );
  }

  // The dialog's own guard, so an obviously incomplete form can't be submitted.
  // It is not the validation — that lives in the zod schema the action calls,
  // and this deliberately does not restate the URL rules.
  const canSave =
    name.trim() !== "" && (kind === "url" ? url.trim() !== "" : moduleSlug !== "");

  return (
    <Modal
      title={title}
      onClose={onClose}
      size="md"
      // Suppresses Escape and the overlay click while a save is in flight, so a
      // half-finished write can't be orphaned by a stray click.
      isBusy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSave || saving}>
            {saving ? "Saving…" : "Save shortcut"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Where does it go?">
          {/* A segmented pair rather than a dropdown: there are exactly two, and
              which one is chosen changes the fields below — worth showing both. */}
          <div className="flex gap-2">
            <KindTab active={kind === "url"} onClick={() => setKind("url")}>
              A web address
            </KindTab>
            <KindTab active={kind === "section"} onClick={() => setKind("section")}>
              A page in this app
            </KindTab>
          </div>
        </Field>

        {kind === "url" ? (
          <Field label="Web address">
            <input
              className={FIELD}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="example.com"
              inputMode="url"
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-muted">
              http:// or https:// only. Typing a bare address adds https:// for you.
            </p>
          </Field>
        ) : (
          <>
            <Field label="Module">
              {/* A native select, not a second tree. The tree's own component is a
                  navigation surface with its own filter and expansion state; reusing
                  it inside a dialog to pick a value would be the wrong shape. Two
                  short lists read faster here anyway. */}
              <select
                className={FIELD}
                value={moduleSlug}
                onChange={(event) => chooseModule(event.target.value)}
              >
                <option value="">Choose a module…</option>
                {modules.map((appModule) => (
                  <option key={appModule.slug} value={appModule.slug}>
                    {appModule.name}
                  </option>
                ))}
              </select>
            </Field>

            {selectedModule && (
              <Field label="Page">
                <select
                  className={FIELD}
                  value={sectionId}
                  onChange={(event) => setSectionId(event.target.value)}
                >
                  {/* The module root is the empty value, which is exactly how it
                      is stored — see the migration log on why there is no
                      separate "module" kind. */}
                  <option value="">{selectedModule.name} — main page</option>
                  {selectedModule.sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </>
        )}

        <Field label="Name">
          <input
            className={FIELD}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="What the tile should read"
            maxLength={40}
          />
        </Field>

        <Field label="Icon">
          {/* Upload or glyph, and the upload wins — the same either/or the
              destination above uses, so the dialog asks its two questions the
              same way twice. The glyph stays chosen underneath a picture
              because it is what the tile falls back to if the picture is
              removed, which is why this is one field and not two. */}
          <div className="mb-2 flex items-center gap-3">
            {preview ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- a blob:
                    URL or a session-scoped API route, neither of which the image
                    optimizer can fetch. */}
                <img
                  src={preview}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-md border border-line object-contain"
                />
                <Button size="sm" variant="secondary" onClick={dropUpload}>
                  Remove picture
                </Button>
                <span className="text-xs text-muted">Using your picture.</span>
              </>
            ) : (
              <>
                <label
                  className="cursor-pointer rounded-lg border border-line bg-paper-raised px-3
                             py-1.5 text-xs font-semibold text-ink hover:bg-brass-soft"
                >
                  Upload a picture
                  <input
                    type="file"
                    className="sr-only"
                    accept={ACCEPTED_IMAGE_TYPES}
                    onChange={(event) => chooseFile(event.target.files?.[0])}
                  />
                </label>
                <span className="text-xs text-muted">
                  PNG, JPEG, WebP or GIF, up to {Math.round(MAX_SHORTCUT_ICON_BYTES / 1024)} KB —
                  or pick a glyph below.
                </span>
              </>
            )}
          </div>

          <div
            className={`grid max-h-44 grid-cols-8 gap-1 overflow-y-auto rounded-lg border
                       border-line p-2 max-lg:grid-cols-6 ${preview ? "opacity-50" : ""}`}
          >
            {ICON_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => setIcon(choice)}
                title={choice}
                aria-label={choice}
                aria-pressed={icon === choice}
                className={`flex aspect-square items-center justify-center rounded-md border transition-colors ${
                  icon === choice
                    ? "border-brass bg-brass-soft text-brass-dark"
                    : "border-transparent text-muted hover:bg-paper-raised"
                }`}
              >
                <TreeIcon name={choice} className="h-5 w-5" />
              </button>
            ))}
          </div>
        </Field>

        {/* The client-side file rejection and the server's error share one slot
            — only one can be outstanding at a time, and the file one is shown
            first because it is the more recent thing the reader did. */}
        {(fileError || error) && (
          <p role="alert" className="text-sm text-red-400">
            {fileError ?? error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function KindTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
        active
          ? "border-brass bg-brass-soft font-medium text-brass-dark"
          : "border-line text-muted hover:bg-paper-raised"
      }`}
    >
      {children}
    </button>
  );
}
