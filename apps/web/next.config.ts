import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  transpilePackages: ["@aibos/ui", "@aibos/shared", "@aibos/browser-core", "@aibos/access-core"],
  /** Same-origin proxy so the browser never needs CORS or the API's address. */
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${apiUrl}/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
