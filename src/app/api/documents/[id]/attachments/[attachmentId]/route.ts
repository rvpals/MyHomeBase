import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { isInlineRenderable, readAttachment } from "@/lib/documents";
import { getModuleBySlug } from "@/lib/modules";
import { userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { documentFiles } from "@/app/(protected)/modules/[slug]/documents-root";

// Serves one attachment, read from the document folder on the NAS. The only place a
// document's file bytes are read, which keeps them out of every document list.
//
// Mirrors the HSA receipt route, with one addition: what may render INLINE is decided
// by `isInlineRenderable`, not by the stored mime type alone. Only images and PDFs
// render in place; everything else — including SVG, which is a document that can carry
// script — is sent as a download. These bytes come back from our own origin, so a
// stored file that the browser renders as markup would be XSS with a file picker in
// front of it.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const appModule = getModuleBySlug(deps.moduleRepo, "documents");
  if (!appModule || !userHasModuleAccess(currentUser, appModule.id, deps.userRepo)) {
    return new NextResponse(null, { status: 404 });
  }

  const { id, attachmentId } = await params;
  const documentId = Number(id);
  const fileId = Number(attachmentId);
  if (!Number.isInteger(documentId) || documentId <= 0) return new NextResponse(null, { status: 400 });
  if (!Number.isInteger(fileId) || fileId <= 0) return new NextResponse(null, { status: 400 });

  // 404 too when the row exists but the file is gone from the folder (moved or deleted
  // by hand) — there is nothing to serve, and the document still lists its name.
  const result = await readAttachment(deps.documentsRepo, documentFiles(), fileId);
  if (!result) return new NextResponse(null, { status: 404 });

  // The attachment must belong to the document in the URL. Without this check the
  // document id would be decoration and any attachment would be reachable under any
  // document — which matters the moment a document is ever restricted.
  if (result.attachment.documentId !== documentId) return new NextResponse(null, { status: 404 });

  const disposition = isInlineRenderable(result.attachment.mimeType) ? "inline" : "attachment";

  return new NextResponse(new Uint8Array(result.data), {
    headers: {
      "Content-Type": result.attachment.mimeType,
      // The name a "save as" offers is the one the reader recognises, not the
      // sanitised name on disk.
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(result.attachment.originalName)}`,
      // Served from our own origin: never let a browser re-interpret the bytes.
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}
