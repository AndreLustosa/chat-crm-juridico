import { Metadata } from 'next';
import localFont from 'next/font/local';
import { Playfair_Display } from 'next/font/google';

export const metadata: Metadata = {
  title: 'Portal do Cliente | André Lustosa Advogados',
  description: 'Acompanhe seu processo, documentos e pagamentos online.',
  robots: { index: false, follow: false },
};

const neueMontreal = localFont({
  src: [
    { path: '../../../public/fonts/NeueMontreal-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../../../public/fonts/NeueMontreal-Medium.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-neue-montreal',
  display: 'swap',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
});

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${neueMontreal.variable} ${playfair.variable} font-sans min-h-screen bg-[#0a0a0f] text-white flex flex-col`}>
      {children}
    </div>
  );
}
