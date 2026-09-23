import type { IpHistory, ScoredVisit, SiteVisitContext, SuspicionLevel, SuspicionSignal } from "./types";

/**
 * How suspicious one arrival looks.
 *
 * Every threshold lives in this one object so the rules can be tuned without reading
 * the logic, and so a test can state exactly which edge it is probing.
 *
 * These numbers are judgement calls about a single-reader home server, not science.
 * On a site with one legitimate user, five logged-out arrivals from one address in
 * ten minutes is already odd; on a busy public site it would be nothing.
 */
export const SUSPICION_THRESHOLDS = {
  /** Window for the burst count, in minutes. */
  burstWindowMinutes: 10,
  /** Arrivals from one address inside the window before it reads as a burst. */
  burstVisits: 5,
  /** Arrivals before "never reached the sign-in form" means anything. */
  neverSignsInAfterVisits: 3,
  /** Failed sign-ins from this address before it counts as a signal. */
  authFailures: 1,
} as const;

/**
 * User-agent fragments that name a scripting tool rather than a browser.
 *
 * Matched case-insensitively as substrings. This list is deliberately short and
 * high-confidence: every entry here is something that does not arrive by accident
 * when a person opens a URL.
 */
const TOOL_AGENTS = [
  "curl/",
  "wget",
  "python-requests",
  "python-urllib",
  "go-http-client",
  "java/",
  "okhttp",
  "libwww-perl",
  "httpie",
  "postman",
  "axios/",
  "node-fetch",
];

/**
 * User-agent fragments that name a crawler, scanner or vulnerability probe.
 *
 * Separated from TOOL_AGENTS because the two mean different things: a curl request
 * might be the reader testing something, while `sqlmap` never is. Scanners score
 * harder for that reason.
 */
const SCANNER_AGENTS = [
  "sqlmap",
  "nikto",
  "nmap",
  "masscan",
  "zgrab",
  "nuclei",
  "acunetix",
  "wpscan",
  "dirbuster",
  "gobuster",
  "censys",
  "shodan",
  "semrushbot",
  "ahrefsbot",
  "mj12bot",
  "dotbot",
  "petalbot",
  "bytespider",
];

