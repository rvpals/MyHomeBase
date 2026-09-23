import { describe, expect, it } from "vitest";
import {
  SUSPICION_THRESHOLDS,
  decodeSignals,
  describeSignal,
  describeSuspicion,
  encodeSignals,
  levelFromSignals,
  scoreSuspicion,
} from "./suspicion";
import type { IpHistory, SiteVisitContext, SuspicionSignal } from "./types";

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

  it("returns watch for a lone allowlist_removed marker", () => {
    // "I stopped trusting this address" is a reason to look, not an accusation.
    expect(levelFromSignals(["allowlist_removed"])).toBe("watch");
  });

  it("does not let the allowlist_removed marker corroborate a weak signal", () => {
    // The regression this guards: counting the marker as a second signal would
    // manufacture a "suspicious" out of one weak observation plus an admin action.
    expect(levelFromSignals(["tool_user_agent", "allowlist_removed"])).toBe("watch");
  });

  it("still reports suspicious when a damning signal accompanies the marker", () => {
    expect(levelFromSignals(["scanner_user_agent", "allowlist_removed"])).toBe("suspicious");
  });
});

describe("encodeSignals / decodeSignals", () => {
  it("round-trips a list of signals", () => {
    const signals: SuspicionSignal[] = ["scanner_user_agent", "auth_failures"];
    expect(decodeSignals(encodeSignals(signals))).toEqual(signals);
  });

  it("round-trips an empty list through the table's blank sentinel", () => {
    expect(encodeSignals([])).toBe("");
    expect(decodeSignals("")).toEqual([]);
  });

  it("reads a pre-0106 row as no reasons rather than throwing", () => {
    // Existing rows were not backfilled; their reasons cannot be re-derived.
    expect(decodeSignals(null)).toEqual([]);
    expect(decodeSignals(undefined)).toEqual([]);
  });

  it("drops a signal it does not recognise instead of failing the row", () => {
    // A row written by a newer build must still render on an older one: show the
    // reasons we understand rather than losing the whole page.
    expect(decodeSignals("burst,from_the_future,auth_failures")).toEqual([
      "burst",
      "auth_failures",
    ]);
  });

  it("tolerates whitespace and duplicates", () => {
    expect(decodeSignals(" burst , burst ,auth_failures")).toEqual(["burst", "auth_failures"]);
  });

  it("encodes without separators that would need escaping", () => {
    // The no-escaping claim in migrations/0106 rests on this: no signal key contains
    // a comma, so splitting on one can never tear a key in half.
    const every: SuspicionSignal[] = [
      "no_user_agent",
      "tool_user_agent",
      "scanner_user_agent",
      "burst",
      "never_signs_in",
      "auth_failures",
      "allowlist_removed",
    ];
    for (const signal of every) expect(signal).not.toContain(",");
    expect(decodeSignals(encodeSignals(every))).toEqual(every);
  });
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
      "allowlist_removed",
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
