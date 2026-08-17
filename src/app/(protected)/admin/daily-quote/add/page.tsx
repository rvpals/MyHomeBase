import { QUOTE_CATEGORIES } from "@/lib/daily-quote";
import { AddQuoteView } from "./view";

export default function AddQuotePage() {
  return <AddQuoteView categories={QUOTE_CATEGORIES} />;
}
