"use client";

// The dashboard's texture library: a gallery of up to 20 pictures, one of them
// chosen to draw behind the home dashboard, plus the knobs for whichever
// picture is being worked on.
//
// Route-local rather than a registered component: it's one admin control bound
// to this screen's actions, and `components.md` keeps page-specific UI out of
// the registry. Mirrors `carousel-image-control.tsx` for the upload half.
//
// Pictures upload immediately rather than waiting for a Save button (the file is
// already chosen; parking megabytes in form state buys nothing), but the three
// knobs DO have a Save: they're a set you adjust together while watching the
// preview, and writing on every drag would be a request per pixel.
//
// NARROW SCREENS: the gallery is a `grid` that steps 2 -> 3 -> 4 columns, and
// the knobs stack from `sm:grid-cols-2` to one column. Restyled with plain
// responsive variants rather than a `useIsCompact()` branch — it's the same
// component at every width, which is the rule in design.md.

import { useRef, useState } from "react";
import { Button } from "@/components/button";
import {
  MAX_DASHBOARD_TEXTURES,
  MAX_DASHBOARD_TEXTURE_BYTES,
  type DashboardTextureItem,
} from "@/lib/dashboard-texture";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/shared/image-upload";
import {
  addDashboardTextureAction,
  deleteDashboardTextureAction,
  renameDashboardTextureAction,
  replaceDashboardTextureImageAction,
  saveDashboardTextureSettingsAction,
  selectDashboardTextureAction,
} from "../../actions";

const MAX_MB = Math.round(MAX_DASHBOARD_TEXTURE_BYTES / 1024 / 1024);

/**
 * What the file picker is currently for.
 *
 * One `<input type="file">` serves both Add and Replace: two inputs would mean
 * two refs and two change handlers doing the same work, and the picker is modal
 * anyway so only one intent can be live at a time.
 */
type PickerIntent = { kind: "add" } | { kind: "replace"; id: number };

