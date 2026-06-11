import { MetadataRoute } from 'next';
import { headers } from 'next/headers';

// Forca renderizacao dinamica para podermos inspecionar o Host header e servir
// um robots.txt diferente para subdominios internos (sistema.*, lp.*).
export const dynamic = 'force-dynamic';

const baseUrl =
  process.env.NEXT_PUBLIC_APP_URL || 'https://andrelustosaadvogados.com.br';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const headersList = await headers();
  const host = (headersList.get('host') || '').toLowerCase();

  // Subdominios internos: CRM (sistema.*) e LPs externas desativadas (lp.*)
  // nao devem ser indexados em hipotese alguma. Servimos um robots.txt
  // bloqueando tudo para que o Googlebot pare de rastrear essas URLs.
  const isInternalSubdomain =
    host.startsWith('sistema.') || host.startsWith('lp.');

  if (isInternalSubdomain) {
    return {
      rules: [
        {
          userAgent: '*',
          disallow: '/',
        },
      ],
    };
  }

  // Dominio publico principal: permite tudo exceto rotas privadas/dinamicas.
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/atendimento/', // CRM interno
          '/portal/', // Area do cliente
          '/formulario/', // Links de captura privados (com leadId)
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
