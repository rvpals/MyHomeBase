import { describe, expect, it } from "vitest";
import {
  SUSPICION_THRESHOLDS,
  describeSignal,
  describeSuspicion,
  levelFromSignals,
  scoreSuspicion,
} from "./suspicion";
import type { IpHistory, SiteVisitContext } from "./types";

/** A history with nothing interesting in it. Override one field per test. */
function history(overrides: Partial<IpHistory> = {}): IpHistory {
  return {
    allowlisted: false,
    recentVisits: 0,
    totalVisits: 1,
    authAttempts: 0,
    authFailures: 0,
    ...overrides,
  };
}

const BROWSER =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";

function visit(overrides: Partial<SiteVisitContext> = {}): SiteVisitContext {
  return { ipAddress: "203.0.113.7", userAgent: BROWSER, path: "/", ...overrides };
}

describe("scoreSuspicion", () => {
  it("scores an ordinary browser arrival as normal", () => {
    const result = scoreSuspicion(visit(), history());

    expect(result.level).toBe("normal");
    expect(result.signals).toEqual([]);
  });

  it("flags a scanner user agent as suspicious on its own", () => {
    // One damning signal is enough. A scanner never arrives by accident.
    const result = scoreSuspicion(visit({ userAgent: "sqlmap/1.7#stable" }), history());

    expect(result.level).toBe("suspicious");
    expect(result.signals).toContain("scanner_user_agent");
  });

  it("flags correlated sign-in failures as suspicious on their own", () => {
    const result = scoreSuspicion(visit(), history({ authFailures: 1, authAttempts: 1 }));

    expect(result.level).toBe("suspicious");
    expect(result.signals).toContain("auth_failures");
  });

  it("treats a lone command-line tool as watch, not suspicious", () => {
    // The reader may well have run this themselves; it corroborates, it doesn't convict.
    const result = scoreSuspicion(visit({ userAgent: "curl/8.4.0" }), history());

    expect(result.level).toBe("watch");
    expect(result.signals).toEqual(["tool_user_agent"]);
  });

  it("escalates two weak signals to suspicious", () => {
    const result = scoreSuspicion(
      visit({ userAgent: "curl/8.4.0" }),
      history({ recentVisits: SUSPICION_THRESHOLDS.burstVisits, totalVisits: 20 }),
    );

    expect(result.level).toBe("suspicious");
    expect(result.signals).toEqual(expect.arrayContaining(["tool_user_agent", "burst"]));
  });

  it("does not double-count a scanner as also being a tool", () => {
    // "python-requests" is in both lists conceptually; only one signal may be emitted,
    // or a single observation would silently become an automatic "suspicious".
    const result = scoreSuspicion(visit({ userAgent: "nikto/2.5.0" }), history());

    expect(result.signals).toEqual(["scanner_user_agent"]);
    expect(result.signals).not.toContain("tool_user_agent");
  });

  it("flags a missing user agent", () => {
    const result = scoreSuspicion(visit({ userAgent: undefined }), history());

    expect(result.signals).toContain("no_user_agent");
  });

  it("treats a whitespace-only user agent as missing", () => {
    const result = scoreSuspicion(visit({ userAgent: "   " }), history());

    expect(result.signals).toContain("no_user_agent");
  });

  it("matches user agents case-insensitively", () => {
    const result = scoreSuspicion(visit({ userAgent: "CURL/8.4.0" }), history());

    expect(result.signals).toContain("tool_user_agent");
  });

  it("only flags a burst at the threshold, not below it", () => {
    const below = scoreSuspicion(
      visit(),
      history({ recentVisits: SUSPICION_THRESHOLDS.burstVisits - 1 }),
    );
    const at = scoreSuspicion(
      visit(),
      history({ recentVisits: SUSPICION_THRESHOLDS.burstVisits }),
    );

    expect(below.signals).not.toContain("burst");
    expect(at.signals).toContain("burst");
  });

  it("does not flag 'never signs in' for a first-time visitor", () => {
    // One arrival with no sign-in is somebody changing their mind, not a probe.
    const result = scoreSuspicion(visit(), history({ totalVisits: 1, authAttempts: 0 }));

    expect(result.signals).not.toContain("never_signs_in");
  });

  it("flags 'never signs in' once an address has kept knocking", () => {
    const result = scoreSuspicion(
      visit(),
      history({
        totalVisits: SUSPICION_THRESHOLDS.neverSignsInAfterVisits,
        authAttempts: 0,
      }),
    );

    expect(result.signals).toContain("never_signs_in");
  });

  it("does not flag 'never signs in' when the address has reached the form", () => {
    const result = scoreSuspicion(
      visit(),
      history({ totalVisits: 20, authAttempts: 3 }),
    );

    expect(result.signals).not.toContain("never_signs_in");
  });

  it("short-circuits every signal for an allowlisted address", () => {
    // The whole point of vouching. Even the worst-looking request scores normal, and
    // no signal is reported, so nothing downstream can re-escalate it.
    const result = scoreSuspicion(
      visit({ userAgent: "sqlmap/1.7" }),
      history({ allowlisted: true, recentVisits: 500, totalVisits: 900, authFailures: 40 }),
    );

    expect(result.level).toBe("normal");
    expect(result.signals).toEqual([]);
  });
});

describe("levelFromSignals", () => {
  it("returns normal for no signals", () => {
    expect(levelFromSignals([])).toBe("normal");
  });

  it("returns watch for exactly one weak signal", () => {
    expect(levelFromSignals(["tool_user_agent"])).toBe("watch");
  });

  it("returns suspicious for two weak signals", () => {
    expect(levelFromSignals(["tool_user_agent", "burst"])).toBe("suspicious");
  });

  it.each(["scanner_user_agent", "auth_failures"] as const)(
    "returns suspicious for a lone %s",
    (signal) => {
      expect(levelFromSignals([signal])).toBe("suspicious");
    },
  );
});

describe("describeSignal / describeSuspicion", () => {
  it("describes every signal without falling through", () => {
    const signals = [
      "no_user_agent",
      "tool_user_agent",
      "scanner_user_agent",
      "burst",
      "never_signs_in",
      "auth_failures",
    ] as const;

    for (const signal of signals) {
      expect(describeSignal(signal)).toBeTruthy();
    }
  });

  it("describes every level", () => {
    expect(describeSuspicion("normal")).toBe("Normal");
    expect(describeSuspicion("watch")).toBe("Worth a look");
    expect(describeSuspicion("suspicious")).toBe("Suspicious");
  });
});
