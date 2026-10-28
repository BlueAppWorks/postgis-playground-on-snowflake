import type { NextConfig } from "next";

const root = process.cwd();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // App Runtime keeps only the build output, not node_modules, so `next start` is not available there.
  // Standalone output bundles the server and its dependencies into .next/standalone/server.js;
  // scripts/prepare-standalone.mjs (postbuild) copies static assets, sql/ and data/seed/ next to it.
  output: "standalone",
  serverExternalPackages: ["pg"],
  // Next 16 looks for a lockfile in parent folders and may re-root the project; pin it here.
  outputFileTracingRoot: root,
  turbopack: { root },
};

export default nextConfig;