function matchesAny(haystack: string, needles: readonly string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

/**
 * Turns the collected signals into one verdict.
 *
 * The shape of the rule, in words: a scanner user agent or a correlated sign-in
 * failure is suspicious on its own; anything else needs corroboration. Two weak
 * signals make a suspicious; one weak signal is a `watch`.
 *
 * That asymmetry is the whole design. A bare `curl` with no history is interesting
 * but not alarming — the reader might have run it themselves — while `curl` that has
 * also failed a password twice is a different story.
 */
export function levelFromSignals(signals: readonly SuspicionSignal[]): SuspicionLevel {
  if (signals.length === 0) return "normal";

  const damning = signals.some(
    (signal) => signal === "scanner_user_agent" || signal === "auth_failures",
  );
  if (damning) return "suspicious";

  // `allowlist_removed` records an admin action, not an observation about the
  // request, so it does not count as corroboration. Without this it would pair with
  // any single weak signal to manufacture a "suspicious" — turning "I stopped
  // trusting this address" into "this address attacked me", which it is not.
  const observed = signals.filter((signal) => signal !== "allowlist_removed");
  if (observed.length === 0) return "watch";

  return observed.length >= 2 ? "suspicious" : "watch";
}

/**
 * Scores one arrival, given the request and what is known about the address.
 *
 * A pure function of its two arguments: no clock, no database, no network. Every
 * time-dependent input (the burst count) is resolved by the caller and passed in as a
 * number, which is what makes the whole rule set testable from object literals.
 *
 * **The allowlist short-circuits everything.** A vouched-for address is `normal` with
 * no signals, whatever its user agent or rate — that is the entire point of vouching,
 * and checking it first means no later rule can accidentally override it.
 *
 * This is a triage aid, never an authorisation input. The address it reasons about
 * arrives in a forgeable header (migrations/0102, 0103), so the output may only ever
 * decide what the reader looks at first.
 */
export function scoreSuspicion(context: SiteVisitContext, history: IpHistory): ScoredVisit {
  if (history.allowlisted) return { level: "normal", signals: [] };

  const signals: SuspicionSignal[] = [];
  const userAgent = context.userAgent?.trim() ?? "";

  if (userAgent === "") {
    signals.push("no_user_agent");
  } else if (matchesAny(userAgent, SCANNER_AGENTS)) {
    signals.push("scanner_user_agent");
  } else if (matchesAny(userAgent, TOOL_AGENTS)) {
    // `else if` on purpose: a scanner is also a tool, and reporting both would
    // double-count one observation into an automatic "suspicious".
    signals.push("tool_user_agent");
  }

  if (history.recentVisits >= SUSPICION_THRESHOLDS.burstVisits) {
    signals.push("burst");
  }

  // "Has knocked repeatedly and never once tried the door." Needs a few visits before
  // it means anything — one arrival with no sign-in is just someone who changed their
  // mind, which is a thing people do.
  if (
    history.totalVisits >= SUSPICION_THRESHOLDS.neverSignsInAfterVisits &&
    history.authAttempts === 0
  ) {
    signals.push("never_signs_in");
  }

  if (history.authFailures >= SUSPICION_THRESHOLDS.authFailures) {
    signals.push("auth_failures");
  }

  return { level: levelFromSignals(signals), signals };
}

/** Human wording for a signal. Used by the Visit tab; no logic branches on it. */
export function describeSignal(signal: SuspicionSignal): string {
  switch (signal) {
    case "no_user_agent":
      return "Sent no browser identification";
    case "tool_user_agent":
      return "Came from a command-line tool, not a browser";
    case "scanner_user_agent":
      return "Identified itself as a scanner";
    case "burst":
      return `More than ${SUSPICION_THRESHOLDS.burstVisits} arrivals in ${SUSPICION_THRESHOLDS.burstWindowMinutes} minutes`;
    case "never_signs_in":
      return "Has arrived repeatedly and never tried to sign in";
    case "auth_failures":
      return "Also has failed sign-in attempts";
    case "allowlist_removed":
      return "Was trusted until an admin removed the address from the allowlist";
  }
}

/**
 * Every signal the scorer knows about. The single source of truth for "is this a
 * real signal key", used by `decodeSignals` to drop anything it doesn't recognise.
 *
 * Declared as a Set of the union type rather than derived from `describeSignal`,
 * because a `switch` cannot be enumerated at runtime. Adding a member to
 * `SuspicionSignal` without adding it here makes the decoder silently drop it, so the
 * two are kept adjacent on purpose.
 */
const KNOWN_SIGNALS: ReadonlySet<string> = new Set<SuspicionSignal>([
  "no_user_agent",
  "tool_user_agent",
  "scanner_user_agent",
  "burst",
  "never_signs_in",
  "auth_failures",
  "allowlist_removed",
]);

/**
 * Packs signals into the flat string the table stores (migrations/0106).
 *
 * Comma-separated keys. No member of the union contains a comma or a space, so this
 * needs no escaping and `decodeSignals` needs no parser.
 */
export function encodeSignals(signals: readonly SuspicionSignal[]): string {
  return signals.join(",");
}

/**
 * Unpacks the stored string, dropping anything unrecognised.
 *
 * Forgiving on purpose. A row written by a newer build can carry a signal this build
 * has never heard of, and the right answer is to show the reasons we *do* understand
 * rather than fail the whole page's read validation over one unknown word. Blank,
 * whitespace and duplicates all collapse to a clean list.
 */
export function decodeSignals(encoded: string | null | undefined): SuspicionSignal[] {
  if (!encoded) return [];

  const seen = new Set<SuspicionSignal>();
  for (const part of encoded.split(",")) {
    const key = part.trim();
    if (KNOWN_SIGNALS.has(key)) seen.add(key as SuspicionSignal);
  }
  return [...seen];
}

/** Human wording for a verdict. */
export function describeSuspicion(level: SuspicionLevel): string {
  switch (level) {
    case "normal":
      return "Normal";
    case "watch":
      return "Worth a look";
    case "suspicious":
      return "Suspicious";
  }
}
