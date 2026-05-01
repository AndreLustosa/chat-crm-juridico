import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { Providers } from './providers';
import { GTMScript, GTMNoScript } from '@/components/GTMScript';
import { Toaster } from 'react-hot-toast';

const ubuntuSans = localFont({
  src: [
    { path: '../../public/fonts/NeueMontreal-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../../public/fonts/NeueMontreal-Medium.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-ubuntu',
  display: 'swap',
});

const appUrl =
  process.env.NEXT_PUBLIC_APP_URL || 'https://andrelustosaadvogados.com.br';

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: 'André Lustosa Advogados | Advocacia Especializada',
  description: 'Escritório de advocacia especializado em direito previdenciário, trabalhista e cível em Alagoas.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={ubuntuSans.variable}>
      <head>
        {/* Google Tag Manager */}
        <GTMScript />
      </head>
      <body className="font-sans antialiased text-foreground bg-background">
        {/* GTM noscript fallback */}
        <GTMNoScript />
        <Providers>
          <Toaster position="top-right" toastOptions={{ style: { fontSize: '14px' } }} />
          <main className="min-h-screen flex flex-col">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
