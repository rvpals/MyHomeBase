/**
 * One readable line for an error, whatever kind it is.
 *
 * A ZodError's `.message` is the serialized ISSUE ARRAY -- printing it dumps a dozen
 * lines of JSON at someone who mistyped a flag, burying the schema's own perfectly
 * good wording inside it. So the first issue's message is preferred when there is one.
 *
 * Shared because every command that validates its arguments through a zod schema
 * needs exactly this, and each one open-coding it produced the JSON wall again.
 */
export function messageOf(error: unknown): string {
  const issues = (error as { issues?: { message?: string }[] }).issues;
  if (Array.isArray(issues)) {
    const first = issues[0]?.message;
    if (typeof first === "string" && first !== "") return first;
  }
  return error instanceof Error ? error.message : String(error);
}
