// Enforces ARCHITECTURE.md's one hard rule: no file under src/lib/ may import from
// `react`, `next`, or `next/*`.
//
// Replaces the previous `! grep -rE "from '(react|next)" src/lib` npm script, which
// could not work here for two reasons: cmd.exe rejects a leading `!`, and the pattern
// only matched single-quoted imports while this codebase uses double quotes.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const LIBRARY_DIRECTORY = path.join(process.cwd(), "src", "lib");

// Matches static imports, `export ... from`, dynamic `import()`, and `require()`,
// in either quote style. The module must be exactly `react`/`next` or a subpath of
// one, so `react-is` or `nextdoor` don't produce false positives.
const FORBIDDEN_IMPORT = /(?:from|import|require)\s*\(?\s*["'](react|next)(\/[^"']*)?["']/g;

/** Every .ts/.tsx file under `directory`, recursively. */
function collectSourceFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory)) {
    const entryPath = path.join(directory, entry);
    if (statSync(entryPath).isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      files.push(entryPath);
    }
  }

  return files;
}

/** Returns one `file:line: text` entry per offending import. */
function findViolations(files) {
  const violations = [];

  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);

    lines.forEach((line, index) => {
      FORBIDDEN_IMPORT.lastIndex = 0;
      if (!FORBIDDEN_IMPORT.test(line)) return;
      const relativePath = path.relative(process.cwd(), file).replace(/\\/g, "/");
      violations.push(`${relativePath}:${index + 1}: ${line.trim()}`);
    });
  }

  return violations;
}

const violations = findViolations(collectSourceFiles(LIBRARY_DIRECTORY));

if (violations.length > 0) {
  console.error(
    `src/lib must not import react or next. ${violations.length} violation(s):\n` +
      violations.map((violation) => `  ${violation}`).join("\n"),
  );
  process.exit(1);
}

console.log("Library boundary clean: no react/next imports under src/lib.");