export function DashboardTextureControl({
  textures,
  selectedId: initialSelectedId,
}: {
  textures: DashboardTextureItem[];
  /** The library row the dashboard draws, or `undefined` for flat paper. */
  selectedId?: number;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const intent = useRef<PickerIntent>({ kind: "add" });

  // Server state, mirrored locally so the gallery responds immediately instead
  // of waiting on a round trip plus a revalidate. Every action that changes the
  // server also patches this, so the two stay in step without a refetch.
  const [items, setItems] = useState(textures);
  const [selectedId, setSelectedId] = useState(initialSelectedId);

  // Which picture the knobs and the preview are showing. Starts at the selected
  // one, but deliberately independent of it: an admin should be able to tune a
  // texture before committing the dashboard to it.
  const [editingId, setEditingId] = useState<number | undefined>(
    initialSelectedId ?? textures[0]?.id,
  );

  const [error, setError] = useState<string | undefined>(undefined);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);

  // Bumped after an upload so thumbnails refetch — the route sends a 5-minute
  // max-age, so without this a replaced picture shows the old bytes.
  const [version, setVersion] = useState(() => String(Date.now()));

  const [renamingId, setRenamingId] = useState<number | undefined>(undefined);
  const [draftName, setDraftName] = useState("");

  const editing = items.find((item) => item.id === editingId);
  const isFull = items.length >= MAX_DASHBOARD_TEXTURES;

  /** A thumbnail URL for one library picture. */
  const imageUrl = (id: number) =>
    `/api/dashboard/texture?id=${id}&v=${encodeURIComponent(version)}`;

  /** Runs a server action, funnelling both failure paths to the same banner. */
  async function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    onSuccess: () => void,
    successNote: string,
  ) {
    setIsBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      const result = await action();
      if (result.ok) {
        onSuccess();
        setNote(successNote);
      } else {
        setError(result.error);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setIsBusy(false);
    }
  }

  function openPicker(next: PickerIntent) {
    intent.current = next;
    fileInput.current?.click();
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const chosen = intent.current;

    // Checked here as well as in the lib: otherwise an oversized file is still
    // read and posted, and what comes back is a framework body-limit error
    // rather than something a reader can act on. The server cap stays
    // authoritative.
    if (file.size > MAX_DASHBOARD_TEXTURE_BYTES) {
      setError(
        `That picture is ${(file.size / 1024 / 1024).toFixed(1)} MB — keep it under ${MAX_MB} MB.`,
      );
      if (fileInput.current) fileInput.current.value = "";
      return;
    }

    // The File goes over as multipart, not as a base64 argument — see the action.
    const body = new FormData();
    body.set("image", file);

    if (chosen.kind === "add") {
      // Auto-named so the upload isn't blocked behind a prompt; the caption is
      // editable in place the moment the tile appears. Numbered past the highest
      // existing "Texture N" rather than by count, so deleting #2 of three
      // doesn't make the next upload collide with #3.
      const highest = items.reduce((max, item) => {
        const match = /^Texture (\d+)$/.exec(item.name);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0);
      const name = `Texture ${highest + 1}`;
      body.set("name", name);

      // The new tile is built from the id the action returns, not a placeholder:
      // Tune / Replace / Delete on a just-added picture have to address the real
      // row, and the router refresh that would supply it lands too late.
      let assignedId: number | undefined;
      await run(
        async () => {
          const result = await addDashboardTextureAction(body);
          assignedId = result.id;
          return result;
        },
        () => {
          // Bound to a const so the narrowing survives into the `setItems`
          // closure — TypeScript widens a captured `let` back to `| undefined`.
          const newId = assignedId;
          if (newId === undefined) return;
          setItems((current) => [
            ...current,
            {
              id: newId,
              name,
              hasImage: true,
              // The column defaults from migration 0113 — a new picture starts
              // quiet, and this is what the server just stored.
              opacity: 0.1,
              mode: "cover",
              blur: 0,
              updatedAt: String(Date.now()),
            },
          ]);
          setVersion(String(Date.now()));
        },
        "Picture added. Choose it below to show it on the dashboard.",
      );
    } else {
      await run(
        () => replaceDashboardTextureImageAction(chosen.id, body),
        () => setVersion(String(Date.now())),
        "Picture replaced.",
      );
    }

    // Cleared so re-picking the *same* file still fires a change event.
    if (fileInput.current) fileInput.current.value = "";
  }

  function handleSelect(id: number) {
    // Clicking the chosen texture again clears the selection, so there is a way
    // back to flat paper that isn't "delete the picture".
    const next = selectedId === id ? undefined : id;
    void run(
      () => selectDashboardTextureAction(next),
      () => setSelectedId(next),
      next === undefined ? "Dashboard background cleared." : "Dashboard background updated.",
    );
  }

  function handleDelete(id: number) {
    void run(
      () => deleteDashboardTextureAction(id),
      () => {
        setItems((current) => current.filter((item) => item.id !== id));
        // The lib clears the pointer when the selected picture goes, so mirror
        // that rather than leaving the gallery showing a selection that's gone.
        if (selectedId === id) setSelectedId(undefined);
        if (editingId === id) setEditingId(undefined);
      },
      "Picture removed.",
    );
  }

  function handleRename(id: number) {
    const name = draftName;
    void run(
      () => renameDashboardTextureAction(id, name),
      () => {
        setItems((current) =>
          current.map((item) => (item.id === id ? { ...item, name: name.trim() } : item)),
        );
        setRenamingId(undefined);
      },
      "Name saved.",
    );
  }

  function handleSaveSettings(item: DashboardTextureItem) {
    void run(
      () =>
        saveDashboardTextureSettingsAction(item.id, {
          opacity: item.opacity,
          mode: item.mode,
          blur: item.blur,
        }),
      () => setVersion(String(Date.now())),
      "Settings saved.",
    );
  }

  /** Patches one picture's knobs locally while a slider is being dragged. */
  function patchEditing(patch: Partial<DashboardTextureItem>) {
    setItems((current) =>
      current.map((item) => (item.id === editingId ? { ...item, ...patch } : item)),
    );
  }

  return (
    <div className="mt-8 space-y-6">
      {/* One picker for both Add and Replace — see PickerIntent. */}
      <input
        ref={fileInput}
        type="file"
        accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
        onChange={(event) => void handleFile(event.target.files?.[0])}
        className="hidden"
      />

      <div className="rounded-lg border border-line p-3 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-ink">Texture library</p>
            <p className="mt-0.5 text-xs text-muted">
              PNG, JPEG, WebP or GIF, up to {MAX_MB}&nbsp;MB each. A wide picture around
              2560&times;1440 covers a desktop without being upscaled.
            </p>
          </div>
          <p className="font-mono text-xs text-muted">
            {items.length} / {MAX_DASHBOARD_TEXTURES}
          </p>
        </div>

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        {!error && note && <p className="mt-2 text-xs text-brass">{note}</p>}

        {items.length === 0 && (
          <p className="mt-4 rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
            No pictures yet. Add one to give the dashboard a background.
          </p>
        )}

        {/* Two columns on a phone, four on a desktop. The tile is the same
            component at every width — only the column count changes. */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => {
            const isSelected = item.id === selectedId;
            const isEditing = item.id === editingId;

            return (
              <div
                key={item.id}
                className={`overflow-hidden rounded-xl border bg-paper ${
                  isEditing ? "border-brass" : "border-line"
                }`}
              >
                {/* The picture is the button: clicking it is how you choose the
                    dashboard's background, which is this screen's main verb. */}
                <button
                  type="button"
                  onClick={() => handleSelect(item.id)}
                  disabled={isBusy}
                  aria-pressed={isSelected}
                  title={
                    isSelected ? "Showing on the dashboard — click to clear" : "Show on the dashboard"
                  }
                  className="relative block aspect-[4/3] w-full overflow-hidden disabled:opacity-60"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- DB-backed route, not a static asset next/image can optimize. */}
                  <img
                    src={imageUrl(item.id)}
                    alt={item.name}
                    className="h-full w-full object-cover"
                  />
                  {isSelected && (
                    <span className="absolute inset-0 flex items-start justify-end bg-brass/15 p-1.5">
                      <span className="rounded-full bg-brass px-2 py-0.5 text-[10px] font-semibold text-paper">
                        On dashboard
                      </span>
                    </span>
                  )}
                </button>

                <div className="border-t border-line p-2">
                  {renamingId === item.id ? (
                    <input
                      autoFocus
                      value={draftName}
                      maxLength={40}
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={() => handleRename(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") handleRename(item.id);
                        if (event.key === "Escape") setRenamingId(undefined);
                      }}
                      className="w-full rounded border border-brass bg-paper px-1 py-0.5 text-xs text-ink"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingId(item.id);
                        setDraftName(item.name);
                      }}
                      title="Rename"
                      className="block w-full truncate text-left text-xs font-medium text-ink hover:text-brass"
                    >
                      {item.name}
                    </button>
                  )}

                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant={isEditing ? "primary" : "secondary"}
                      onClick={() => setEditingId(item.id)}
                      disabled={isBusy}
                    >
                      Tune
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openPicker({ kind: "replace", id: item.id })}
                      disabled={isBusy}
                    >
                      Replace
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleDelete(item.id)}
                      disabled={isBusy}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* The Add tile sits in the grid rather than above it, so "where the
              next picture lands" is where you click. */}
          <button
            type="button"
            onClick={() => openPicker({ kind: "add" })}
            disabled={isBusy || isFull}
            title={
              isFull
                ? `The library holds ${MAX_DASHBOARD_TEXTURES} pictures. Delete one to add another.`
                : "Add a picture"
            }
            className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line px-2 text-center text-xs text-muted hover:border-brass hover:text-brass disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:text-muted"
          >
            <span className="text-lg leading-none">+</span>
            {isBusy ? "Working…" : isFull ? `Library full (${MAX_DASHBOARD_TEXTURES})` : "Add picture"}
          </button>
        </div>
      </div>

      {/* The knobs, bound to whichever picture is being tuned. Hidden with an
          empty library: three controls that visibly do nothing are worse than an
          explanation of what to do first. */}
      {editing && (
        <div className="rounded-lg border border-line p-3 sm:p-4">
          <p className="text-sm font-medium text-ink">
            How <span className="text-brass">{editing.name}</span> reads
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Drag to see the effect in the preview below, then Save. These settings belong to
            this picture alone — each texture keeps its own. Low opacity is deliberate: the
            dashboard&apos;s cards sit on top of this.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="flex items-baseline justify-between text-xs font-medium text-ink">
                Opacity
                <span className="font-mono text-muted">{editing.opacity.toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={editing.opacity}
                onChange={(event) => patchEditing({ opacity: Number(event.target.value) })}
                className="mt-2 w-full accent-brass"
              />
            </label>

            <label className="block">
              <span className="flex items-baseline justify-between text-xs font-medium text-ink">
                Blur
                <span className="font-mono text-muted">{editing.blur}px</span>
              </span>
              <input
                type="range"
                min={0}
                max={40}
                step={1}
                value={editing.blur}
                onChange={(event) => patchEditing({ blur: Number(event.target.value) })}
                className="mt-2 w-full accent-brass"
              />
            </label>
          </div>

          <fieldset className="mt-4">
            <legend className="text-xs font-medium text-ink">Layout</legend>
            <div className="mt-2 flex gap-2">
              {(["cover", "tile"] as const).map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={editing.mode === option ? "primary" : "secondary"}
                  onClick={() => patchEditing({ mode: option })}
                >
                  {option === "cover" ? "Cover" : "Tile"}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              {editing.mode === "cover"
                ? "One copy scaled to fill the screen. Best for a photograph."
                : "Repeated at its natural size. Best for a small seamless pattern."}
            </p>
          </fieldset>

          {/* The preview. Built from the same values globals.css reads, so what
              shows here is what the dashboard will do — including the `bg-paper`
              underneath and a card on top, because judging a background without
              the thing that sits on it is guesswork. */}
          <div className="mt-6">
            <p className="text-xs font-medium text-ink">Preview</p>
            <div className="relative mt-2 h-48 overflow-hidden rounded-xl border border-line bg-paper">
              <span
                aria-hidden
                className="absolute inset-0 bg-center"
                style={{
                  backgroundImage: `url("${imageUrl(editing.id)}")`,
                  backgroundSize: editing.mode === "cover" ? "cover" : "auto",
                  backgroundRepeat: editing.mode === "cover" ? "no-repeat" : "repeat",
                  opacity: editing.opacity,
                  filter: `blur(${editing.blur}px)`,
                  transform: "scale(1.06)",
                }}
              />
              <div className="relative flex h-full items-center justify-center p-6">
                <div className="card-raised w-full max-w-sm rounded-xl border border-line bg-paper-raised p-4">
                  <p className="font-display text-base font-semibold text-ink">Daily Quote</p>
                  <p className="mt-1 text-sm text-muted">
                    A card sits on top of the texture — check this stays easy to read.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            {editing.id !== selectedId && (
              <Button
                variant="secondary"
                onClick={() => handleSelect(editing.id)}
                disabled={isBusy}
              >
                Show on dashboard
              </Button>
            )}
            <Button onClick={() => handleSaveSettings(editing)} disabled={isBusy}>
              {isBusy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
