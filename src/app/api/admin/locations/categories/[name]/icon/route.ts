import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getLocationTaxonomyIcon } from "@/lib/sys-locations";
import { deps } from "@/lib/wiring";
import { journalIconResponse } from "../../../../../journal/icon-response";

// Serves an application-wide location category's icon. This is the only place
// the icon bytes are read, which is what keeps them out of every category list.
// Mirrors the journal's location-category-icon route exactly -- see migration
// 0140.
//
// Signed-in rather than admin-only on purpose, matching the journal route: the
// bytes are referenced by <img src> from a rendered page, and a 401 on an icon
// would show a broken image wherever a non-admin screen reuses these places.
//
// The category's name *is* its key, so it arrives URL-encoded in the path; Next
// hands it back decoded.
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const { name } = await params;
  if (name.trim() === "") return new NextResponse(null, { status: 400 });

  const icon = getLocationTaxonomyIcon(deps.sysLocationRepo, "category", name);
  if (!icon) return new NextResponse(null, { status: 404 });

  return journalIconResponse(icon);
}
