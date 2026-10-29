import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getTagIcon } from "@/lib/documents";
import { getModuleBySlug } from "@/lib/modules";
import { userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { documentIconResponse } from "../../../icon-response";

// Serves a document tag's icon. This is the only place the icon bytes are read,
// which is what keeps them out of every tag list. Mirrors the journal and expense
// category-icon routes.
//
// The tag's name *is* its key, so it arrives URL-encoded in the path; Next hands
// it back decoded.
//
// Holding the module is required, not merely being signed in — the same gate the pages
// and the attachment routes use. A route handler is its own endpoint; no layout runs
// before it.
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const appModule = getModuleBySlug(deps.moduleRepo, "documents");
  if (!appModule || !userHasModuleAccess(currentUser, appModule.id, deps.userRepo)) {
    return new NextResponse(null, { status: 404 });
  }

  const { name } = await params;
  if (name.trim() === "") return new NextResponse(null, { status: 400 });

  const icon = getTagIcon(deps.documentsRepo, name);
  if (!icon) return new NextResponse(null, { status: 404 });

  return documentIconResponse(icon);
}
