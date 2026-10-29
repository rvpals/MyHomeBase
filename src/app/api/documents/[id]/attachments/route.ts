import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { addAttachment } from "@/lib/documents";
import { getModuleBySlug } from "@/lib/modules";
import { userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { documentFiles, documentLimits } from "@/app/(protected)/modules/[slug]/documents-root";

// Uploads one or more files to a document.
//
// A ROUTE HANDLER, NOT A SERVER ACTION, and that is the whole reason this file exists.
// A server action posts through Next's own encoding with a body limit that defaults to
// 1 MB; raising it is a global config change that would apply to every action in the
// app. A route handler reads a plain multipart form and is the right shape for a
// 25 MB scan. The same reason `api/tools/csv-browser/upload` is a route.
//
// Being signed in is not enough: documents are household paperwork, so the reader must
// hold the module, exactly as the page itself requires. A route handler is its own
// endpoint; no layout runs before it.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const appModule = getModuleBySlug(deps.moduleRepo, "documents");
  if (!appModule || !userHasModuleAccess(currentUser, appModule.id, deps.userRepo)) {
    // 404 rather than 403, so an ungranted module is indistinguishable from one that
    // does not exist — the same choice the pages make.
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  const { id } = await params;
  const documentId = Number(id);
  if (!Number.isInteger(documentId) || documentId <= 0) {
    return NextResponse.json({ ok: false, error: "Bad document id." }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "That upload was not readable." }, { status: 400 });
  }

  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ ok: false, error: "No files were sent." }, { status: 400 });
  }

  const limits = documentLimits();
  const stored: number[] = [];
  const failed: { name: string; error: string }[] = [];

  // Files are stored one at a time and failures are collected rather than thrown. A
  // reader who dropped six files and had one refused for being too large should keep
  // the other five — failing the whole batch would make them re-pick everything.
  for (const file of files) {
    try {
      const attachment = await addAttachment(deps.documentsRepo, documentFiles(), limits, {
        documentId,
        fileName: file.name,
        data: Buffer.from(await file.arrayBuffer()),
      });
      stored.push(attachment.id);
    } catch (error) {
      failed.push({
        name: file.name,
        error: error instanceof Error ? error.message : "Could not store that file.",
      });
    }
  }

  // `ok` reports whether everything landed; `stored` and `failed` say exactly what did
  // and didn't, so the editor can name the ones that were refused.
  return NextResponse.json({ ok: failed.length === 0, stored, failed });
}
