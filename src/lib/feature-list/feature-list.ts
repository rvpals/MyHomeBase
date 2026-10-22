import type { FeatureListRepository } from "./ports";
import type { FeatureList } from "./types";

// The use-case for the feature catalogue. No file access here — the repository
// supplies the text, exactly as in `change-history`, so the same result is
// reachable from the web app, the CLI and a test with a string literal.

/**
 * Reads the feature catalogue.
 *
 * A missing file comes back as `markdown: null` rather than throwing: the
 * document is checked into the repo, but a checkout that doesn't have it should
 * render an empty state instead of failing the whole About screen.
 */
export function getFeatureList(repo: FeatureListRepository): FeatureList {
  return { markdown: repo.readFeatureList() };
}
