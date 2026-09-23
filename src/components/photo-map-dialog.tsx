"use client";

// Where a photograph was taken, on a map.
//
// Opened from the EXIF panel's GPS tab, which is the only place that knows whether a
// photograph HAS coordinates -- so this component takes a position rather than a photo
// and never has to render an "unknown location" state.
//
// The map itself is `LocationMap`, the same one the Journal's locations use. Loaded
// through `next/dynamic` with `ssr: false` because Leaflet touches `window` at module
// scope; that is a rule of the component, not a choice here.

import dynamic from "next/dynamic";
import { Modal } from "@/components/modal";

const LocationMap = dynamic(
  () => import("@/components/location-map").then((module) => module.LocationMap),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-80 place-items-center rounded-md border border-line text-sm text-muted">
        Loading map…
      </div>
    ),
  },
);

export interface PhotoMapDialogProps {
  /** Decimal degrees, as `readAllExifTags` derived them from the GPS block. */
  latitude: number;
  longitude: number;
  /** The photo's caption or file name, for the dialog's sub-heading. */
  photoLabel: string;
  /** Metres above sea level, when the photograph recorded one. */
  altitude?: number;
  onClose: () => void;
}

/**
 * A modal map with one pin.
 *
 * `size="lg"` rather than a full-bleed sheet: a map wants room, but the photograph is
 * still on the stage behind this and the reader is coming straight back to it.
 */
export function PhotoMapDialog({
  latitude,
  longitude,
  photoLabel,
  altitude,
  onClose,
}: PhotoMapDialogProps) {
  const position = { latitude, longitude };

  return (
    <Modal
      title="Where this was taken"
      description={photoLabel}
      size="lg"
      onClose={onClose}
    >
      <div className="space-y-3">
        {/* `marker` pins it, `center` puts the view on it, and NO `onPick` -- which is
            what makes the map read-only. A click here must not look like it moved
            anything: the coordinates come out of the photograph's own header. */}
        <LocationMap
          marker={position}
          center={position}
          heightClassName="h-[28rem] max-lg:h-64"
        />

        {/* The numbers as well as the pin. A reader copying coordinates into another
            tool needs the text, and the decimal pair is what every other tool takes. */}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Latitude</dt>
          <dd className="font-mono text-ink">{latitude}</dd>
          <dt className="text-muted">Longitude</dt>
          <dd className="font-mono text-ink">{longitude}</dd>
          {altitude !== undefined && (
            <>
              <dt className="text-muted">Altitude</dt>
              <dd className="font-mono text-ink">{Math.round(altitude)} m</dd>
            </>
          )}
        </dl>
      </div>
    </Modal>
  );
}
