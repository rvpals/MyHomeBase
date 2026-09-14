import { NextResponse } from "next/server";
import { readBlobCell } from "@/lib/sql-explorer";
import { deps } from "@/lib/wiring";
import { requireAdmin } from "@/app/(protected)/require-access";

// Serves one BLOB cell from the SQL Explorer's grid — the only place those bytes
// are read. The grid itself ships a descriptor per blob (type + size + address),
// never the bytes, so browsing `sys_users` or `mus_albums` costs a few hundred
// bytes a row instead of a file a row. Same rule as the nine curated per-row
// image columns in coding-guide.md, applied to a grid that cannot know its
// columns in advance.
//
// Admin-only, like every other surface of this tool: it reads any column of any
// table, so it is exactly as privileged as the SQL box next to it.
//
// The address arrives in the query string because it is a three-part key
// (table, column, rowid) and none of the three is a path-shaped identifier.
// `readBlobCell` validates all three and the repository resolves the table and
// column against the schema before building any SQL.
export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch {
    return new NextResponse(null, { status: 403 });
  }

  const url = new URL(request.url);
  const tableName = url.searchParams.get("table");
  const columnName = url.searchParams.get("column");
  const rowId = url.searchParams.get("rowid");
  if (!tableName || !columnName || !rowId) return new NextResponse(null, { status: 400 });

  let blob;
  try {
    blob = readBlobCell(deps.sqlExplorerRepo, { tableName, columnName, rowId: Number(rowId) });
  } catch {
    // A name that isn't an identifier, or a table/column that isn't in the
    // schema. Nothing to serve and nothing worth echoing back.
    return new NextResponse(null, { status: 400 });
  }
  if (!blob) return new NextResponse(null, { status: 404 });

  // `?download=1` is what the Save button sends; Preview omits it and gets an
  // inline response the browser can put in an <img>.
  const isDownload = url.searchParams.get("download") === "1";

  return new NextResponse(new Uint8Array(blob.data), {
    headers: {
      // Sniffed from the stored bytes, never taken from the request.
      "Content-Type": blob.mimeType,
      "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="${blob.fileName}"`,
      // An admin tool reading live rows: a cached response could outlive the
      // value it shows, and this is per-admin data either way.
      "Cache-Control": "no-store",
      // These bytes are arbitrary DB content served from the app's own origin.
      // Nothing here should ever be interpreted as a document.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
