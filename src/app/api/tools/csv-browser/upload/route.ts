import { NextResponse } from "next/server";
import {
  importCsvFileStream,
  isCsvDelimiter,
  isCsvUploadTooLargeError,
  type CsvImportOptionsInput,
} from "@/lib/csv-file-browser";
import { getMaxUploadBytes } from "@/lib/sqlite-browser";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "@/app/(protected)/require-access";

// Receives an uploaded delimited text file for the Tools module's CSV browser.
//
// A route handler rather than a server action, for the two reasons the SQLite
// browser's upload documents at length: Next caps a server action's body at
// `serverActions.bodySizeLimit` (4 MB here), so the module's own cap would be
// unreachable and a larger file would die with a framework 413 before any app
// code ran; and a route handler can stream the body to disk instead of
// buffering it whole.
//
// Guarded with the module's full slug, exactly like the module's actions: this
// is a write endpoint of its own and no layout runs before it.

/** The module this endpoint belongs to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "tools";

export async function POST(request: Request) {
  let currentUser;
  try {
    currentUser = await requireModuleAccess(ACCESS_MODULE_SLUG);
  } catch {
    return NextResponse.json(
      { ok: false, error: "You don't have access to this module." },
      { status: 403 },
    );
  }

  // The name and the import options ride in headers rather than form fields: a
  // multipart body would have to be parsed to reach them, and parsing is
  // exactly what this route avoids. `encodeURIComponent` on the client keeps a
  // non-ASCII filename legal in a header.
  const rawName = request.headers.get("x-upload-filename");
  if (!rawName) {
    return NextResponse.json({ ok: false, error: "No file name was sent." }, { status: 400 });
  }
  if (!request.body) {
    return NextResponse.json({ ok: false, error: "No file was uploaded." }, { status: 400 });
  }

  let originalFileName: string;
  try {
    originalFileName = decodeURIComponent(rawName);
  } catch {
    return NextResponse.json(
      { ok: false, error: "That file name could not be read." },
      { status: 400 },
    );
  }

  try {
    // Read per request, not at module load: an admin changing the limit must
    // take effect on the next upload, not on the next restart. The cap is the
    // Tools module's one setting, shared with the SQLite browser.
    const maxBytes = getMaxUploadBytes(deps.moduleRepo, deps.moduleSettingsRepo);

    const created = await importCsvFileStream(
      {
        originalFileName,
        stream: request.body,
        uploadedByUserId: currentUser.id,
        options: readImportOptions(request),
      },
      {
        repo: deps.uploadedCsvFileRepo,
        fileStore: deps.csvFileStore,
        tableStore: deps.csvTableStore,
      },
      maxBytes,
    );

    return NextResponse.json({ ok: true, fileId: created.id });
  } catch (error) {
    // 413 for the size cap so the status matches the failure; everything else
    // here is a rejected file (wrong extension, empty, nothing parseable),
    // which is a 400. Neither is a server fault.
    const status = isCsvUploadTooLargeError(error) ? 413 : 400;
    const message = error instanceof Error ? error.message : "Could not upload that file.";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

/**
 * The reader's overrides, if they set any.
 *
 * Both are optional. Absent — or unreadable — means "work it out for me": the
 * delimiter is sniffed and a header row assumed, which is the same path a
 * client that sends no headers at all takes.
 */
function readImportOptions(request: Request): CsvImportOptionsInput {
  // The delimiter travels URL-encoded because a raw tab is not legal in a
  // header value.
  const raw = request.headers.get("x-upload-delimiter");
  const decoded = raw === null ? undefined : safeDecode(raw);
  const headerRow = request.headers.get("x-upload-header-row");

  return {
    // Narrowed with the module's own guard rather than cast: the header is
    // caller-supplied text, and `isCsvDelimiter` is the same check the schema
    // applies. Anything else is dropped, so the delimiter is sniffed instead —
    // a garbled header should not fail an otherwise good upload.
    delimiter: decoded !== undefined && isCsvDelimiter(decoded) ? decoded : undefined,
    hasHeaderRow: headerRow === null ? true : headerRow === "1",
  };
}

/** A header value that may or may not be percent-encoded. */
function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
