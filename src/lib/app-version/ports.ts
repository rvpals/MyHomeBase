// The one piece of the outside world this module needs: whatever holds the
// deployed build's identity. A port so the logic below is testable without a
// real `.next` directory on disk.
export interface BuildIdRepository {
  /** The raw build identifier, or `null` when there is none to read. */
  readBuildId(): string | null;
}
