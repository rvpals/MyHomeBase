export interface ComponentListRepository {
  /**
   * The raw `components.md`, or null when the file isn't there — a checkout
   * without the registry shows an empty state, which is not an error.
   */
  readComponentList(): string | null;
}
