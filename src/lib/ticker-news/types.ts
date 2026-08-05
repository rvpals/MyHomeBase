/** A news story as the provider reported it, before any ranking. */
export interface RawNewsStory {
  title: string;
  publisher: string;
  url: string;
  /** ISO 8601 instant. */
  publishedAt: string;
  /** Every ticker the provider tagged, in its own order. First is usually the subject. */
  relatedTickers: string[];
}

/** The story picked for a ticker, with why it was picked attached. */
export interface TopNewsStory extends RawNewsStory {
  /** The ticker this was chosen for — not necessarily the story's only subject. */
  ticker: string;
  /**
   * False when nothing was published today and this is the most recent story
   * instead. The UI says so rather than implying it explains today's move.
   */
  isFromToday: boolean;
  /** True when the ticker is the story's lead subject rather than a passing mention. */
  isPrimarySubject: boolean;
}
