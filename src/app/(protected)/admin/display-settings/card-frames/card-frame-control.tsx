"use client";

// The Card Frames gallery, uploader and slice editor.
//
// Deliberately mirrors `dashboard-texture-control.tsx`: one hidden file input
// driven by a ref-held intent, a grid of thumbnails served from the API route,
// click-to-rename, and a tuning panel bound to its own `editingId` rather than
// to the selection. An admin who has used that screen already knows this one.
//
// What is different here is the slice editor, because a frame has four numbers
// a texture does not -- and they cannot be guessed from the picture. The live
// preview is therefore not a nicety: it is the only way to tell whether 24 is
// the right number for this artwork.

import { useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/button";
import { CustomizableCard } from "@/components/customizable-card";
import {
  MAX_CARD_FRAMES,
  MAX_CARD_FRAME_BYTES,
  MAX_CARD_FRAME_SLICE,
  type CardFrame,
  type CardFrameFill,
  type CardFrameSettings,
} from "@/lib/card-frame";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/shared/image-upload";
import {
  addCardFrameAction,
  deleteCardFrameAction,
  renameCardFrameAction,
  replaceCardFrameImageAction,
  saveCardFrameSettingsAction,
  selectCardFrameAction,
} from "../../actions";

const MAX_MB = Math.round(MAX_CARD_FRAME_BYTES / 1024 / 1024);

/** What the pending file pick is for — add a new frame, or replace one's bytes. */
type PickerIntent = { kind: "add" } | { kind: "replace"; id: number };

const FILL_MODES: { value: CardFrameFill; label: string; hint: string }[] = [
  { value: "stretch", label: "Stretch", hint: "One copy, scaled. Right for a gradient." },
  { value: "repeat", label: "Repeat", hint: "Tiles at natural size. Right for fine grain." },
  { value: "round", label: "Round", hint: "Tiles, scaled to fit whole. Right for a rope." },
];

/** A new upload's starting slices — visible without being large. */
const DEFAULT_SETTINGS: CardFrameSettings = {
  insets: { top: 24, right: 24, bottom: 24, left: 24 },
  fillOpacity: 1,
  fill: "stretch",
  centerFill: true,
};

export function CardFrameControl({
  frames,
  selectedId,
}: {
  frames: CardFrame[];
  selectedId?: number;
}) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number>();
  const [draft, setDraft] = useState<CardFrameSettings>(DEFAULT_SETTINGS);
  const [renamingId, setRenamingId] = useState<number>();
  // Bumped after every upload so the `?v=` cache-buster changes and a replaced
  // picture appears immediately rather than after the route's max-age expires.
  const [version, setVersion] = useState(() => Date.now());

  const fileInput = useRef<HTMLInputElement>(null);
  const intent = useRef<PickerIntent>({ kind: "add" });

  const editing = frames.find((f) => f.id === editingId);
  const imageUrl = (id: number) => `/api/card-frame?id=${id}&v=${encodeURIComponent(version)}`;

  function openPicker(next: PickerIntent) {
    intent.current = next;
    fileInput.current?.click();
  }

  async function onFilePicked(file: File | undefined) {
    // Always clear, so re-picking the same file still fires `change`.
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;

    // Redundant with the server's own cap, but it turns a failed round-trip
    // into an immediate, specific message.
    if (file.size > MAX_CARD_FRAME_BYTES) {
      setError(
        `That picture is ${(file.size / 1024 / 1024).toFixed(1)} MB — keep it under ${MAX_MB} MB.`,
      );
      return;
    }

    setError(undefined);
    setBusy(true);
    const body = new FormData();
    body.set("image", file);

    const result =
      intent.current.kind === "add"
        ? await (() => {
            // A new frame carries its starting slices in the same request: a
            // frame with no slices draws nothing, so an upload that left them
            // unset would land in the gallery as an invisible tile.
            body.set("name", nextFrameName(frames));
            body.set("sliceTop", String(DEFAULT_SETTINGS.insets.top));
            body.set("sliceRight", String(DEFAULT_SETTINGS.insets.right));
            body.set("sliceBottom", String(DEFAULT_SETTINGS.insets.bottom));
            body.set("sliceLeft", String(DEFAULT_SETTINGS.insets.left));
            body.set("fillOpacity", String(DEFAULT_SETTINGS.fillOpacity));
            body.set("fill", DEFAULT_SETTINGS.fill);
            body.set("centerFill", DEFAULT_SETTINGS.centerFill ? "1" : "0");
            return addCardFrameAction(body);
          })()
        : await replaceCardFrameImageAction(intent.current.id, body);

    setBusy(false);
    setVersion(Date.now());
    if (!result.ok) setError(result.error);
  }

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(undefined);
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok) setError(result.error);
  }

  function startEditing(frame: CardFrame) {
    setEditingId(frame.id);
    setDraft({
      insets: { ...frame.insets },
      fillOpacity: frame.fillOpacity,
      fill: frame.fill,
      centerFill: frame.centerFill,
    });
  }

  function setInset(edge: keyof CardFrameSettings["insets"], value: number) {
    setDraft((d) => ({ ...d, insets: { ...d.insets, [edge]: value } }));
  }

  return (
    <div className="mt-8 space-y-6">
      {/* One input for both intents, kept out of the layout. */}
      <input
        ref={fileInput}
        type="file"
        accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
        className="hidden"
        onChange={(event) => void onFilePicked(event.target.files?.[0])}
      />

      {error && (
        <p className="rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* The gallery. A tile is the picture itself, so no icon slot applies. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {frames.map((frame) => {
          const isSelected = frame.id === selectedId;
          return (
            <div
              key={frame.id}
              className={`rounded-xl border p-2 ${
                isSelected ? "border-brass bg-brass-soft/30" : "border-line bg-paper-raised"
              }`}
            >
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() => selectCardFrameAction(isSelected ? undefined : frame.id))
                }
                title={isSelected ? "Stop using this frame" : "Use this frame on every card"}
                className="block w-full overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- DB-backed
                    route, not a static asset next/image can optimize. */}
                <img
                  src={imageUrl(frame.id)}
                  alt={frame.name}
                  className="h-24 w-full bg-paper object-contain"
                />
              </button>

              {renamingId === frame.id ? (
                <input
                  autoFocus
                  defaultValue={frame.name}
                  disabled={busy}
                  onBlur={(event) => {
                    setRenamingId(undefined);
                    const name = event.target.value.trim();
                    if (name && name !== frame.name) {
                      void run(() => renameCardFrameAction(frame.id, name));
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      event.currentTarget.value = frame.name;
                      event.currentTarget.blur();
                    }
                  }}
                  className="mt-2 w-full rounded border border-line bg-paper px-2 py-1 text-xs text-ink"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setRenamingId(frame.id)}
                  className="mt-2 block w-full truncate text-left text-xs text-ink hover:underline"
                  title="Rename"
                >
                  {frame.name}
                </button>
              )}

              <p className="mt-1 text-[11px] text-muted">
                {frame.insets.top} {frame.insets.right} {frame.insets.bottom} {frame.insets.left}
                {isSelected && <span className="ml-1 text-brass-dark">· in use</span>}
              </p>

              <div className="mt-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => startEditing(frame)}
                  className="text-xs text-brass-dark hover:underline"
                >
                  Slices
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openPicker({ kind: "replace", id: frame.id })}
                  className="text-xs text-brass-dark hover:underline"
                >
                  Replace
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => deleteCardFrameAction(frame.id))}
                  className="text-xs text-red-400 hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}

        {frames.length < MAX_CARD_FRAMES && (
          <button
            type="button"
            disabled={busy}
            onClick={() => openPicker({ kind: "add" })}
            className="flex h-full min-h-[8rem] items-center justify-center rounded-xl border border-dashed border-line text-sm text-muted hover:border-brass hover:text-brass-dark"
          >
            + Add picture
          </button>
        )}
      </div>

      {frames.length === 0 && (
        <p className="text-sm text-muted">
          No frames yet. Add a picture whose edges are the border you want — a PNG with
          transparency works best, since the middle shows through as the card&apos;s
          background.
        </p>
      )}

      {editing && (
        <SliceEditor
          frame={editing}
          draft={draft}
          busy={busy}
          imageUrl={imageUrl(editing.id)}
          onChangeInset={setInset}
          onChangeDraft={setDraft}
          onClose={() => setEditingId(undefined)}
          onSave={() => void run(() => saveCardFrameSettingsAction(editing.id, draft))}
        />
      )}
    </div>
  );
}

