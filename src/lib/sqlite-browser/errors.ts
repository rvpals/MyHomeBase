/**
 * The upload exceeded the byte cap.
 *
 * A named type rather than a plain `Error` because the upload route has to map
 * it to HTTP 413 specifically, and matching on a message string would break the
 * moment the wording changed.
 */
export class UploadTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`That file is larger than the ${formatCap(maxBytes)} limit.`);
    this.name = "UploadTooLargeError";
  }
}

/**
 * The cap as a person reads it — "1 GB", not "1024 MB".
 *
 * The message is built from the constant rather than written out, so the two
 * cannot drift apart when the cap changes. Printing a gigabyte-scale cap in
 * megabytes is the drift that made this worth a function.
 */
export function formatCap(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1024) {
    const gigabytes = megabytes / 1024;
    return `${Number.isInteger(gigabytes) ? gigabytes : gigabytes.toFixed(1)} GB`;
  }
  return `${Math.round(megabytes)} MB`;
}

/** Whether an unknown caught value is an over-the-cap failure. */
export function isUploadTooLargeError(error: unknown): error is UploadTooLargeError {
  return error instanceof UploadTooLargeError;
}
