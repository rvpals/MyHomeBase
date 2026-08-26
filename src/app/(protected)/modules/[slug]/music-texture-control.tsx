"use client";

// Upload / replace / remove the Music Library's background picture, and tune how
// strongly it reads.
//
// Route-local rather than a registered component: it's one control bound to this
// module's actions, and `components.md` keeps page-specific UI out of the
// registry. Deliberately mirrors
// `admin/configuration/texture/dashboard-texture-control.tsx` -- same layout,
// same wording, same interaction -- so the two screens read as one app. If a
// third module wants a picture, THAT is the point to promote this into
// `src/components/` with the slug and the copy as props.
//
// The picture uploads immediately rather than waiting for a Save button (the file
// is already chosen; parking megabytes in form state buys nothing), but the three
// knobs DO have a Save: they're a set you adjust together while watching the
// preview, and writing on every drag would be a request per pixel.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { MAX_MODULE_TEXTURE_BYTES, type ModuleTextureMode } from "@/lib/module-texture";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/shared/image-upload";
import {
  getMusicTextureAction,
  removeMusicTextureImageAction,
  saveMusicTextureImageAction,
  saveMusicTextureSettingsAction,
} from "./music-actions";

const MAX_MB = Math.round(MAX_MODULE_TEXTURE_BYTES / 1024 / 1024);

