import { NextResponse } from "next/server";
import { getAppVersion } from "@/lib/app-version";
import { deps } from "@/lib/wiring";

// The build this server is currently serving.
//
// This is the one endpoint in the app that must never be cached anywhere, by
// anyone: its entire purpose is to be the fresh answer a stale client compares
// itself against. A cached response here would defeat the feature completely.
//
// No session check, unlike the other API routes. It returns a build hash and
// nothing else -- no household data -- and the client that most needs it is one
// whose session may have expired while the app sat suspended. Gating it would
// mean the update prompt stops working exactly when the app is most stale.
export function GET() {
  const version = getAppVersion(deps.buildIdRepo);

  return NextResponse.json(version, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      // For the DSM reverse proxy and any intermediary that still honours the
      // HTTP/1.0 header rather than Cache-Control.
      Pragma: "no-cache",
    },
  });
}
