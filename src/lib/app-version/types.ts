// The deployed build's identity, as handed to the client and compared against
// later. A string rather than a number: Next's build IDs are opaque, and the
// only operation that matters is equality.
export interface AppVersion {
  /**
   * The build this server is serving. `null` when it can't be determined —
   * `next dev` writes no BUILD_ID, so dev is permanently "unknown" and the
   * client must treat that as "never prompt" rather than "always prompt".
   */
  buildId: string | null;
}
