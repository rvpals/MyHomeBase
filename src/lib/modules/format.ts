// Derives a short reference code from a module's slug, e.g. "real-estate-investment" -> "REI".
// Used anywhere a module needs a compact label (collapsed sidebar, card tab).
export function getModuleCode(slug: string): string {
  const code = slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();

  return code.slice(0, 3) || "?";
}
