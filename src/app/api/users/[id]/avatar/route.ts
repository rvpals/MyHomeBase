import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getUserAvatar } from "@/lib/user";
import { deps } from "@/lib/wiring";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) return new NextResponse(null, { status: 400 });

  const avatar = getUserAvatar(userId, deps.userRepo);
  if (!avatar) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(avatar.data), {
    headers: {
      "Content-Type": avatar.mimeType,
      "Cache-Control": "private, max-age=300",
    },
  });
}
