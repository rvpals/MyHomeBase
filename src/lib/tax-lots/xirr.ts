// XIRR — the money-weighted return of a series of dated cash flows.
//
// Pure, zero-dependency, and deliberately ignorant of the tax-lot domain: it takes
// dated amounts and returns a rate, so it is testable on textbook examples and
// reusable by anything else that has cash flows.
//
// What it solves. XIRR is the rate `r` that makes the net present value of every
// flow zero, discounting each by its own actual elapsed time:
//
//     NPV(r) = Σ amount_i / (1 + r) ^ (days_i / 365)
//
// This is why it is the right measure here and a simple total return is not: two
// portfolios that both doubled are not equal performers if one took three years and
// the other took ten, and the lots were bought on scattered dates rather than all
// at once. `days/365` — not 365.25 — is the market convention for XIRR (it is what
// Excel's XIRR uses), so this stays 365 even though `yearsHeld` elsewhere in the
// module uses 365.25 for the holding period. They answer different questions.

const DAYS_PER_YEAR = 365;
const MILLISECONDS_PER_DAY = 86_400_000;

/** How hard the solver tries before giving up. */
const MAX_ITERATIONS = 100;
/** An NPV this close to zero is a solution, in dollars. */
const NPV_TOLERANCE = 1e-7;
/** A step smaller than this means the guess has stopped moving. */
const RATE_TOLERANCE = 1e-10;
/**
 * Rates below -100% are meaningless (you cannot lose more than everything) and the
 * discount term is undefined there, so a Newton step that overshoots is clamped just
 * inside the boundary rather than allowed to produce a NaN.
 */
const MIN_RATE = -0.9999999;

export interface XirrFlow {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Signed: outflows negative, inflows positive. */
  amount: number;
}

/** Days from the first flow, per flow. Parsed as UTC so no DST shift can skew a term. */
function elapsedYears(flows: XirrFlow[]): number[] {
  const times = flows.map((flow) => Date.parse(`${flow.date}T00:00:00Z`));
  const start = Math.min(...times);
  return times.map((time) => (time - start) / MILLISECONDS_PER_DAY / DAYS_PER_YEAR);
}

/** NPV and its derivative at `rate`, computed together — they share every term. */
function npvAndDerivative(
  flows: XirrFlow[],
  years: number[],
  rate: number,
): { npv: number; derivative: number } {
  let npv = 0;
  let derivative = 0;

  for (let index = 0; index < flows.length; index += 1) {
    const amount = flows[index].amount;
    const time = years[index];
    const discount = (1 + rate) ** time;
    npv += amount / discount;
    // d/dr [ a * (1+r)^-t ] = -t * a * (1+r)^(-t-1)
    derivative -= (time * amount) / (discount * (1 + rate));
  }

  return { npv, derivative };
}

/**
 * Solves for the money-weighted return, or returns `undefined` when there is no
 * answer to give.
 *
 * `undefined` — not 0, and not a throw — in four cases, all of them legitimate
 * states of a real portfolio rather than programming errors:
 *
 *  - fewer than two flows: one purchase and no valuation has no rate;
 *  - every flow the same sign: money only ever went in, so nothing has been
 *    returned and no rate exists;
 *  - all flows on one date: elapsed time is zero everywhere, so every rate is
 *    equally consistent and none is the answer;
 *  - the iteration did not converge.
 *
 * A caller that wants a number for display should render `undefined` as "—".
 * Returning 0 would be a lie the UI cannot distinguish from a genuinely flat return.
 */
export function computeXirr(flows: XirrFlow[], initialGuess = 0.1): number | undefined {
  if (flows.length < 2) return undefined;

  const hasOutflow = flows.some((flow) => flow.amount < 0);
  const hasInflow = flows.some((flow) => flow.amount > 0);
  if (!hasOutflow || !hasInflow) return undefined;

  const years = elapsedYears(flows);
  if (years.every((value) => value === 0)) return undefined;

  let rate = initialGuess;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const { npv, derivative } = npvAndDerivative(flows, years, rate);

    if (!Number.isFinite(npv) || !Number.isFinite(derivative)) break;
    if (Math.abs(npv) < NPV_TOLERANCE) return rate;
    // A flat derivative leaves Newton nothing to descend, and a step that lands on
    // the -100% floor cannot climb back off it. Both are Newton failing rather than
    // the problem being unsolvable, so both fall through to bisection.
    if (derivative === 0) break;

    const nextRate = rate - npv / derivative;
    if (!Number.isFinite(nextRate) || nextRate <= MIN_RATE) break;
    if (Math.abs(nextRate - rate) < RATE_TOLERANCE) return nextRate;
    rate = nextRate;
  }

  return bisectXirr(flows, years);
}

/**
 * The fallback when Newton-Raphson fails: bracket a sign change in NPV, then halve.
 *
 * Newton is fast but not globally convergent — from a far-off initial guess it can
 * overshoot past -100%, where the discount term is undefined, and never recover. That
 * is a defect in the *method*, not evidence the cash flows have no rate, so a poor
 * guess must not be the difference between an answer and a blank cell. Bisection is
 * slower but cannot diverge: once a sign change is bracketed, the root is trapped.
 *
 * Still `undefined` when no bracket exists anywhere in the scanned range, which is
 * the honest answer for flows whose NPV never crosses zero.
 */
function bisectXirr(flows: XirrFlow[], years: number[]): number | undefined {
  const npvAt = (rate: number) => npvAndDerivative(flows, years, rate).npv;

  // Scan outward from just above -100% to +1000%. A geometric walk rather than a
  // linear one, so the dense end sits where ordinary returns live.
  let low = MIN_RATE;
  let lowNpv = npvAt(low);
  if (!Number.isFinite(lowNpv)) return undefined;

  for (let step = 1; step <= 200; step += 1) {
    const high = MIN_RATE + 0.05 * step ** 1.5;
    if (high > 10) break;

    const highNpv = npvAt(high);
    if (!Number.isFinite(highNpv)) return undefined;

    if (Math.abs(highNpv) < NPV_TOLERANCE) return high;

    if ((lowNpv < 0) !== (highNpv < 0)) {
      // Bracketed. 100 halvings takes the interval well below RATE_TOLERANCE.
      let left = low;
      let right = high;
      let leftNpv = lowNpv;

      for (let iteration = 0; iteration < 100; iteration += 1) {
        const middle = (left + right) / 2;
        const middleNpv = npvAt(middle);

        if (Math.abs(middleNpv) < NPV_TOLERANCE) return middle;
        if (right - left < RATE_TOLERANCE) return middle;

        if ((leftNpv < 0) !== (middleNpv < 0)) {
          right = middle;
        } else {
          left = middle;
          leftNpv = middleNpv;
        }
      }

      return (left + right) / 2;
    }

    low = high;
    lowNpv = highNpv;
  }

  return undefined;
}
