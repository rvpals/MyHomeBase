import { headers } from "next/headers";
import type { AuthEventContext } from "@/lib/auth-events";
import type { SiteVisitContext } from "@/lib/site-visits/types";

/**
 * Gathers the request metadata the audit trail records.
 *
 * Lives in `src/app` rather than `src/lib` because `next/headers` is banned under
 * `src/lib` (ARCHITECTURE.md) — the presentation layer reads the request and hands
 * plain data inward.
 *
 * The IP is the **first** `x-forwarded-for` hop, which is the client as reported by
 * whatever proxy sits in front of the app. Behind the NAS reverse proxy that is only
 * as trustworthy as the proxy: a direct caller can put anything in the header. Treat
 * it as advisory, never as identity.
 */
export async function readAuthEventContext(): Promise<AuthEventContext> {
  const headerList = await headers();

  const forwardedFor = headerList.get("x-forwarded-for");
  const ipAddress =
    forwardedFor?.split(",")[0]?.trim() ||
    headerList.get("x-real-ip")?.trim() ||
    undefined;

  return {
    ipAddress,
    userAgent: headerList.get("user-agent") ?? undefined,
  };
}

/**
 * The same metadata, plus what the arrival log records that the auth log does not.
 *
 * Kept as a second function rather than widening `readAuthEventContext`, because the
 * two feed differently-shaped tables and the auth log has no column for a referer.
 * The IP is read the same way and carries the same warning: first `x-forwarded-for`
 * hop, only as trustworthy as the proxy in front of it, advisory and never identity
 * (migrations/0102).
 *
 * `referer` is blank for a typed URL or a bookmark, which is the common case and not
 * an error. Note the header's historical misspelling — `referer`, one `r` — which is
 * what the wire format actually uses.
 */
export async function readSiteVisitContext(path: string): Promise<SiteVisitContext> {
  const headerList = await headers();

  const forwardedFor = headerList.get("x-forwarded-for");
  const ipAddress =
    forwardedFor?.split(",")[0]?.trim() ||
    headerList.get("x-real-ip")?.trim() ||
    undefined;

  return {
    ipAddress,
    userAgent: headerList.get("user-agent") ?? undefined,
    referer: headerList.get("referer") ?? undefined,
    path,
  };
}
