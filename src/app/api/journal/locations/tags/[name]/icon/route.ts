import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getLocationTaxonomyIcon } from "@/lib/journal-locations";
import { deps } from "@/lib/wiring";
import { journalIconResponse } from "../../../../icon-response";

// Serves a location tag's icon. Same shape and same reasoning as the location
// category route next door — see migration 0105.
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const { name } = await params;
  if (name.trim() === "") return new NextResponse(null, { status: 400 });

  const icon = getLocationTaxonomyIcon(deps.savedLocationRepo, "tag", name);
  if (!icon) return new NextResponse(null, { status: 404 });

  return journalIconResponse(icon);
}
