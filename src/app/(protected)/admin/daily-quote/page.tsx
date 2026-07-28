import { QUOTE_CATEGORIES, listQuotes } from "@/lib/daily-quote";
import { deps } from "@/lib/wiring";
import { DailyQuoteView } from "./view";

export default function DailyQuotePage() {
  const quotes = listQuotes(deps.dailyQuoteRepo);
  return <DailyQuoteView quotes={quotes} categories={QUOTE_CATEGORIES} />;
}
