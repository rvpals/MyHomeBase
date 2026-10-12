import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getLocationTaxonomyIcon } from "@/lib/sys-locations";
import { deps } from "@/lib/wiring";
import { journalIconResponse } from "../../../../../journal/icon-response";

// Serves an application-wide location tag's icon. Same shape as the category
// route beside it -- see migration 0140.
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const { name } = await params;
  if (name.trim() === "") return new NextResponse(null, { status: 400 });

  const icon = getLocationTaxonomyIcon(deps.sysLocationRepo, "tag", name);
  if (!icon) return new NextResponse(null, { status: 404 });

  return journalIconResponse(icon);
}
