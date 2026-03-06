import type { Metadata } from 'next';
import { Ubuntu_Sans } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { GTMScript, GTMNoScript } from '@/components/GTMScript';

const ubuntuSans = Ubuntu_Sans({
  subsets: ['latin'],
  variable: '--font-ubuntu',
});

export const metadata: Metadata = {
  title: 'André Lustosa Advogados | Advocacia Especializada',
  description: 'Escritório de advocacia especializado em direito previdenciário, trabalhista e cível em Alagoas.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={ubuntuSans.variable}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap" rel="stylesheet" />
        {/* Google Tag Manager */}
        <GTMScript />
      </head>
      <body className="font-sans antialiased text-foreground bg-background">
        {/* GTM noscript fallback */}
        <GTMNoScript />
        <Providers>
          <main className="min-h-screen flex flex-col">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
