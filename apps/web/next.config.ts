import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://crm-api:3001/:path*",
      },
    ];
  },
};

export default nextConfig;
