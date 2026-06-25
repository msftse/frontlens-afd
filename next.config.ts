import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for a small Docker image (Azure Container Apps).
  output: "standalone",
  // Keep the Azure SDKs out of the bundler - they're server-only and ship their
  // own CJS/optional deps that shouldn't be traced/bundled by Turbopack.
  serverExternalPackages: ["@azure/monitor-query", "@azure/identity"],
};

export default nextConfig;
