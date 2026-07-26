import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compares two secret strings in constant time, so a caller can't learn the
 * expected value one character at a time from response-timing differences.
 *
 * Inputs are hashed to a fixed length first: `timingSafeEqual` throws on
 * unequal-length buffers (which would itself leak length), and hashing sidesteps
 * that while keeping the comparison timing-independent of the raw inputs.
 */
export function secureCompare(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}
