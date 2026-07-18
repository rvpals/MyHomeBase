/** Parses `--key value` pairs from argv into a flat flags object. */
export function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = args[index + 1];
    flags[key] = value ?? "";
    index += 1;
  }
  return flags;
}
