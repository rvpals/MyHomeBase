"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { PhotoViewer, type ViewerPhoto } from "@/components/photo-viewer";
import { Progress3D } from "@/components/progress-3d";
import {
  MAX_LIST_PHOTOS,
  PHOTO_COUNT_PRESETS,
  RESOLUTION_PRESETS,
  describeCriteria,
  emptyCriteria,
  formatBytes,
  type PhotoMagicCriteria,
  type PhotoMagicListSummary,
} from "@/lib/photo-magic";
import {
  clearIndexAction,
  countCandidatesAction,
  countIndexedAction,
  deleteMagicListAction,
  generateMagicListAction,
  getScanStatusAction,
  listMagicListsAction,
  loadGeneratedPhotosAction,
  loadMagicListAction,
  regenerateMagicListAction,
  saveMagicListAction,
  startScanAction,
  updateMagicListAction,
  type MagicGenerationView,
  type MagicPhotoView,
  type ScanStatusView,
} from "./gallery-magic-actions";
import {
  addPhotosToAlbumAction,
  createAlbumAction,
  listAlbumsAction,
} from "./gallery-album-actions";

// The Magic List screen: pick criteria, scan the archive into an index, draw a set, and
// then play / export / keep it.
//
// A client component holding only VIEW state -- what is typed in the form, which set
// came back, whether the viewer is open. Every decision (what matches, what to draw,
// how far along a scan is) belongs to `src/lib/photo-magic` and arrives through the
// server actions.

/** The zip route's own ceiling. Export refuses past it; the LIST may be larger. */
const MAX_EXPORT_PHOTOS = 200;

/** How often to ask how the scan is going. Matches the music scanner's cadence. */
const POLL_INTERVAL_MS = 1000;

function photoUrl(relativePath: string): string {
  return `/api/journal/photos?path=${encodeURIComponent(relativePath)}`;
}

/**
 * The form's own shape: every field a string, because that is what an `<input>` holds.
 *
 * Kept separate from `PhotoMagicCriteria` rather than storing numbers and parsing on
 * each keystroke -- a half-typed "19" in a width box must not be read as a real bound,
 * and clearing a field has to mean "no bound" rather than `NaN`. The conversion happens
 * once, in `criteriaFromForm`.
 */
interface CriteriaForm {
  fromDate: string;
  toDate: string;
  minMb: string;
  maxMb: string;
  minWidth: string;
  minHeight: string;
  maxWidth: string;
  maxHeight: string;
  maxPhotos: string;
}

function emptyForm(): CriteriaForm {
  return {
    fromDate: "",
    toDate: "",
    minMb: "",
    maxMb: "",
    minWidth: "",
    minHeight: "",
    maxWidth: "",
    maxHeight: "",
    maxPhotos: String(emptyCriteria().maxPhotos),
  };
}

/** A blank field is an ABSENT bound, never a zero -- the rule the whole feature rests on. */
function numberOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Megabytes in the form, bytes in the domain -- converted in exactly one place. */
function bytesFromMb(value: string): number | undefined {
  const mb = numberOrUndefined(value);
  return mb === undefined ? undefined : Math.round(mb * 1024 * 1024);
}

function criteriaFromForm(form: CriteriaForm): PhotoMagicCriteria {
  return {
    fromDate: form.fromDate.trim() === "" ? undefined : form.fromDate,
    toDate: form.toDate.trim() === "" ? undefined : form.toDate,
    minBytes: bytesFromMb(form.minMb),
    maxBytes: bytesFromMb(form.maxMb),
    minWidth: numberOrUndefined(form.minWidth),
    minHeight: numberOrUndefined(form.minHeight),
    maxWidth: numberOrUndefined(form.maxWidth),
    maxHeight: numberOrUndefined(form.maxHeight),
    maxPhotos: numberOrUndefined(form.maxPhotos) ?? emptyCriteria().maxPhotos,
  };
}

