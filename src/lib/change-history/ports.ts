export interface ChangeHistoryRepository {
  /**
   * The raw change log, or null when there isn't one — a checkout that has
   * never been through a release has no file, and that is not an error.
   */
  readChangeLog(): string | null;
}
