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
  // NOTE: this does *not* currently work. `.next/standalone` still contains
  // `data/myhomebase.db` and `.env` after a build, with or without a leading
  // `**/` on the patterns — verified on Next 16.2. The publish step deletes them
  // from the assembled output instead (`scripts/publish-nas.mjs`), which is the
  // guarantee to rely on. Left in place in case a later Next honours it.
  outputFileTracingExcludes: {
    "*": ["data/**", ".env", ".env.*"],
  },
  experimental: {
    serverActions: {
      // Image uploads (module carousel graphics, account icons, avatars) travel
      // to a server action as base64, which inflates the file by ~33%. Next's
      // default is 1 MB of *body*, so the 2 MB cap in MAX_CAROUSEL_IMAGE_BYTES
      // was unreachable — an 800 KB PNG already failed, with a framework error
      // rather than the app's own message. 4 MB leaves room for the largest
      // upload the lib allows plus its encoding overhead.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
