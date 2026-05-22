'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="escuro"
      themes={['escuro', 'claro', 'rose', 'azul', 'verde', 'aurum']}
      enableSystem={false}
    >
      {children}
    </NextThemesProvider>
  );
}
