import { NextResponse, type NextRequest } from "next/server";

/**
 * Stamps the request path onto a header so the server layout can see it.
 *
 * **This file exists for one reason and should stay that small.** Reading the current
 * URL from a Server Component is not supported — `usePathname` is a client hook, and
 * a layout only ever receives its children. The arrival log needs to fire for the
 * site root and nowhere else, so something upstream has to say which path this is.
 *
 * It deliberately does **not** write the visit itself. This runs on the Edge runtime,
 * which cannot open better-sqlite3, so a database write here is not merely slow — it
 * does not link. The division is: this file identifies the path, and
 * `(protected)/layout.tsx` does the recording where `deps` is reachable.
 *
 * Named `proxy.ts` because that is what Next 16 calls this file; it was `middleware.ts`
 * in earlier versions.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);

  // Overwritten, never appended to: a caller who sends their own x-mhb-path must not
  // be able to make an arbitrary request look like a root arrival in the log.
  headers.set("x-mhb-path", request.nextUrl.pathname);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  /**
   * Every path except Next's own internals, the API routes, and anything with a file
   * extension. The header is only read on a logged-out root render, so a broader
   * matcher would cost work on every static asset for nothing.
   */
  matcher: ["/((?!_next/static|_next/image|api|favicon.ico|.*\\.).*)"],
};
