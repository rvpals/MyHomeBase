import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // The Playwright specs live in e2e/ and must never be collected by Vitest — they
    // need a browser and a running dev server, and would fail here.
    exclude: ["e2e/**", "node_modules/**", ".verify/**"],
    passWithNoTests: true,
  },
});
