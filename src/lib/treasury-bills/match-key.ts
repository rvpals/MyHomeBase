/**
 * The key the CSV importer matches a purchase on: symbol + purchase date.
 *
 * **Its own file, with no imports, on purpose.** Both the repository and the CSV
 * adapter need it, and the adapter's field lists are imported by the *client* import
 * view. Had this stayed in `repository.ts`, that client import would reach a module
 * holding the SQLite repository — the exact trap `components.md` warns about, and one
 * that only bites when something in that chain gains a real `better-sqlite3` import.
 *
 * Lower-cased and trimmed, since a file writing `912797ls4` means the same bill as
 * `912797LS4`. The NUL separator cannot occur in either half, so no symbol ending in
 * a date can collide with a different symbol-and-date pair.
 */
export function symbolDateKey(symbol: string, datePurchased: string): string {
  return `${symbol.trim().toLowerCase()}\u0000${datePurchased}`;
}
