import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getAccountIcon } from "@/lib/investment-accounts";
import { deps } from "@/lib/wiring";

// Serves an investment account's icon. This is the only place the icon bytes are
// read, which is what keeps them out of every account list. Mirrors the
// expense card-image and user-avatar routes.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const { id } = await params;
  const accountId = Number(id);
  if (!Number.isInteger(accountId)) return new NextResponse(null, { status: 400 });

  const icon = getAccountIcon(deps.investmentAccountRepo, accountId);
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
