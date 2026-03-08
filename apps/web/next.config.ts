import type { NextConfig } from "next";
import path from "path";

const backendUrl = process.env.INTERNAL_API_URL || "http://crm-api:3001";

// Domínios Google necessários para GTM, Google Ads e Analytics
const googleScriptSrc = [
  "https://www.googletagmanager.com",
  "https://www.google-analytics.com",
  "https://ssl.google-analytics.com",
  "https://www.googleadservices.com",
  "https://googleads.g.doubleclick.net",
  "https://www.google.com",
  "https://connect.facebook.net",   // Meta Pixel (se utilizado)
].join(" ");

const googleConnectSrc = [
  "https://www.google-analytics.com",
  "https://analytics.google.com",
  "https://stats.g.doubleclick.net",
  "https://www.googletagmanager.com",
  "https://www.googleadservices.com",
  "https://googleads.g.doubleclick.net",
].join(" ");

const googleFrameSrc = [
  "https://www.googletagmanager.com",
  "https://td.doubleclick.net",
  "https://www.google.com",
].join(" ");

const securityHeaders = [
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // Permite scripts do Google Tag Manager e Google Ads
    key: "Content-Security-Policy",
    value: [
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${googleScriptSrc}`,
      `img-src 'self' data: blob: https: http:`,
      `connect-src 'self' https: wss: ${googleConnectSrc}`,
      `frame-src 'self' ${googleFrameSrc}`,
      `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
      `font-src 'self' data: https://fonts.gstatic.com`,
      `media-src 'self' https: blob:`,
      `worker-src 'self' blob:`,
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Necessário em monorepo: garante que server.js fique em apps/web/server.js
  // dentro do standalone, que é o path que o Dockerfile espera no CMD.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  async headers() {
    return [
      {
        // Aplica os headers em todas as rotas
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
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
