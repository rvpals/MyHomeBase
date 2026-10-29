import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { buildDocumentArchive } from "@/lib/documents";
import { getModuleBySlug } from "@/lib/modules";
import { userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { documentFiles } from "@/app/(protected)/modules/[slug]/documents-root";

// Every attachment of one document, as a single zip.
//
// Built on demand rather than stored. Keeping a `.zip` on the share was considered and
// deliberately rejected: it would mean each file stopped being individually
// downloadable, and editing attachments would become unpack-modify-repack instead of
// an add or a remove. The archive is cheap to rebuild and always matches what is
// actually attached.
//
// A missing file is skipped rather than fatal — a reader asking for everything should
// get what is there. The response names what was skipped in a header, so the browser
// still receives a usable file instead of an error page.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const appModule = getModuleBySlug(deps.moduleRepo, "documents");
  if (!appModule || !userHasModuleAccess(currentUser, appModule.id, deps.userRepo)) {
    return new NextResponse(null, { status: 404 });
  }

  const { id } = await params;
  const documentId = Number(id);
  if (!Number.isInteger(documentId) || documentId <= 0) return new NextResponse(null, { status: 400 });

  let archive;
  try {
    archive = await buildDocumentArchive(deps.documentsRepo, documentFiles(), documentId);
  } catch (error) {
    // The one genuine failure worth reporting in words: the set is too large to zip,
    // or no folder is configured. Plain text so a direct navigation shows the reason.
    return new NextResponse(error instanceof Error ? error.message : "Could not build that download.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Undefined means the document is gone, or holds no attachments at all — in both
  // cases there is nothing to download.
  if (!archive) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(archive.data), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(archive.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      // Named so the screen can say "two files could not be found" after the download
      // starts. Encoded, because a file name may hold non-ASCII and a raw header value
      // would be rejected.
      ...(archive.missing.length > 0
        ? { "X-Missing-Files": encodeURIComponent(archive.missing.join(", ")) }
        : {}),
      // Never cached: the set of attachments changes, and a stale zip is worse than a
      // slow one.
      "Cache-Control": "no-store",
    },
  });
}
