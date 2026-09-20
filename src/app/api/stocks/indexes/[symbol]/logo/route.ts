import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getOrFetchIndexLogo } from "@/lib/index-logos";
import { findMarketIndex } from "@/lib/market-indexes";
import { deps } from "@/lib/wiring";

// Serves a market index's icon, downloading and caching it on first request.
// Mirrors the ticker-logo route: the bytes are read here and nowhere else, so
// they never ride along in a page payload.
//
// The symbol is only ever used to *look up a catalogue entry*. An unknown one
// is a 404 and stops there — nothing user-supplied reaches the outbound URL,
// which is what the domain on the catalogue entry is for.
export async function GET(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  const { symbol } = await params;
  const index = findMarketIndex(decodeURIComponent(symbol));
  if (!index) return new NextResponse(null, { status: 404 });

  const logo = await getOrFetchIndexLogo(
    deps.indexLogoRepo,
    deps.indexLogoClient,
    index.symbol,
    index.logoDomain,
  );
  // 404 is the normal answer for an index whose icon couldn't be found; the
  // component then draws its monogram fallback.
  if (!logo) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.mimeType,
      // Index icons essentially never change, and they're behind a session.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
