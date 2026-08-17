import { headers } from "next/headers";
import type { AuthEventContext } from "@/lib/auth-events";

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
