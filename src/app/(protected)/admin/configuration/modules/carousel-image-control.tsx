"use client";

// Upload / replace / remove the graphic a module shows on the home carousel.
//
// Route-local rather than a registered component: it's one admin control bound
// to this screen's actions, and `components.md` keeps page-specific UI out of
// the registry.
//
// The write happens immediately rather than waiting for the page's Save button.
// The file is already chosen by then, and parking a couple of megabytes of
// base64 in the admin form's state until Save would cost a lot of memory to
// achieve nothing.

import { useRef, useState } from "react";
import { Button } from "@/components/button";
import { MAX_CAROUSEL_IMAGE_BYTES } from "@/lib/modules";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/shared/image-upload";
import {
  removeModuleCarouselImageAction,
  saveModuleCarouselImageAction,
} from "../../actions";

export function CarouselImageControl({
  slug,
  moduleName,
  hasImage,
  imageVersion,
}: {
  slug: string;
  moduleName: string;
  hasImage: boolean;
  /** The module's `updatedAt`, used as the image URL's cache-buster. */
  imageVersion?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [present, setPresent] = useState(hasImage);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  // The image URL's `?v=`. Seeded from the module's `updatedAt` rather than from
  // 0, because the serving route now sends `immutable` with a one-year max-age:
  // a counter local to this component would make the *same* URL mean different
  // bytes in different sessions, and every one of them would keep the stale
  // picture for a year. `updatedAt` changes on every write, so the replaced
  // image always arrives under a URL nothing has cached.
  const [version, setVersion] = useState(imageVersion ?? "");

  async function handleFile(file: File | undefined) {
    if (!file) return;

    // Checked here as well as in the lib, because the failure mode otherwise is
    // bad: an oversized file still gets read, base64-encoded and posted, and
    // what comes back is a framework body-limit error — or, past a point,
    // nothing at all. The server cap stays authoritative; this just means the
    // reader is told immediately and nothing is uploaded.
    if (file.size > MAX_CAROUSEL_IMAGE_BYTES) {
      setError(
        `That image is ${Math.round(file.size / 1024)} KB — keep it under ${Math.round(
          MAX_CAROUSEL_IMAGE_BYTES / 1024,
        )} KB.`,
      );
      if (fileInput.current) fileInput.current.value = "";
      return;
    }

    setIsBusy(true);
    setError(undefined);
    try {
      // The File goes over as multipart, not as a base64 argument — see the
      // action. It also means no FileReader round-trip in the browser.
      const body = new FormData();
      body.set("slug", slug);
      body.set("image", file);

      const result = await saveModuleCarouselImageAction(body);
      if (result.ok) {
        setPresent(true);
        // The server stamped a new `updatedAt`, but this component won't see it
        // until the router refreshes, so a local timestamp stands in — it only
        // has to differ from what came before.
        setVersion(Date.now().toString());
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
    const result = await removeModuleCarouselImageAction(slug);
    if (result.ok) setPresent(false);
    else setError(result.error);
    setIsBusy(false);
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-line p-3">
      <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-paper">
        {present ? (
          // eslint-disable-next-line @next/next/no-img-element -- DB-backed route, not a static asset next/image can optimize.
          <img
            src={`/api/modules/${encodeURIComponent(slug)}/carousel-image?v=${version}`}
            alt={`${moduleName} carousel graphic`}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="px-1 text-center text-[10px] leading-tight text-muted">
            Using the icon
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">Carousel graphic</p>
        <p className="mt-0.5 text-xs text-muted">
          Shown large on the home screen. PNG, JPEG, WebP or GIF, up to 2&nbsp;MB. Large
          images are downscaled to 800&times;800 and re-encoded as WebP on upload, so a
          big photo is fine. An animated GIF is stored as it is, to keep it moving.
          Without one, the module&apos;s icon is used.
        </p>
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
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
          <Button size="sm" variant="danger" onClick={() => void handleRemove()} disabled={isBusy}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
