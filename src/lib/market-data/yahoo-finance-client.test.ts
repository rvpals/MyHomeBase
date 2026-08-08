// The HTTP adapter, exercised against a stubbed `fetch`. Everything else in this
// module is tested through hand-written fakes; this file exists because two
// specific bugs in the crumb handshake were invisible from that level — both
// failed silently and left an empty list rather than an error.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YahooFinanceClient } from "./yahoo-finance-client";

const CRUMB = "test-crumb-value";
const COOKIE = "A3=d=abc123&s=xyz; Path=/; Domain=.yahoo.com";

interface StubOptions {
  /** Reject the crumb request unless a browser User-Agent is sent. */
  requireUserAgent?: boolean;
}

/** Counts of each endpoint, so a test can assert how often it was called. */
interface StubCounts {
  cupcake: number;
  getcrumb: number;
  quoteSummary: number;
  unauthorized: number;
}

function stubYahoo(options: StubOptions = {}): StubCounts {
  const counts: StubCounts = { cupcake: 0, getcrumb: 0, quoteSummary: 0, unauthorized: 0 };

  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const userAgent = headers.get("User-Agent") ?? "";

    if (url.includes("fc.yahoo.com/cupcake")) {
      counts.cupcake += 1;
      // Yahoo really does answer 404 here; the cookie is the point, not the body.
      return new Response("", { status: 404, headers: { "set-cookie": COOKIE } });
    }

    if (url.includes("/v1/test/getcrumb")) {
      counts.getcrumb += 1;
      if (options.requireUserAgent && !userAgent.includes("Mozilla")) {
        return new Response("Too Many Requests\r\n", { status: 429 });
      }
      return new Response(CRUMB, { status: 200 });
    }

    if (url.includes("/v10/finance/quoteSummary")) {
      counts.quoteSummary += 1;
      const sentCrumb = new URL(url).searchParams.get("crumb");
      // Yahoo pairs the crumb with the cookie it was minted for. A request
      // carrying one without the other is exactly the mismatch the
      // single-flight refresh exists to prevent.
      if (sentCrumb !== CRUMB || !headers.get("Cookie")) {
        counts.unauthorized += 1;
        return Response.json(
          { finance: { result: null, error: { code: "Unauthorized" } } },
          { status: 401 },
        );
      }
      return Response.json({
        quoteSummary: {
          result: [
            {
              earningsHistory: {
                history: [
                  {
                    quarter: { raw: 1_759_190_400 },
                    epsActual: { raw: 1.85 },
                    epsEstimate: { raw: 1.77 },
                  },
                ],
              },
            },
          ],
        },
      });
    }

    // The chart endpoint — no dividends or splits, which is a valid answer.
    return Response.json({ chart: { result: [{ meta: {}, timestamp: [], indicators: {} }] } });
  });

  return counts;
}

beforeEach(() => stubYahoo());
afterEach(() => vi.unstubAllGlobals());

describe("YahooFinanceClient crumb handshake", () => {
  it("sends a browser User-Agent, without which the crumb endpoint 429s", async () => {
    // Restub with the guard switched on: the default undici agent gets thrown out.
    vi.unstubAllGlobals();
    stubYahoo({ requireUserAgent: true });

    const events = await new YahooFinanceClient().getEvents("AAPL", "1y");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "earnings", epsActualCents: 185 });
  });

  it("refreshes the crumb once when several calls race for it", async () => {
    vi.unstubAllGlobals();
    const counts = stubYahoo();
    const client = new YahooFinanceClient();

    // Two quoteSummary-backed reads at once, which is what opening the dialog
    // does. Before the single-flight fix each refreshed the crumb, and the
    // second overwrote the cookie the first was mid-flight with.
    const [first, second] = await Promise.all([
      client.getEvents("AAPL", "1y"),
      client.getEvents("MSFT", "1y"),
    ]);

    expect(counts.getcrumb).toBe(1);
    expect(counts.cupcake).toBe(1);
    expect(counts.unauthorized).toBe(0);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  it("reuses the crumb across later calls instead of refetching it", async () => {
    vi.unstubAllGlobals();
    const counts = stubYahoo();
    const client = new YahooFinanceClient();

    await client.getEvents("AAPL", "1y");
    await client.getEvents("AAPL", "1y");

    expect(counts.getcrumb).toBe(1);
  });

  it("reports no earnings rather than throwing when the provider stays hostile", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/v8/finance/chart")) {
        return Response.json({ chart: { result: [{ meta: {}, timestamp: [], indicators: {} }] } });
      }
      return new Response("nope", { status: 503 });
    });

    // An events strip is a nice-to-have; a dead quoteSummary must not fail the
    // whole request.
    await expect(new YahooFinanceClient().getEvents("AAPL", "1y")).resolves.toEqual([]);
  });
});
