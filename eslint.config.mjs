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
    // Copied production build output (see .gitignore) — lint source, not the bundle.
    ".publish/**",
    // NAS deployment package built by scripts/publish-nas.mjs (see .gitignore).
    // Same reasoning as .publish: it's minified bundles plus vendored
    // node_modules, and linting it drowns the real findings in ~14k reports.
    "dist-nas/**",
    // Playwright's own output (see .gitignore). Its bundled trace viewer is
    // minified JS that trips rules-of-hooks, so a failed browser stage would
    // otherwise fail the *lint* stage on the next `npm run verify`.
    "playwright-report/**",
    "test-results/**",
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
