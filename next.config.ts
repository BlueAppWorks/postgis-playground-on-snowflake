import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  // SQL files and the offline seed are read from disk at runtime.
  outputFileTracingIncludes: { "/api/**": ["./sql/**", "./data/seed/**"] },
};

export default nextConfig;
