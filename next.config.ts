import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces .next/standalone (a minimal, self-contained server + traced
  // node_modules) so REBUILD_PUBLISH.bat can copy a flat deployment folder
  // instead of shipping the whole source tree + dev node_modules.
  output: "standalone",
  // better-sqlite3 is a native addon; keep it a real require() instead of
  // letting webpack try to bundle it, so its .node binary gets traced as-is.
  serverExternalPackages: ["better-sqlite3"],
  // Opening the dev DB during "Collecting page data" makes file-trace pick up
  // data/*.db and .env as if the build depended on them, baking the current
  // dev database and secrets straight into .next/standalone. Neither belongs
  // in a build artifact -- the deployed app gets its own data/ and .env.
  outputFileTracingExcludes: {
    "*": ["data/**", ".env", ".env.*"],
  },
};

export default nextConfig;
