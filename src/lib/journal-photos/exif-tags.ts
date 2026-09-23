// The names and grouping behind the viewer's EXIF panel.
//
// A LOOKUP TABLE, not a parser: `exif-all.ts` walks the bytes and asks this file what a
// tag is called, which group it belongs in, and how its raw value should read. Keeping
// those three answers together is what stops the table and the tab strip disagreeing --
// a tag is named and placed in one entry, or it is neither.
//
// Pure data and pure functions. No bytes, no filesystem.

/** Which tab of the EXIF panel a tag belongs on. */
export type ExifTagGroup = "common" | "gps" | "misc";

/** Which IFD a tag was read from — the panel does not show this, but tests assert it. */
export type ExifTagSource = "ifd0" | "exif" | "gps";

/**
 * One row of the EXIF panel.
 *
 * `value` is ALREADY FORMATTED for display — `"1/125"`, `"f/2.8"`, `"ISO 400"`. The
 * formatting happens in the lib rather than the component because it is knowledge about
 * EXIF (a rational is a fraction, an aperture is an f-number), not knowledge about
 * layout, and `src/components/` is presentation only.
 *
 * `raw` keeps what the file actually held, so the GPS tab can show coordinates exactly
 * as stored — which is what Min asked for — while the map still gets a number to pin.
 */
export interface ExifTag {
  /** The numeric tag id, e.g. `0x9003`. Kept so an unnamed tag can show its id. */
  id: number;
  /** The spec's name, or `Tag 0x…` when this table does not know it. */
  name: string;
  /** Formatted for reading. */
  value: string;
  /** The unformatted value, as the file held it. */
  raw: string;
  group: ExifTagGroup;
  source: ExifTagSource;
}

/**
 * How a tag is presented: its name, its tab, and an optional formatter.
 *
 * The formatter takes the already-decoded value (a number, a string, or an array of
 * numbers for a rational) and returns display text. Omitted means "show it as decoded",
 * which is right for a make, a model or a plain count.
 */
interface TagSpec {
  name: string;
  group: ExifTagGroup;
  format?: (value: ExifValue) => string;
}

/** What a tag decodes to before formatting. */
export type ExifValue = string | number | number[];

// ---------------------------------------------------------------------------
// Formatters. Each is the EXIF spec's own meaning for a coded value -- a reader
// looking at "3" learns nothing, and "Auto bracket" is the same fact made legible.
// ---------------------------------------------------------------------------

