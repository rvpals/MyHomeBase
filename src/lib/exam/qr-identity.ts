/**
 * The student identity printed on an answer sheet as a QR code.
 *
 * ## Why a QR replaced the bubble grid
 *
 * The grid encoded five digits in fifty pre-shaded bubbles. It worked, but it had no
 * error correction, no way to tell a misread from a correct read, and no landmark of
 * its own — the detector located it by finding a thin rectangle, the weakest feature
 * on the sheet. A crease, a staple shadow or a coffee ring through one column silently
 * produced a *different valid ID*, which attaches a grade to the wrong student.
 *
 * A QR carries its own three finder patterns, so it self-locates and self-deskews, and
 * Reed-Solomon error correction means damage either decodes correctly or fails loudly.
 * For identity, "I could not read it" is the only acceptable failure, and the QR is the
 * only one of the two that can reliably say it.
 *
 * ## Why the payload is the ID alone
 *
 * Not the name: a name is long, pushes the code to a denser version with smaller
 * modules, and is already printed in plain text beside it. Not the exam id either —
 * grading already knows which exam it is running, because the operator chose it.
 *
 * The prefix exists so a decode that lands on *some other* QR (a library sticker, a
 * printed label on a reused sheet) is rejected rather than read as an ID.
 */

/** Marks a payload as ours. Short, because every character costs QR modules. */
export const QR_PAYLOAD_PREFIX = "MHB-S:";

/**
 * The most characters an ID may contribute to the payload.
 *
 * Caps the QR at version 2 (25x25) with medium error correction, which keeps the
 * module size large enough to survive a phone photo at the printed 0.9in.
 */
export const MAX_ID_LENGTH = 24;

/**
 * Builds the payload string for a student ID.
 *
 * Returns undefined when there is nothing worth encoding, which is the signal not to
 * print a QR at all — a blank sheet has no student, and a code encoding an empty ID
 * would be a landmark the decoder then has to explain away.
 */
export function encodeStudentIdPayload(studentIdentifier: string): string | undefined {
  const trimmed = studentIdentifier.trim();
  if (trimmed === "") return undefined;
  if (trimmed.length > MAX_ID_LENGTH) return undefined;
  return `${QR_PAYLOAD_PREFIX}${trimmed}`;
}

/**
 * Reads a student ID back out of a decoded QR payload.
 *
 * Returns undefined for anything that is not one of ours. Deliberately strict: a
 * grade attached to a wrong-but-plausible ID is worse than an ungraded sheet, and the
 * operator can always type the ID in.
 */
export function decodeStudentIdPayload(payload: string | undefined): string | undefined {
  if (!payload) return undefined;
  const trimmed = payload.trim();
  if (!trimmed.startsWith(QR_PAYLOAD_PREFIX)) return undefined;

  const id = trimmed.slice(QR_PAYLOAD_PREFIX.length).trim();
  if (id === "" || id.length > MAX_ID_LENGTH) return undefined;
  return id;
}

/**
 * Generates and reads the QR, kept behind a port for the same reason `sharp` is.
 *
 * The implementations pull in `qrcode` and `jsqr`, and this module is reached from
 * `wiring.ts`, which every page imports. A top-level import would make a dependency
 * only the answer sheet and the grader need into one the whole app loads to boot.
 */
export interface QrIdentityPort {
  /**
   * Renders a payload as an SVG string, sized by the caller via CSS.
   *
   * SVG rather than a raster: it prints at the printer's resolution instead of the
   * image's, and it needs no canvas, so it works unchanged during server rendering.
   */
  encodeSvg(payload: string): Promise<string>;

  /**
   * Finds and decodes a QR inside an already-cropped RGBA region.
   *
   * Returns the raw payload text, or undefined if no code was found. Cropping is the
   * caller's job, because only the caller knows the sheet geometry.
   */
  decode(region: { data: Uint8ClampedArray; width: number; height: number }): Promise<string | undefined>;
}
