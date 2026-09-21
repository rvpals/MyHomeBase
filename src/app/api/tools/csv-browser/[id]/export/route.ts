import { NextResponse } from "next/server";
import {
  csvFileIdSchema,
  exportCsvFileText,
  getUploadedCsvFile,
  type CsvFileBrowserDeps,
} from "@/lib/csv-file-browser";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "@/app/(protected)/require-access";

// Streams an uploaded file back out, with every edit and delete applied.
//
// This is the only way edits leave the tool. The uploaded text is never
// rewritten in place (see migrations/0100): the rows live in a SQLite sidecar
// from the moment of import, so "save" means regenerate the file from the
// sidecar in its original delimiter.
//
// A route handler rather than a server action because an action returns a
// value, not a file: there is no way to make a browser download one. It also
// lets the response *stream* — a large export is written a batch at a time
// rather than built whole in memory, matching how the upload arrives.
//
// Guarded with the module's full slug, exactly like the module's actions: this
// is its own GET endpoint and no layout runs before it.

/** The module this endpoint belongs to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "tools";

const browserDeps: CsvFileBrowserDeps = {
  repo: deps.uploadedCsvFileRepo,
  fileStore: deps.csvFileStore,
  tableStore: deps.csvTableStore,
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
  } catch {
    return NextResponse.json(
      { ok: false, error: "You don't have access to this module." },
      { status: 403 },
    );
  }

  const parsedId = csvFileIdSchema.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json({ ok: false, error: "That is not a file id." }, { status: 400 });
  }

  // Read up front for the filename and to fail cleanly: once the stream has
  // started there is no way to turn a failure into a status code, so anything
  // that can be checked beforehand is.
  const file = getUploadedCsvFile(deps.uploadedCsvFileRepo, parsedId.data);
  if (!file) {
    return NextResponse.json(
      { ok: false, error: "That uploaded file is no longer listed." },
      { status: 404 },
    );
  }

  const encoder = new TextEncoder();
  const rows = exportCsvFileText(file.id, browserDeps);

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await rows.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        // A failure mid-stream cannot become a status code — the headers are
        // long gone — so the stream is errored, which the browser surfaces as
        // a failed download rather than a silently truncated file.
        controller.error(error);
      }
    },
    async cancel() {
      // The client hung up. Returning the generator closes the sidecar's
      // connection via its `finally`, which matters on Windows: a connection
      // left open locks the file and the reader could not then delete their
      // own upload.
      await rows.return(undefined);
    },
  });

  return new NextResponse(body, {
    headers: {
      // `text/csv` even for a tab- or pipe-separated export: the delimiter is
      // preserved in the bytes, and this is the type every spreadsheet
      // application will actually open.
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${asciiFileName(file.originalFileName)}"; filename*=UTF-8''${encodeURIComponent(file.originalFileName)}`,
      // The file changes with every edit, so a cached copy would hand back a
      // stale export.
      "Cache-Control": "no-store",
    },
  });
}

/**
 * A fallback filename safe to sit in a quoted `Content-Disposition`.
 *
 * The `filename*=UTF-8''…` parameter beside it carries the real name for every
 * browser that matters; this one exists because the plain `filename=` must
 * still be present and must not contain a quote, a backslash or a non-ASCII
 * byte — any of which makes the whole header unparseable in older clients.
 */
function asciiFileName(name: string): string {
  const cleaned = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return cleaned.length > 0 ? cleaned : "export.csv";
}
