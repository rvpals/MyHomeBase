import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getCategoryIcon } from "@/lib/expense";
import { deps } from "@/lib/wiring";

// Serves an expense category's icon. This is the only place the icon bytes are
// read, which is what keeps them out of every category list. Mirrors the
// card-image and user-avatar routes.
//
// The category's name *is* its key, so it arrives URL-encoded in the path; Next
// hands it back decoded.
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const { name } = await params;
  if (name.trim() === "") return new NextResponse(null, { status: 400 });

  const icon = getCategoryIcon(deps.expenseRepo, name);
  if (!icon) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(icon.data), {
    headers: {
      "Content-Type": icon.mimeType,
      // Private: it's behind a session. Short max-age so a replaced icon shows up
      // quickly; callers also add a ?v= cache-buster from updatedAt.
      "Cache-Control": "private, max-age=300",
    },
  });
}