function asNumber(value: ExifValue): number | undefined {
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value[0];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * An exposure time as a photographer writes it.
 *
 * Under a second becomes a reciprocal fraction (`1/125`), because that is what is on
 * the dial and `0.008` is not. A second or longer stays decimal (`2.5s`), since `5/2`
 * would be unreadable.
 */
function formatExposureTime(value: ExifValue): string {
  const seconds = asNumber(value);
  if (seconds === undefined || seconds <= 0) return String(value);
  if (seconds >= 1) return `${trimNumber(seconds)}s`;
  return `1/${Math.round(1 / seconds)}`;
}

function formatFNumber(value: ExifValue): string {
  const number = asNumber(value);
  return number === undefined ? String(value) : `f/${trimNumber(number)}`;
}

function formatIso(value: ExifValue): string {
  const number = asNumber(value);
  return number === undefined ? String(value) : `ISO ${number}`;
}

function formatFocalLength(value: ExifValue): string {
  const number = asNumber(value);
  return number === undefined ? String(value) : `${trimNumber(number)} mm`;
}

function formatPixels(value: ExifValue): string {
  const number = asNumber(value);
  return number === undefined ? String(value) : `${number} px`;
}

function formatExposureBias(value: ExifValue): string {
  const number = asNumber(value);
  if (number === undefined) return String(value);
  if (number === 0) return "0 EV";
  return `${number > 0 ? "+" : ""}${trimNumber(number)} EV`;
}

/** Drops a trailing `.0` so `2.8` and `50` both read naturally. */
function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

/** Builds a formatter that maps coded numbers to the spec's words. */
function coded(labels: Record<number, string>): (value: ExifValue) => string {
  return (value) => {
    const number = asNumber(value);
    if (number === undefined) return String(value);
    return labels[number] ?? `Unknown (${number})`;
  };
}

const ORIENTATIONS: Record<number, string> = {
  1: "Normal",
  2: "Mirrored horizontally",
  3: "Rotated 180°",
  4: "Mirrored vertically",
  5: "Mirrored horizontally, rotated 270°",
  6: "Rotated 90° clockwise",
  7: "Mirrored horizontally, rotated 90°",
  8: "Rotated 270° clockwise",
};

const FLASH_FIRED: Record<number, string> = {
  0x00: "Did not fire",
  0x01: "Fired",
  0x05: "Fired, return not detected",
  0x07: "Fired, return detected",
  0x08: "On, did not fire",
  0x09: "On, fired",
  0x10: "Off, did not fire",
  0x18: "Off, did not fire, return not detected",
  0x19: "Auto, fired",
  0x20: "No flash function",
  0x41: "Fired, red-eye reduction",
  0x49: "On, fired, red-eye reduction",
  0x59: "Auto, fired, red-eye reduction",
};

// ---------------------------------------------------------------------------
// The table. `common` is what a person looking at a photograph actually wants --
// which camera, which settings, when. Everything named but uninteresting, and
// everything unnamed, falls to `misc`.
// ---------------------------------------------------------------------------

const TAG_SPECS: Record<number, TagSpec> = {
  // --- Common: the camera and the shot ---
  0x010f: { name: "Camera make", group: "common" },
  0x0110: { name: "Camera model", group: "common" },
  0xa434: { name: "Lens model", group: "common" },
  0x0112: { name: "Orientation", group: "common", format: coded(ORIENTATIONS) },
  0x9003: { name: "Date taken", group: "common" },
  0x9004: { name: "Date digitised", group: "common" },
  0x0132: { name: "Date modified", group: "common" },
  0x829a: { name: "Exposure time", group: "common", format: formatExposureTime },
  0x829d: { name: "F-number", group: "common", format: formatFNumber },
  0x8827: { name: "ISO speed", group: "common", format: formatIso },
  0x920a: { name: "Focal length", group: "common", format: formatFocalLength },
  0x9209: { name: "Flash", group: "common", format: coded(FLASH_FIRED) },
  0x9204: { name: "Exposure bias", group: "common", format: formatExposureBias },
  0xa002: { name: "Image width", group: "common", format: formatPixels },
  0xa003: { name: "Image height", group: "common", format: formatPixels },
  0x8298: { name: "Copyright", group: "common" },
  0x013b: { name: "Artist", group: "common" },
  0x010e: { name: "Description", group: "common" },
  0x9286: { name: "User comment", group: "common" },
  0x0131: { name: "Software", group: "common" },

  // --- GPS: its own IFD, its own tab ---
  0x0000: { name: "GPS version", group: "gps" },
  0x0001: { name: "Latitude reference", group: "gps" },
  0x0002: { name: "Latitude", group: "gps" },
  0x0003: { name: "Longitude reference", group: "gps" },
  0x0004: { name: "Longitude", group: "gps" },
  0x0005: { name: "Altitude reference", group: "gps" },
  0x0006: { name: "Altitude", group: "gps" },
  0x0007: { name: "GPS time (UTC)", group: "gps" },
  0x0008: { name: "GPS satellites", group: "gps" },
  0x0009: { name: "GPS status", group: "gps" },
  0x000a: { name: "GPS measure mode", group: "gps" },
  0x000b: { name: "GPS DOP", group: "gps" },
  0x000c: { name: "Speed reference", group: "gps" },
  0x000d: { name: "Speed", group: "gps" },
  0x0010: { name: "Image direction reference", group: "gps" },
  0x0011: { name: "Image direction", group: "gps" },
  0x0012: { name: "Geodetic survey data", group: "gps" },
  0x001d: { name: "GPS date", group: "gps" },
  0x001f: { name: "Positioning error", group: "gps" },

  // --- Misc: named, but not what anyone opens the panel for ---
  0x011a: { name: "X resolution", group: "misc" },
  0x011b: { name: "Y resolution", group: "misc" },
  0x0128: { name: "Resolution unit", group: "misc" },
  0x0213: { name: "YCbCr positioning", group: "misc" },
  0x9201: { name: "Shutter speed value", group: "misc" },
  0x9202: { name: "Aperture value", group: "misc" },
  0x9205: { name: "Max aperture value", group: "misc" },
  0x9206: { name: "Subject distance", group: "misc" },
  0x9207: { name: "Metering mode", group: "misc" },
  0x9208: { name: "Light source", group: "misc" },
  0x8822: { name: "Exposure program", group: "misc" },
  0x9000: { name: "Exif version", group: "misc" },
  0xa000: { name: "Flashpix version", group: "misc" },
  0xa001: { name: "Colour space", group: "misc" },
  0xa402: { name: "Exposure mode", group: "misc" },
  0xa403: { name: "White balance", group: "misc" },
  0xa404: { name: "Digital zoom ratio", group: "misc" },
  0xa405: { name: "Focal length (35mm)", group: "misc" },
  0xa406: { name: "Scene capture type", group: "misc" },
  0xa408: { name: "Contrast", group: "misc" },
  0xa409: { name: "Saturation", group: "misc" },
  0xa40a: { name: "Sharpness", group: "misc" },
  0xa40c: { name: "Subject distance range", group: "misc" },
  0xa420: { name: "Unique image ID", group: "misc" },
  0xa430: { name: "Camera owner", group: "misc" },
  0xa431: { name: "Body serial number", group: "misc" },
  0xa432: { name: "Lens specification", group: "misc" },
  0xa433: { name: "Lens make", group: "misc" },
  0xa435: { name: "Lens serial number", group: "misc" },
  0x9290: { name: "Subsecond time", group: "misc" },
  0x9291: { name: "Subsecond time (original)", group: "misc" },
  0x9292: { name: "Subsecond time (digitised)", group: "misc" },
  0x8830: { name: "Sensitivity type", group: "misc" },
  0x8832: { name: "Recommended exposure index", group: "misc" },
  0x9101: { name: "Components configuration", group: "misc" },
  0x9102: { name: "Compressed bits per pixel", group: "misc" },
  0x0100: { name: "Image width (IFD)", group: "misc" },
  0x0101: { name: "Image height (IFD)", group: "misc" },
  0x0102: { name: "Bits per sample", group: "misc" },
  0x0103: { name: "Compression", group: "misc" },
  0x0106: { name: "Photometric interpretation", group: "misc" },
  0x0201: { name: "Thumbnail offset", group: "misc" },
  0x0202: { name: "Thumbnail length", group: "misc" },
  0xa500: { name: "Gamma", group: "misc" },
};

/**
 * Tag ids that are POINTERS to another IFD rather than data.
 *
 * Excluded from the panel entirely: a row reading "Exif sub-IFD — 214" tells a reader
 * nothing and the tags it points at are already listed on their own.
 */
export const EXIF_POINTER_TAGS = new Set([0x8769, 0x8825, 0xa005, 0x014a, 0x02bc]);

/**
 * How one tag should be presented.
 *
 * GPS is resolved against the GPS table rather than the main one, because the GPS IFD
 * REUSES LOW TAG IDS -- `0x0002` is Latitude there and Image height in IFD0. Passing
 * the source is what keeps those apart; without it a photo with coordinates would show
 * a latitude labelled as a bits-per-sample.
 */
export function describeExifTag(
  id: number,
  source: ExifTagSource,
): { name: string; group: ExifTagGroup; format?: (value: ExifValue) => string } {
  const spec = TAG_SPECS[id];

  if (source === "gps") {
    // Only a spec that actually claims the gps group applies here; anything else is a
    // collision with an IFD0 id of the same number.
    if (spec !== undefined && spec.group === "gps") return spec;
    return { name: hexName(id), group: "gps" };
  }

  // A gps-group spec reached from IFD0 or the Exif IFD is the same collision in reverse.
  if (spec === undefined || spec.group === "gps") {
    return { name: spec?.group === "gps" ? hexName(id) : (spec?.name ?? hexName(id)), group: "misc" };
  }

  return spec;
}

/** The display name for a tag this table does not know. */
export function hexName(id: number): string {
  return `Tag 0x${id.toString(16).padStart(4, "0")}`;
}

/** Applies a tag's formatter, falling back to the decoded value as text. */
export function formatExifValue(
  value: ExifValue,
  format?: (value: ExifValue) => string,
): string {
  if (format !== undefined) return format(value);
  if (Array.isArray(value)) return value.map(trimNumber).join(", ");
  if (typeof value === "number") return trimNumber(value);
  return value;
}