function formFromCriteria(criteria: PhotoMagicCriteria): CriteriaForm {
  const mb = (bytes?: number) =>
    bytes === undefined ? "" : String(Math.round((bytes / (1024 * 1024)) * 10) / 10);
  return {
    fromDate: criteria.fromDate ?? "",
    toDate: criteria.toDate ?? "",
    minMb: mb(criteria.minBytes),
    maxMb: mb(criteria.maxBytes),
    minWidth: criteria.minWidth === undefined ? "" : String(criteria.minWidth),
    minHeight: criteria.minHeight === undefined ? "" : String(criteria.minHeight),
    maxWidth: criteria.maxWidth === undefined ? "" : String(criteria.maxWidth),
    maxHeight: criteria.maxHeight === undefined ? "" : String(criteria.maxHeight),
    maxPhotos: String(criteria.maxPhotos),
  };
}

export function MagicListView({
  initialLists,
  initialIndexedCount,
}: {
  initialLists: PhotoMagicListSummary[];
  initialIndexedCount: number;
}) {
  const [lists, setLists] = useState(initialLists);
  const [indexedCount, setIndexedCount] = useState(initialIndexedCount);

  const [form, setForm] = useState<CriteriaForm>(emptyForm);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  /** Which saved list is loaded, so Save can update rather than duplicate. */
  const [loadedListId, setLoadedListId] = useState<number | undefined>();

  const [candidateCount, setCandidateCount] = useState<number | undefined>();
  const [generation, setGeneration] = useState<MagicGenerationView | undefined>();
  const [isGenerating, setIsGenerating] = useState(false);

  const [scan, setScan] = useState<ScanStatusView | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [isBusy, setIsBusy] = useState(false);

  const [viewerIndex, setViewerIndex] = useState<number | undefined>();
  const [viewerAutoPlay, setViewerAutoPlay] = useState(false);

  const criteria = useMemo(() => criteriaFromForm(form), [form]);

  const setField = useCallback((field: keyof CriteriaForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  }, []);

  // --- The live candidate preview --------------------------------------------------
  //
  // Debounced, because it fires on every keystroke in nine fields and each one is a
  // round trip. 400ms is long enough that typing "1920" asks once rather than four
  // times, and short enough to feel immediate when you stop.
  useEffect(() => {
    const timer = setTimeout(() => {
      void countCandidatesAction(criteria)
        .then(setCandidateCount)
        .catch(() => setCandidateCount(undefined));
    }, 400);
    return () => clearTimeout(timer);
  }, [criteria]);

  // --- Scan polling ----------------------------------------------------------------
  //
  // Only while a scan is running: no timer otherwise, so an idle screen is idle. The
  // same shape the music scan view uses.
  const isScanning = scan?.status === "running" && !scan.isStale;

  const refreshScan = useCallback(async (scanRunId?: number) => {
    const status = await getScanStatusAction(scanRunId);
    setScan(status);
    // The index only changes when a scan touches it, so this is the one place worth
    // re-reading the count rather than polling it on its own.
    if (status?.status !== "running") {
      void countIndexedRefresh().then(setIndexedCount).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!isScanning) return;
    const timer = setInterval(() => void refreshScan(scan?.id), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isScanning, refreshScan, scan?.id]);

  const handleScan = useCallback(async () => {
    setError(undefined);
    setNotice(undefined);
    const result = await startScanAction({
      fromDate: criteria.fromDate,
      toDate: criteria.toDate,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refreshScan(result.scanRunId);
  }, [criteria.fromDate, criteria.toDate, refreshScan]);

  // --- Generating ------------------------------------------------------------------

  const handleGenerate = useCallback(async () => {
    setError(undefined);
    setNotice(undefined);
    setIsGenerating(true);
    try {
      const result = await generateMagicListAction({ listId: loadedListId, criteria });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setGeneration(result.result);
      if (loadedListId !== undefined) setLists(await refreshLists());
    } finally {
      setIsGenerating(false);
    }
  }, [criteria, loadedListId]);

  const handleRegenerate = useCallback(async () => {
    if (loadedListId === undefined) return;
    setError(undefined);
    setIsGenerating(true);
    try {
      const result = await regenerateMagicListAction(loadedListId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setGeneration(result.result);
      setLists(await refreshLists());
    } finally {
      setIsGenerating(false);
    }
  }, [loadedListId]);

  // --- Saved lists -----------------------------------------------------------------

  const handleSave = useCallback(async () => {
    setError(undefined);
    setNotice(undefined);
    setIsBusy(true);
    try {
      // Updating when a list is loaded, creating otherwise -- so editing a loaded list's
      // dates and pressing Save changes THAT list rather than silently making a second
      // one with the same name (which the unique index would refuse anyway). The two
      // branches are kept apart rather than unioned: only the create path returns an id
      // to adopt, and narrowing a union on a property is the kind of thing that quietly
      // stops working when a return type grows a field.
      if (loadedListId === undefined) {
        const created = await saveMagicListAction({ name, description, criteria });
        if (!created.ok) {
          setError(created.error);
          return;
        }
        setLoadedListId(created.listId);
        setNotice(`Saved “${name}”.`);
      } else {
        const updated = await updateMagicListAction({
          id: loadedListId,
          name,
          description,
          criteria,
        });
        if (!updated.ok) {
          setError(updated.error);
          return;
        }
        setNotice(`Updated “${name}”.`);
      }

      setLists(await refreshLists());
    } finally {
      setIsBusy(false);
    }
  }, [criteria, description, loadedListId, name]);

  const handleLoad = useCallback(async (listId: number) => {
    setError(undefined);
    setNotice(undefined);
    const result = await loadMagicListAction(listId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLoadedListId(result.list.id);
    setName(result.list.name);
    setDescription(result.list.description);
    setForm(formFromCriteria(result.list.criteria));

    // Replay the set it last generated rather than re-rolling: loading a saved list
    // must show the pictures the reader kept, not a fresh draw. "Create the list" is
    // the explicit way to re-roll.
    const photos = await loadGeneratedPhotosAction(listId);
    setGeneration(
      photos.length === 0
        ? undefined
        : {
            photos,
            stats: {
              candidateCount: photos.length,
              selectedCount: photos.length,
              maxPhotos: result.list.criteria.maxPhotos,
              cappedByLimit: false,
              excludedUnknownSize: 0,
            },
            summary: `Showing the ${photos.length} photograph${
              photos.length === 1 ? "" : "s"
            } this list last produced.`,
          },
    );
  }, []);

  const handleDelete = useCallback(
    async (listId: number) => {
      setError(undefined);
      const result = await deleteMagicListAction(listId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (loadedListId === listId) {
        setLoadedListId(undefined);
        setGeneration(undefined);
      }
      setLists(await refreshLists());
    },
    [loadedListId],
  );

  const handleNewList = useCallback(() => {
    setLoadedListId(undefined);
    setName("");
    setDescription("");
    setForm(emptyForm());
    setGeneration(undefined);
    setNotice(undefined);
    setError(undefined);
  }, []);

  // --- What to do with a result ----------------------------------------------------

  // Memoised rather than derived inline: `?? []` builds a NEW empty array on every
  // render, which would change the identity of every dependency list below it and make
  // the viewer's photo list and the export handler rebuild each time.
  const photos = useMemo(() => generation?.photos ?? [], [generation]);

  const viewerPhotos: ViewerPhoto[] = useMemo(
    () =>
      photos.map((photo) => ({
        name: photo.name,
        relativePath: photo.relativePath,
        subcaption: [
          photo.takenAtDate,
          formatBytes(photo.bytes),
          photo.width !== undefined && photo.height !== undefined
            ? `${photo.width} × ${photo.height}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    [photos],
  );

  /**
   * Exports the set as one zip.
   *
   * The route is a POST, so this fetches and saves the blob by hand rather than
   * pointing an `<a download>` at it -- see the route's comment for why a selection of
   * long paths travels in a body. Refuses past the route's own ceiling here, with a
   * message naming it, rather than letting the reader wait for a 400: the LIST may hold
   * up to MAX_LIST_PHOTOS, because a slideshow has no such limit.
   */
  const handleExport = useCallback(async () => {
    if (photos.length === 0) return;
    setError(undefined);
    setNotice(undefined);

    if (photos.length > MAX_EXPORT_PHOTOS) {
      setError(
        `This list holds ${photos.length} photographs — a zip can carry ${MAX_EXPORT_PHOTOS}. Lower "How many" and create the list again, or export it as an album in parts.`,
      );
      return;
    }

    setIsBusy(true);
    try {
      const response = await fetch("/api/journal/photos/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: photos.map((photo) => photo.relativePath) }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => undefined);
        setError(body?.error ?? "Couldn't build that download.");
        return;
      }

      const disposition = response.headers.get("Content-Disposition") ?? "";
      const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "magic-list.zip";
      const missing = Number(response.headers.get("X-Missing-Photos") ?? "0");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      setNotice(
        missing > 0
          ? `Exported ${photos.length - missing} of ${photos.length} — ${missing} could not be found in the archive.`
          : `Exported ${photos.length} photograph${photos.length === 1 ? "" : "s"}.`,
      );
    } catch {
      setError("Couldn't export those photos.");
    } finally {
      setIsBusy(false);
    }
  }, [photos]);

  return (
    <div className="space-y-6">
      {/* The criteria form. Two columns on a desktop, one on a phone -- `max-lg:` so
          the wide layout provably cannot regress. */}
      <CollapsibleCard title="Criteria" defaultOpen>
        <CriteriaFields form={form} setField={setField} />

        <p className="mt-4 text-sm text-muted">
          {describeCriteria(criteria)}{" "}
          {candidateCount !== undefined && (
            <span className="text-ink">
              {candidateCount} indexed photograph{candidateCount === 1 ? "" : "s"} match
              {candidateCount === 1 ? "es" : ""} right now.
            </span>
          )}
        </p>
      </CollapsibleCard>

      {/* The index and its scan. Kept visible rather than buried, because a reader
          whose first search returns nothing needs to discover this. */}
      <CollapsibleCard title="Archive index" defaultOpen={indexedCount === 0}>
        <p className="text-sm text-muted">
          {indexedCount === 0
            ? "Nothing is indexed yet. Scanning reads each photograph's size, dimensions and date once and remembers them, so later searches are instant."
            : `${indexedCount.toLocaleString()} photograph${indexedCount === 1 ? "" : "s"} indexed. A re-scan only re-reads files that have changed.`}
        </p>
        <p className="mt-1 text-sm text-muted">
          {criteria.fromDate === undefined && criteria.toDate === undefined
            ? "With no dates set this scans the whole archive, which can take a while over the network."
            : "This scans the date range above."}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => void handleScan()} disabled={isScanning}>
            {isScanning ? "Scanning…" : "Scan the archive"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void handleClearIndex(setIndexedCount, setError, setNotice)}
            disabled={isScanning || indexedCount === 0}
          >
            Clear the index
          </Button>
        </div>

        {scan !== undefined && (
          <div className="mt-4">
            <Progress3D
              label={scanLabel(scan)}
              // `undefined` while the counting phase runs, which renders the sweeping
              // indeterminate bar rather than a misleading 0%.
              value={scan.percent === undefined && isScanning ? undefined : (scan.percent ?? 100)}
              showValue={scan.percent !== undefined}
            />
            <p className="mt-1 truncate text-xs text-muted">
              {scan.status === "running"
                ? scan.currentPath || "Counting the photographs…"
                : scanSummary(scan)}
            </p>
          </div>
        )}
      </CollapsibleCard>

      {/* Create, and the saved-list controls. */}
      <div className="flex flex-wrap items-end gap-3">
        <Button onClick={() => void handleGenerate()} disabled={isGenerating || isBusy}>
          {isGenerating ? "Creating…" : "Create the list."}
        </Button>
        {loadedListId !== undefined && (
          <Button variant="secondary" onClick={() => void handleRegenerate()} disabled={isGenerating}>
            Re-roll this list
          </Button>
        )}
      </div>

      {error !== undefined && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {notice !== undefined && <p className="text-sm text-muted">{notice}</p>}

      {/* The result. */}
      {generation !== undefined && (
        <section>
          <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">{generation.summary}</p>
            {photos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setViewerAutoPlay(true);
                    setViewerIndex(0);
                  }}
                >
                  Slide show (with options)
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void handleExport()} disabled={isBusy}>
                  Export to zip file
                </Button>
                <AddToAlbumControl
                  photos={photos}
                  onDone={(message) => {
                    setNotice(message);
                    setError(undefined);
                  }}
                  onError={(message) => {
                    setError(message);
                    setNotice(undefined);
                  }}
                />
              </div>
            )}
          </header>

          <PhotoGrid photos={photos} onOpen={(index) => {
            setViewerAutoPlay(false);
            setViewerIndex(index);
          }} />
        </section>
      )}

      {/* Saving and reloading. Below the result, because naming a list is what you do
          once you like what came back. */}
      <CollapsibleCard title="Saved lists">
        <SavedListControls
          lists={lists}
          loadedListId={loadedListId}
          name={name}
          description={description}
          isBusy={isBusy}
          onName={setName}
          onDescription={setDescription}
          onSave={() => void handleSave()}
          onLoad={(id) => void handleLoad(id)}
          onDelete={(id) => void handleDelete(id)}
          onNew={handleNewList}
        />
      </CollapsibleCard>

      {viewerIndex !== undefined && (
        // The set form: this screen assembled the list, so the viewer is handed the
        // photographs rather than a folder to read. Slideshow options, the favourite
        // heart and the add-to-album menu all come with it -- which is why "Slide show
        // (with options)" needed no new UI here.
        <PhotoViewer
          photos={viewerPhotos}
          initialIndex={viewerIndex}
          autoPlay={viewerAutoPlay}
          photoUrl={photoUrl}
          onClose={() => setViewerIndex(undefined)}
        />
      )}
    </div>
  );
}

/** Re-reads the saved lists after a write. */
async function refreshLists(): Promise<PhotoMagicListSummary[]> {
  return listMagicListsAction();
}

/** Re-reads the indexed count after a scan. */
async function countIndexedRefresh(): Promise<number> {
  return countIndexedAction();
}

async function handleClearIndex(
  setIndexedCount: (value: number) => void,
  setError: (value: string | undefined) => void,
  setNotice: (value: string | undefined) => void,
): Promise<void> {
  setError(undefined);
  await clearIndexAction();
  setIndexedCount(await countIndexedRefresh());
  setNotice("The index was cleared. Saved lists are untouched.");
}

/** "Indexing" / "Counting" / "Done" — what the bar's label says. */
function scanLabel(scan: ScanStatusView): string {
  if (scan.status !== "running") return "Scan finished";
  return scan.filesTotal === 0 ? "Counting the photographs" : "Indexing the archive";
}

/** The one-line outcome once a scan has stopped. */
function scanSummary(scan: ScanStatusView): string {
  if (scan.status === "failed") return scan.lastError || "The scan failed.";
  if (scan.status === "cancelled") return "The scan was stopped.";
  const parts = [`${scan.filesIndexed} indexed`, `${scan.filesCached} unchanged`];
  if (scan.filesFailed > 0) parts.push(`${scan.filesFailed} unreadable`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------------

/**
 * The nine criteria inputs.
 *
 * One column on a phone, two from `lg` up -- via `max-lg:` variants on a two-column
 * base, so the desktop classes are untouched and cannot regress.
 */
function CriteriaFields({
  form,
  setField,
}: {
  form: CriteriaForm;
  setField: (field: keyof CriteriaForm, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
      <Field label="Taken from">
        <input
          type="date"
          value={form.fromDate}
          onChange={(event) => setField("fromDate", event.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Taken until">
        <input
          type="date"
          value={form.toDate}
          onChange={(event) => setField("toDate", event.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="Smallest file (MB)" hint="Leave blank for no limit.">
        <input
          type="number"
          min={0}
          step="0.1"
          value={form.minMb}
          onChange={(event) => setField("minMb", event.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Largest file (MB)" hint="Leave blank for no limit.">
        <input
          type="number"
          min={0}
          step="0.1"
          value={form.maxMb}
          onChange={(event) => setField("maxMb", event.target.value)}
          className={inputClass}
        />
      </Field>

      <Field
        label="Smallest size (px)"
        hint="Width × height. A photograph whose dimensions can't be read is left out."
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            placeholder="width"
            value={form.minWidth}
            onChange={(event) => setField("minWidth", event.target.value)}
            className={inputClass}
          />
          <span className="text-muted">×</span>
          <input
            type="number"
            min={1}
            placeholder="height"
            value={form.minHeight}
            onChange={(event) => setField("minHeight", event.target.value)}
            className={inputClass}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {RESOLUTION_PRESETS.map((preset) => (
            <Button
              key={preset.label}
              size="sm"
              variant="secondary"
              onClick={() => {
                setField("minWidth", String(preset.width));
                setField("minHeight", String(preset.height));
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </Field>

      <Field label="Largest size (px)" hint="Leave blank for no limit.">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            placeholder="width"
            value={form.maxWidth}
            onChange={(event) => setField("maxWidth", event.target.value)}
            className={inputClass}
          />
          <span className="text-muted">×</span>
          <input
            type="number"
            min={1}
            placeholder="height"
            value={form.maxHeight}
            onChange={(event) => setField("maxHeight", event.target.value)}
            className={inputClass}
          />
        </div>
      </Field>

      <Field
        label="How many photographs?"
        hint={`The most to draw, at random. Up to ${MAX_LIST_PHOTOS}.`}
      >
        <input
          type="number"
          min={1}
          max={MAX_LIST_PHOTOS}
          value={form.maxPhotos}
          onChange={(event) => setField("maxPhotos", event.target.value)}
          className={inputClass}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {PHOTO_COUNT_PRESETS.map((preset) => (
            <Button
              key={preset.count}
              size="sm"
              variant="secondary"
              onClick={() => setField("maxPhotos", String(preset.count))}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </Field>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint !== undefined && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/**
 * The results grid.
 *
 * `auto-fill` + `minmax`, so the grid sizes ITSELF to the screen rather than declaring
 * a column count per breakpoint -- design.md, "Collections size themselves". A phone
 * gets two or three across and a wide monitor gets eight, with no breakpoint list to
 * maintain.
 *
 * Plain `<img>`, not `next/image`: the bytes come from a session-gated route over a NAS
 * share, which `next/image` cannot optimize anyway. `loading="lazy"` matters more here
 * than anywhere else in the app -- a list of 500 photographs is 500 multi-megabyte
 * reads if they all start at once.
 */
function PhotoGrid({
  photos,
  onOpen,
}: {
  photos: MagicPhotoView[];
  onOpen: (index: number) => void;
}) {
  if (photos.length === 0) {
    return <p className="text-sm text-muted">No photographs in this list.</p>;
  }

  return (
    <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(140px,1fr))] max-lg:[grid-template-columns:repeat(auto-fill,minmax(104px,1fr))]">
      {photos.map((photo, index) => (
        <li key={photo.relativePath}>
          <button
            type="button"
            onClick={() => onOpen(index)}
            className="group block w-full text-left"
            title={photo.relativePath}
          >
            <span className="block aspect-square overflow-hidden rounded-md border border-line bg-paper-2">
              <img
                src={photoUrl(photo.relativePath)}
                alt={photo.name}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition-transform group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
              />
            </span>
            <span className="mt-1 block truncate text-xs text-muted">
              {photo.takenAtDate ?? photo.name}
            </span>
            <span className="block truncate text-xs text-muted">
              {formatBytes(photo.bytes)}
              {photo.width !== undefined && photo.height !== undefined
                ? ` · ${photo.width} × ${photo.height}`
                : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Add an album" — into a new album, or an existing one.
 *
 * Both, because a reader who just conjured a set either wants to name it as a new
 * collection or to file it alongside pictures they already gathered. Reuses the Albums
 * screen's own actions, so an album made here is the same thing in every other way.
 */
function AddToAlbumControl({
  photos,
  onDone,
  onError,
}: {
  photos: MagicPhotoView[];
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [albums, setAlbums] = useState<{ id: number; name: string }[]>([]);
  const [newName, setNewName] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const paths = useMemo(() => photos.map((photo) => photo.relativePath), [photos]);

  const open = useCallback(async () => {
    setIsOpen(true);
    const summaries = await listAlbumsAction();
    setAlbums(summaries.map((album) => ({ id: album.id, name: album.name })));
  }, []);

  const addToExisting = useCallback(
    async (albumId: number, albumName: string) => {
      setIsBusy(true);
      try {
        const result = await addPhotosToAlbumAction(albumId, paths);
        if (!result.ok) {
          onError(result.error);
          return;
        }
        setIsOpen(false);
        // The action reports how many were actually new, so a set already partly filed
        // says "4 of 20 added" rather than claiming all twenty.
        const { added, alreadyPresent } = result.value;
        onDone(
          alreadyPresent === 0
            ? `Added ${added} photograph${added === 1 ? "" : "s"} to “${albumName}”.`
            : `Added ${added} of ${paths.length} to “${albumName}” — ${alreadyPresent} ${
                alreadyPresent === 1 ? "was" : "were"
              } already in it.`,
        );
      } finally {
        setIsBusy(false);
      }
    },
    [onDone, onError, paths],
  );

  const createAndAdd = useCallback(async () => {
    if (newName.trim() === "") return;
    setIsBusy(true);
    try {
      const created = await createAlbumAction(newName.trim(), "");
      if (!created.ok) {
        onError(created.error);
        return;
      }
      const added = await addPhotosToAlbumAction(created.value.id, paths);
      if (!added.ok) {
        onError(added.error);
        return;
      }
      setIsOpen(false);
      setNewName("");
      onDone(`Created “${created.value.name}” with ${paths.length} photograph${paths.length === 1 ? "" : "s"}.`);
    } finally {
      setIsBusy(false);
    }
  }, [newName, onDone, onError, paths]);

  return (
    <div className="relative">
      <Button size="sm" variant="secondary" onClick={() => (isOpen ? setIsOpen(false) : void open())}>
        Add an album
      </Button>

      {isOpen && (
        <div
          className="absolute right-0 z-20 mt-2 w-64 rounded-md border border-line bg-paper p-3 shadow-lg"
        >
          <p className="mb-2 text-xs text-muted">
            Add {paths.length} photograph{paths.length === 1 ? "" : "s"} to…
          </p>

          <div className="mb-3">
            <input
              type="text"
              placeholder="New album name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              className={inputClass}
            />
            <Button
              size="sm"
              className="mt-2 w-full"
              onClick={() => void createAndAdd()}
              disabled={isBusy || newName.trim() === ""}
            >
              Create and add
            </Button>
          </div>

          {albums.length > 0 && (
            <>
              <p className="mb-1 text-xs font-medium text-ink">Or an existing album</p>
              <ul className="max-h-48 overflow-y-auto">
                {albums.map((album) => (
                  <li key={album.id}>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void addToExisting(album.id, album.name)}
                      className="block w-full truncate rounded px-2 py-2 text-left text-sm text-ink hover:bg-paper-2 disabled:opacity-50"
                    >
                      {album.name}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Naming, saving and reloading a set of criteria. */
function SavedListControls({
  lists,
  loadedListId,
  name,
  description,
  isBusy,
  onName,
  onDescription,
  onSave,
  onLoad,
  onDelete,
  onNew,
}: {
  lists: PhotoMagicListSummary[];
  loadedListId?: number;
  name: string;
  description: string;
  isBusy: boolean;
  onName: (value: string) => void;
  onDescription: (value: string) => void;
  onSave: () => void;
  onLoad: (id: number) => void;
  onDelete: (id: number) => void;
  onNew: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(event) => onName(event.target.value)}
            className={inputClass}
            placeholder="Summer 2019"
          />
        </Field>
        <Field label="Description">
          <input
            type="text"
            value={description}
            onChange={(event) => onDescription(event.target.value)}
            className={inputClass}
            placeholder="The big ones from the farm trip"
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onSave} disabled={isBusy || name.trim() === ""}>
          {loadedListId === undefined ? "Save these criteria" : "Update this list"}
        </Button>
        {loadedListId !== undefined && (
          <Button variant="secondary" onClick={onNew}>
            Start a new one
          </Button>
        )}
      </div>

      {lists.length === 0 ? (
        <p className="text-sm text-muted">No saved lists yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {lists.map((list) => (
            <li key={list.id} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {list.name}
                  {list.id === loadedListId && (
                    <span className="ml-2 text-xs text-muted">(loaded)</span>
                  )}
                </p>
                <p className="truncate text-xs text-muted">
                  {list.description || "No description."} · {list.photoCount} photo
                  {list.photoCount === 1 ? "" : "s"}
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => onLoad(list.id)}>
                Load
              </Button>
              <Button size="sm" variant="danger" onClick={() => onDelete(list.id)}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
