import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Standalone reference example with its own package.json/tsconfig — not part of this app.
    "docs/**",
  ]),
  {
    // ARCHITECTURE.md hard rule: src/lib/ is framework-free. See ./ARCHITECTURE.md.
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: ["react", "react/*", "next", "next/*"],
        },
      ],
    },
  },
]);

export default eslintConfig;
