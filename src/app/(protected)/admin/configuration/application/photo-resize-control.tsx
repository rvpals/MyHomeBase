"use client";

import { useEffect, useState, useTransition } from "react";
import {
  loadPhotoResizeSettingAction,
  setPhotoResizeSettingAction,
} from "./photo-resize-actions";

// The server-side photo resize switch, on the Application Configuration page.
//
// No import from `@/lib/journal-photos`: that barrel re-exports
// `SharpPhotoThumbnailRenderer`, which pulls in the `sharp` native binding and cannot be
// bundled for a browser. The actions hand back a plain boolean, so this file needs
// nothing from the library at all. Same trap, and the same rule, as the upload-cap and
// system-log controls beside it.
//
// Writes immediately rather than through the page's Save button -- see the note in
// `photo-resize-actions.ts`.
//
// Phone and desktop: one label-and-checkbox row, which needs no breakpoint. It inherits
// the page's single-column card, exactly like `SystemLogControl` above it.

export function PhotoResizeControl() {
  const [resizeOriginals, setResizeOriginals] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Read once on mount. The setting is not in the admin shell's draft, so there is
  // nothing to receive it as a prop from -- see the actions file.
  useEffect(() => {
    let cancelled = false;
    void loadPhotoResizeSettingAction().then((enabled) => {
      if (cancelled) return;
      setResizeOriginals(enabled);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(enabled: boolean) {
    // Optimistic: the switch moves now and the server confirms. A checkbox that waits
    // for a round trip before moving reads as broken on the NAS.
    setResizeOriginals(enabled);
    startTransition(async () => {
      setResizeOriginals(await setPhotoResizeSettingAction(enabled));
    });
  }

  return (
    <div className="mt-6 border-t border-line pt-5">
      <p className="font-medium text-ink">Photo thumbnails</p>
      <p className="mt-1 text-sm text-muted">
        How the photo viewer&rsquo;s strip gets its small images. The camera&rsquo;s own
        embedded preview is always used when a photo has one &mdash; that is the quick path,
        and this switch never affects it.
      </p>

      <label className="mt-4 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={resizeOriginals}
          disabled={!loaded}
          onChange={(event) => toggle(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brass"
        />
        <span>
          <span className="font-medium text-ink">Resize photos on the server</span>
          <span className="block text-muted">
            For the few photos carrying no embedded preview &mdash; a scan, a screenshot, or
            a file whose metadata was stripped &mdash; shrink the original on the server
            instead of sending it whole. Roughly 2 photos in 700 here. Switch it off if the
            server struggles; those tiles then download at full size, as they did before.
          </span>
        </span>
      </label>

      <p className="mt-3 text-xs text-muted">
        {isPending ? (
          "Saving…"
        ) : (
          <>
            Takes effect on the next thumbnail the server is asked for. Tiles your browser
            has already downloaded stay cached for up to an hour &mdash; reload the viewer
            to see the change sooner.
          </>
        )}
      </p>
    </div>
  );
}
