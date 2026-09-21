// `formatCap` is imported rather than restated. The two browsers share the one
// configured cap (`tools_max_upload_bytes`), so they must render it identically
// — a second copy of this formatting would be a place for "1 GB" and "1024 MB"
// to drift apart in the same module's UI.
//
// This is the one thing this module takes from `sqlite-browser`, and it is
// taken from the *leaf* file, not the barrel: the barrel re-exports the
// repository and the file store, so importing it would pull `better-sqlite3`
// into anything that only wanted to format a number. `errors.ts` is pure.
// Nothing flows the other way, so the two modules still form a DAG.
import { formatCap } from "@/lib/sqlite-browser/errors";

export { formatCap };

/**
 * The upload exceeded the byte cap.
 *
 * A named type rather than a plain `Error` because the upload route has to map
 * it to HTTP 413 specifically, and matching on a message string would break
 * the moment the wording changed.
 *
 * Its own class rather than reusing `UploadTooLargeError`: a caught error is
 * matched with `instanceof` to decide a status code, and one shared class
 * would mean this module's route could not tell its own failure from the other
 * browser's if the two ever met in one handler.
 */
export class CsvUploadTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`That file is larger than the ${formatCap(maxBytes)} limit.`);
    this.name = "CsvUploadTooLargeError";
  }
}

/** Whether an unknown caught value is an over-the-cap failure. */
export function isCsvUploadTooLargeError(error: unknown): error is CsvUploadTooLargeError {
  return error instanceof CsvUploadTooLargeError;
}