export function MusicTextureControl() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [present, setPresent] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  const [savedNote, setSavedNote] = useState<string | undefined>(undefined);
  // Bumped after an upload so the preview refetches -- the route sends a 5-minute
  // max-age, so without this a replaced picture shows the old bytes.
  const [version, setVersion] = useState("");

  const [opacity, setOpacity] = useState(0.1);
  const [mode, setMode] = useState<ModuleTextureMode>("cover");
  const [blur, setBlur] = useState(0);

  // Read on mount rather than passed in as props: the configuration screen is a
  // client component that loads its own settings the same way (see
  // `music-configuration-view.tsx`), so this follows the screen it lives on.
  useEffect(() => {
    void getMusicTextureAction().then((texture) => {
      setPresent(texture.hasImage);
      setVersion(texture.imageVersion);
      setOpacity(texture.opacity);
      setMode(texture.mode);
      setBlur(texture.blur);
      setLoaded(true);
    });
  }, []);

  const imageUrl = `/api/modules/music-library/texture?v=${encodeURIComponent(version)}`;

  async function handleFile(file: File | undefined) {
    if (!file) return;

    // Checked here as well as in the lib: otherwise an oversized file is still
    // read and posted, and what comes back is a framework body-limit error rather
    // than something a reader can act on. The server cap stays authoritative.
    if (file.size > MAX_MODULE_TEXTURE_BYTES) {
      setError(
        `That picture is ${(file.size / 1024 / 1024).toFixed(1)} MB — keep it under ${MAX_MB} MB.`,
      );
      if (fileInput.current) fileInput.current.value = "";
      return;
    }

    setIsBusy(true);
    setError(undefined);
    setSavedNote(undefined);
    try {
      // The File goes over as multipart, not as a base64 argument -- see the action.
      const body = new FormData();
      body.set("image", file);

      const result = await saveMusicTextureImageAction(body);
      if (result.ok) {
        setPresent(true);
        setVersion(String(Date.now()));
        setSavedNote("Picture saved.");
      } else {
        setError(result.error);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read that file.");
    } finally {
      setIsBusy(false);
      // Cleared so re-picking the *same* file still fires a change event.
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleRemove() {
    setIsBusy(true);
    setError(undefined);
    setSavedNote(undefined);
    const result = await removeMusicTextureImageAction();
    if (result.ok) {
      setPresent(false);
      setSavedNote("Picture removed.");
    } else {
      setError(result.error);
    }
    setIsBusy(false);
  }

  async function handleSaveSettings() {
    setIsBusy(true);
    setError(undefined);
    setSavedNote(undefined);
    const result = await saveMusicTextureSettingsAction({ opacity, mode, blur });
    if (result.ok) setSavedNote("Settings saved.");
    else setError(result.error);
    setIsBusy(false);
  }

  if (!loaded) return <p className="text-sm text-muted">Loading background picture...</p>;

  return (
    <div className="space-y-6">
      {/* The upload row wraps on a narrow screen -- `flex-wrap` is doing the
          responsive work, so there are no desktop classes to regress. */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line p-3">
        <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-paper">
          {present ? (
            // eslint-disable-next-line @next/next/no-img-element -- DB-backed route, not a static asset next/image can optimize.
            <img
              src={imageUrl}
              alt="Music Library background picture"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="px-1 text-center text-[10px] leading-tight text-muted">
              No picture
            </span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Background picture</p>
          <p className="mt-0.5 text-xs text-muted">
            PNG, JPEG, WebP or GIF, up to {MAX_MB}&nbsp;MB. A wide picture around
            2560&times;1440 covers a desktop without being upscaled. It sits behind
            every Music Library screen.
          </p>
          {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
          {!error && savedNote && <p className="mt-1 text-xs text-brass">{savedNote}</p>}
        </div>

        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
          onChange={(event) => void handleFile(event.target.files?.[0])}
          className="hidden"
        />
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => fileInput.current?.click()}
            disabled={isBusy}
          >
            {isBusy ? "Working…" : present ? "Replace" : "Upload"}
          </Button>
          {present && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => void handleRemove()}
              disabled={isBusy}
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      {/* The knobs. Hidden with no picture: three controls that visibly do nothing
          are worse than an explanation of what to do first. */}
      {present && (
        <div className="rounded-lg border border-line p-4">
          <p className="text-sm font-medium text-ink">How it reads</p>
          <p className="mt-0.5 text-xs text-muted">
            Drag to see the effect in the preview below, then Save. Low opacity is
            deliberate &mdash; track lists and album grids sit on top of this.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="flex items-baseline justify-between text-xs font-medium text-ink">
                Opacity
                <span className="font-mono text-muted">{opacity.toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={opacity}
                onChange={(event) => setOpacity(Number(event.target.value))}
                className="mt-2 w-full accent-brass"
              />
            </label>

            <label className="block">
              <span className="flex items-baseline justify-between text-xs font-medium text-ink">
                Blur
                <span className="font-mono text-muted">{blur}px</span>
              </span>
              <input
                type="range"
                min={0}
                max={40}
                step={1}
                value={blur}
                onChange={(event) => setBlur(Number(event.target.value))}
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
                  variant={mode === option ? "primary" : "secondary"}
                  onClick={() => setMode(option)}
                >
                  {option === "cover" ? "Cover" : "Tile"}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              {mode === "cover"
                ? "One copy scaled to fill the screen. Best for a photograph."
                : "Repeated at its natural size. Best for a small seamless pattern."}
            </p>
          </fieldset>

          {/* The preview. Built from the same values globals.css reads, so what
              shows here is what the module will do -- including the `bg-paper`
              underneath and a track row on top, because judging a background
              without the thing that sits on it is guesswork. */}
          <div className="mt-6">
            <p className="text-xs font-medium text-ink">Preview</p>
            <div className="relative mt-2 h-48 overflow-hidden rounded-xl border border-line bg-paper">
              <span
                aria-hidden
                className="absolute inset-0 bg-center"
                style={{
                  backgroundImage: `url("${imageUrl}")`,
                  backgroundSize: mode === "cover" ? "cover" : "auto",
                  backgroundRepeat: mode === "cover" ? "no-repeat" : "repeat",
                  opacity,
                  filter: `blur(${blur}px)`,
                  transform: "scale(1.06)",
                }}
              />
              <div className="relative flex h-full items-center justify-center p-6">
                <div className="w-full max-w-sm rounded-xl border border-line bg-paper-raised p-4">
                  <p className="font-display text-base font-semibold text-ink">Nightfall</p>
                  <p className="mt-1 text-sm text-muted">
                    A track row sits on top &mdash; check this stays easy to read.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button onClick={() => void handleSaveSettings()} disabled={isBusy}>
              {isBusy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
