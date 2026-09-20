import { NextResponse } from "next/server";
import { getMaxUploadBytes, isUploadTooLargeError, uploadDatabaseStream } from "@/lib/sqlite-browser";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "@/app/(protected)/require-access";

// Receives an uploaded SQLite file for the Tools module's file browser.
//
// A route handler rather than a server action, which is the whole point: Next
// caps a server action's body at `serverActions.bodySizeLimit` (4 MB here), so
// the module's own 50 MB cap was unreachable and a larger file died with a
// framework 413 before any of the app's code ran. Raising that limit would
// have applied to every action in the app and still buffered each upload
// whole. A route handler has no such cap and can stream.
//
// The bytes go straight to disk via `saveStream` — never through a Buffer, and
// never through `formData()`, which would spool the whole file into memory
// first and defeat the exercise. The cap is enforced as the stream arrives.
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
    return NextResponse.json({ ok: false, error: "You don't have access to this module." }, { status: 403 });
  }

  // The name rides in a header rather than a form field: a multipart body
  // would have to be parsed to reach the field, and parsing is exactly what
  // this route avoids. `encodeURIComponent` on the client keeps a non-ASCII
  // filename legal in a header.
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
    return NextResponse.json({ ok: false, error: "That file name could not be read." }, { status: 400 });
  }

  try {
    // Read per request, not at module load: an admin changing the limit must
    // take effect on the next upload, not on the next restart.
    const maxBytes = getMaxUploadBytes(deps.moduleRepo, deps.moduleSettingsRepo);

    const created = await uploadDatabaseStream(
      { originalFileName, stream: request.body, uploadedByUserId: currentUser.id },
      { repo: deps.uploadedDatabaseRepo, fileStore: deps.sqliteFileStore, reader: deps.foreignDatabaseReader },
      maxBytes,
    );

    return NextResponse.json({ ok: true, databaseId: created.id });
  } catch (error) {
    // 413 for the size cap so the status matches the failure; everything else
    // here is a rejected file (wrong extension, not really SQLite), which is a
    // 400. Neither is a server fault.
    const status = isUploadTooLargeError(error) ? 413 : 400;
    const message = error instanceof Error ? error.message : "Could not upload that file.";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
