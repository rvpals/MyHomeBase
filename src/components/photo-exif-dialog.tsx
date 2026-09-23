"use client";

// The EXIF panel: everything a photograph's header says about itself, in three tabs.
//
// Common / GPS / Misc, because the lib already sorts every tag into one of those three
// groups -- see `exif-tags.ts`. The split is there so the twenty rows a person actually
// wants (which camera, which settings, when) are not buried under the hundred a modern
// phone writes.
//
// Pure presentation. The rows arrive already named and already formatted ("1/125",
// "f/2.8") because deciding that a rational is a shutter fraction is EXIF knowledge, and
// EXIF knowledge lives in `src/lib/`. This file lays out what it is handed.

import { useState } from "react";
import { Modal } from "@/components/modal";
import { PhotoMapDialog } from "@/components/photo-map-dialog";
import { Tabs, type TabItem } from "@/components/tabs";
import type { ExifGpsFix, ExifTag, ExifTagGroup } from "@/lib/journal-photos";

export interface PhotoExifDialogProps {
  /** Every tag read from the photograph, in any order. */
  tags: ExifTag[];
  /** The photo's caption or file name, for the sub-heading. */
  photoLabel: string;
  /**
   * The decimal position, when the GPS block held a usable fix.
   *
   * Drives the GPS tab's **Map** button and nothing else -- the tab's TABLE shows the
   * stored values verbatim. Absent for the many photos whose GPS block is missing or
   * holds only a version tag.
   */
  gps?: ExifGpsFix;
  onClose: () => void;
}

/** The tabs, in the order they read. */
const GROUPS: { group: ExifTagGroup; label: string }[] = [
  { group: "common", label: "Common" },
  { group: "gps", label: "GPS" },
  { group: "misc", label: "Misc" },
];

/**
 * Everything one photograph's EXIF block holds.
 *
 * All three tabs are ALWAYS rendered, even when empty. A tab strip whose tabs appeared
 * and vanished as the reader arrowed between photographs would move the one they were
 * aiming at, and "this photo has no GPS" is itself an answer worth showing.
 */
export function PhotoExifDialog({ tags, photoLabel, gps, onClose }: PhotoExifDialogProps) {
  const [isMapOpen, setIsMapOpen] = useState(false);

  const items: TabItem[] = GROUPS.map(({ group, label }) => {
    const rows = tags.filter((tag) => tag.group === group);

    return {
      key: group,
      // The count in the label, because "Misc" on a phone photograph means something
      // very different (120 rows) from "Misc" on a scan (2), and the reader deserves
      // to know which before clicking.
      label: rows.length === 0 ? label : `${label} (${rows.length})`,
      content:
        group === "gps" ? (
          <GpsTab rows={rows} gps={gps} onShowMap={() => setIsMapOpen(true)} />
        ) : (
          <TagTable rows={rows} emptyMessage={emptyMessageFor(group)} />
        ),
    };
  });

  return (
    <>
      <Modal title="EXIF data" description={photoLabel} size="lg" onClose={onClose}>
        <Tabs items={items} />
      </Modal>

      {/* Stacked over the EXIF dialog rather than replacing it: the reader came from
          the GPS tab and closing the map should put them back on it. */}
      {isMapOpen && gps !== undefined && (
        <PhotoMapDialog
          latitude={gps.latitude}
          longitude={gps.longitude}
          altitude={gps.altitude}
          photoLabel={photoLabel}
          onClose={() => setIsMapOpen(false)}
        />
      )}
    </>
  );
}

function emptyMessageFor(group: ExifTagGroup): string {
  if (group === "common") {
    return "This photograph carries no camera metadata. Scans, screenshots and images re-saved by an editor usually don't.";
  }
  return "Nothing else in this photograph's header.";
}

/**
 * The GPS tab: the stored values, and a way to see them on a map.
 *
 * The table shows what the file HOLDS -- degrees, minutes, seconds and a hemisphere
 * letter, exactly as written. The decimal pair the map needs is derived, and deliberately
 * not substituted here: a reader comparing this against another tool should see the same
 * numbers that tool reads out of the file.
 */
function GpsTab({
  rows,
  gps,
  onShowMap,
}: {
  rows: ExifTag[];
  gps?: ExifGpsFix;
  onShowMap: () => void;
}) {
  return (
    <div className="space-y-3">
      {gps !== undefined && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper px-3 py-2">
          <p className="text-sm text-muted">
            This photograph records where it was taken.
          </p>
          <button
            type="button"
            onClick={onShowMap}
            className="shrink-0 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            Map
          </button>
        </div>
      )}

      <TagTable
        rows={rows}
        emptyMessage="No GPS data in this photograph."
      />

      {/* A GPS block with tags but no usable fix is common -- a phone with location
          off still writes a version tag. Saying so beats leaving the reader to wonder
          why there is no Map button above a populated table. */}
      {gps === undefined && rows.length > 0 && (
        <p className="text-sm text-muted">
          The GPS block holds no usable position, so there is nothing to map.
        </p>
      )}
    </div>
  );
}

/**
 * One tab's rows.
 *
 * Scrolls rather than paginating or capping: Misc genuinely runs to a hundred-odd rows
 * on a modern phone photograph, and a reader looking for one vendor tag wants it
 * present, not behind a "show more".
 */
function TagTable({ rows, emptyMessage }: { rows: ExifTag[]; emptyMessage: string }) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">{emptyMessage}</p>;
  }

  return (
    <div className="max-h-[26rem] overflow-y-auto max-lg:max-h-[18rem]">
      <table className="w-full border-collapse text-sm">
        <tbody>
          {rows.map((tag) => (
            <tr
              key={`${tag.source}-${tag.id}`}
              className="border-b border-line last:border-0 align-top"
            >
              <th
                scope="row"
                className="w-2/5 py-2 pr-3 text-left font-medium text-muted"
              >
                {tag.name}
              </th>
              {/* `break-words` rather than truncation: a lens name or a serial number
                  is long and is exactly the kind of thing being looked up. */}
              <td className="py-2 font-mono text-ink break-words">{tag.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
