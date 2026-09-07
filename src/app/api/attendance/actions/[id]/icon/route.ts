import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getStudentActionIcon } from "@/lib/attendance";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { deps } from "@/lib/wiring";

// Serves a student action's uploaded icon. This is the only place the icon bytes
// are read, which is what keeps them out of every action picker and register.
// Mirrors the investment-account, expense-category and journal-taxonomy icon routes.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  const actionId = Number(id);
  if (!Number.isInteger(actionId)) return new NextResponse(null, { status: 400 });

  const icon = getStudentActionIcon(deps.attendanceRepo, actionId);
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
