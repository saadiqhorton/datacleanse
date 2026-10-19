import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules must stay out of the server bundle.
  serverExternalPackages: ["better-sqlite3", "@duckdb/node-api", "@duckdb/node-bindings"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
