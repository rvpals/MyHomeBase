/** The feature catalogue as read off disk, for Admin → About → Features. */
export interface FeatureList {
  /** The file's raw markdown, or null when there is no file. */
  markdown: string | null;
}
