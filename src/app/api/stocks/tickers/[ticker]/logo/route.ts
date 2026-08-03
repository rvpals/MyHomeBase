import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getOrFetchTickerLogo, isValidTicker } from "@/lib/ticker-logos";
import { deps } from "@/lib/wiring";

// Serves a ticker's logo, downloading and caching it on first request. This is
// the only place the bytes are read, which is what keeps them out of every page
// payload. Mirrors the user-avatar and card-image routes.
export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const { ticker } = await params;
  // Rejected here as well as in the use-case: this value reaches an outbound URL.
  if (!isValidTicker(ticker)) return new NextResponse(null, { status: 400 });

  const logo = await getOrFetchTickerLogo(deps.tickerLogoRepo, deps.tickerLogoClient, ticker);
  // 404 is the normal answer for a ticker with no artwork; the component then
  // draws its monogram fallback.
  if (!logo) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.mimeType,
      // Logos essentially never change, and they're behind a session.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
