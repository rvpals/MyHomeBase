import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getCategoryIcon } from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { journalIconResponse } from "../../../icon-response";

// Serves a journal category's icon. This is the only place the icon bytes are
// read, which is what keeps them out of every category list. Mirrors the
// expense-category-icon route.
//
// The category's name *is* its key, so it arrives URL-encoded in the path; Next
// hands it back decoded.
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const { name } = await params;
  if (name.trim() === "") return new NextResponse(null, { status: 400 });

  const icon = getCategoryIcon(deps.journalRepo, name);
  if (!icon) return new NextResponse(null, { status: 404 });

  return journalIconResponse(icon);
}
