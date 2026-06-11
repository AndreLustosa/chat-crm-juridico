import type { Metadata } from 'next';

// Formularios de captura usam links unicos por lead (UUID na URL).
// Nao devem ser indexados pelo Google em hipotese alguma. Reforca o
// X-Robots-Tag definido em next.config.ts e o disallow em robots.ts.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function FormularioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
