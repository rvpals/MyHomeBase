export interface FeatureListRepository {
  /**
   * The raw feature catalogue, or null when the file isn't there — a checkout
   * without `MyHomeBase_feature.md` shows an empty state, which is not an error.
   */
  readFeatureList(): string | null;
}
