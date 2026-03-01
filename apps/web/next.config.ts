import type { NextConfig } from "next";

const backendUrl = process.env.INTERNAL_API_URL || "http://crm-api:3001";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
