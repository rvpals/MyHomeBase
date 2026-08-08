import { NextResponse, userAgent, type NextRequest } from "next/server";
import { VIEWPORT_COOKIE, viewportFromUserAgent } from "@/lib/viewport";

// Gives the very first request a layout to render.
//
// Named `proxy.ts`, not `middleware.ts`: Next 16 deprecated the older
// convention and warns about it on every build.
//
// Nothing else in the app can know the viewport before the HTML is sent: the
// pages are server components, so there is no `window` at render time. Reading
// the User-Agent here means a phone gets the compact layout on first paint
// rather than a desktop layout that flips after hydration.
//
// It is only a guess, and deliberately a weak one — it writes the cookie **only
// when there isn't one**, so it can never overrule the width the client
// measured or the layout the reader picked by hand. See src/lib/viewport.
export function proxy(request: NextRequest) {
  const response = NextResponse.next();

  if (!request.cookies.has(VIEWPORT_COOKIE)) {
    const { device } = userAgent(request);
    response.cookies.set(VIEWPORT_COOKIE, viewportFromUserAgent(device.type), {
      path: "/",
      sameSite: "lax",
      // Not httpOnly: the width corrector and the Account toggle both rewrite
      // this from the browser. It carries no secret — just which layout to draw.
      httpOnly: false,
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return response;
}

export const config = {
  // Pages only. Image routes and static assets don't render a layout, and
  // running middleware on them would add a cookie write to every logo request.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
