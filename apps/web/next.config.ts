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
    // Permite camera (scanner do portal usa getUserMedia) e geolocalizacao.
    // Sem `camera=(self)` alguns browsers em iframe/contexto cross-origin
    // bloqueiam mesmo com permissao do usuario.
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(self)",
  },
  {
    // Permite scripts do Google Tag Manager, Google Ads e OpenCV.js (scanner do portal)
    key: "Content-Security-Policy",
    value: [
      // docs.opencv.org serve opencv.js — usado pelo scanner de documentos
      // do portal do cliente (jscanify + perspective transform).
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${googleScriptSrc} https://docs.opencv.org`,
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
  images: {
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  async headers() {
    const noindexHeader = {
      key: "X-Robots-Tag",
      value: "noindex, nofollow",
    };
    return [
      {
        // Aplica os headers em todas as rotas
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // Bloqueia indexacao de rotas privadas (CRM, portal do cliente,
        // formularios privados com leadId). Reforca o robots.txt e cobre
        // tambem assets estaticos servidos por essas rotas.
        source: "/atendimento/:path*",
        headers: [noindexHeader],
      },
      {
        source: "/portal/:path*",
        headers: [noindexHeader],
      },
      {
        source: "/formulario/:path*",
        headers: [noindexHeader],
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
  async redirects() {
    // Redirects 301 de URLs do site WordPress antigo que ainda estao indexadas
    // no Google e geram 404 no Search Console. As paginas serao recriadas como
    // LPs no futuro; por enquanto apontam para a home para preservar a autoridade.
    return [
      {
        source: "/direito-trabalhista",
        destination: "/",
        permanent: true,
      },
      {
        source: "/direito-trabalhista/:path*",
        destination: "/",
        permanent: true,
      },
      {
        source: "/direito-previdenciario",
        destination: "/",
        permanent: true,
      },
      {
        source: "/direito-previdenciario/:path*",
        destination: "/",
        permanent: true,
      },
      {
        source: "/direito-do-consumidor",
        destination: "/",
        permanent: true,
      },
      {
        source: "/direito-do-consumidor/:path*",
        destination: "/",
        permanent: true,
      },
      {
        source: "/full-service",
        destination: "/",
        permanent: true,
      },
      {
        source: "/full-service/:path*",
        destination: "/",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