/**
 * The slice editor and its live preview.
 *
 * The preview renders a **real `CustomizableCard`** inside a wrapper carrying
 * the same `--card-frame-*` variables the layout publishes, rather than a
 * hand-drawn mock. A mock would be a second implementation of the frame CSS and
 * would drift from the real one, which is exactly the trap `components.md`
 * warns about for restyles.
 */
function SliceEditor({
  frame,
  draft,
  busy,
  imageUrl,
  onChangeInset,
  onChangeDraft,
  onClose,
  onSave,
}: {
  frame: CardFrame;
  draft: CardFrameSettings;
  busy: boolean;
  imageUrl: string;
  onChangeInset: (edge: keyof CardFrameSettings["insets"], value: number) => void;
  onChangeDraft: (next: CardFrameSettings) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const url = `url("${imageUrl}")`;
  const { top, right, bottom, left } = draft.insets;

  // The same variables `cardFrameVars` builds, so the preview and the live
  // application cannot render differently. Built here rather than imported
  // because the draft is not saved yet and has no `updatedAt` to bust with.
  const previewVars = {
    "--card-frame-image": url,
    "--card-frame-slice": `${top} ${right} ${bottom} ${left}`,
    "--card-frame-width": `${top}px ${right}px ${bottom}px ${left}px`,
    "--card-frame-repeat": draft.fill,
    "--card-frame-fill-opacity": String(draft.fillOpacity),
  } as CSSProperties;

  return (
    <div className="rounded-xl border border-line bg-paper-raised p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-ink">{frame.name}</h2>
        <button type="button" onClick={onClose} className="text-xs text-brass-dark hover:underline">
          Close
        </button>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-ink">Slices</p>
            <p className="mt-1 text-xs text-muted">
              How far in from each edge of the picture the border artwork runs, in the
              picture&apos;s own pixels. These become the card&apos;s border widths.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(["top", "right", "bottom", "left"] as const).map((edge) => (
                <label key={edge} className="block">
                  <span className="text-xs capitalize text-muted">{edge}</span>
                  <input
                    type="number"
                    min={0}
                    max={MAX_CARD_FRAME_SLICE}
                    value={draft.insets[edge]}
                    disabled={busy}
                    onChange={(event) => onChangeInset(edge, Number(event.target.value))}
                    className="mt-1 w-full rounded border border-line bg-paper px-2 py-1 text-sm text-ink"
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-ink">Edges</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {FILL_MODES.map((mode) => (
                <Button
                  key={mode.value}
                  size="sm"
                  variant={draft.fill === mode.value ? "primary" : "secondary"}
                  disabled={busy}
                  title={mode.hint}
                  onClick={() => onChangeDraft({ ...draft, fill: mode.value })}
                >
                  {mode.label}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={draft.centerFill}
                disabled={busy}
                onChange={(event) =>
                  onChangeDraft({ ...draft, centerFill: event.target.checked })
                }
              />
              Paint the picture&apos;s middle as the card background
            </label>
            <p className="mt-1 text-xs text-muted">
              Off uses the picture as a border only, leaving the theme&apos;s own card
              colour showing through.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink">
              Frame opacity
              <span className="ml-2 font-mono text-xs text-muted">
                {draft.fillOpacity.toFixed(2)}
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={draft.fillOpacity}
              disabled={busy}
              onChange={(event) =>
                onChangeDraft({ ...draft, fillOpacity: Number(event.target.value) })
              }
              className="mt-2 w-full disabled:opacity-40"
            />
            <p className="mt-1 text-xs text-muted">
              Fades the whole frame toward the page colour. Border and background dim
              together — they are one picture, which is what keeps the middle seamless
              against the edges.
            </p>
          </div>

          <Button onClick={onSave} disabled={busy}>
            Save
          </Button>
        </div>

        {/* The preview. A real card, inside a wrapper carrying the draft's
            variables — so what you see here is what the application draws. */}
        <div>
          <p className="text-sm font-medium text-ink">Preview</p>
          <div
            data-card-frame={draft.centerFill ? "on" : "off"}
            style={previewVars}
            className="mt-2"
          >
            <CustomizableCard title="Application &amp; System Info" defaultOpen>
              <p className="text-sm text-muted">
                The card body sits inside the frame&apos;s middle section. Adjust the
                slices until the artwork&apos;s corners land on the card&apos;s corners.
              </p>
            </CustomizableCard>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * `Frame N`, where N clears every existing `Frame <number>`.
 *
 * Regexing the existing names rather than counting them, so deleting #2 of
 * three doesn't produce a second `Frame 3`. Same approach the texture gallery
 * uses for its auto-naming.
 */
function nextFrameName(frames: CardFrame[]): string {
  const highest = frames.reduce((max, frame) => {
    const match = /^Frame (\d+)$/.exec(frame.name);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `Frame ${highest + 1}`;
}
