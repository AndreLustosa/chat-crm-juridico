import { HomeTemplate } from '@/components/lp/templates/HomeTemplate';
import { LPTracker } from '@/components/lp/LPTracker';
import localFont from 'next/font/local';
import { Playfair_Display } from 'next/font/google';
import Script from 'next/script';
import { Metadata } from 'next';

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://andrelustosaadvogados.com.br';

const staticContent = {
  hero: {
    title: 'ANDRÉ LUSTOSA ADVOGADOS',
    subtitle:
      'Especialistas na proteção dos seus direitos. Atendimento humano, ágil e focado em resultados nas áreas Trabalhista, Previdenciária, Civil e do Consumidor, em todo o Brasil.',
    ctaText: 'Fale com um Especialista',
    ctaLink: 'https://wa.me/5582996390799',
  },
  steps: [
    {
      title: 'Agendamento de Consulta',
      description: 'Entre em contato via WhatsApp para uma análise preliminar e agendamento.',
    },
    {
      title: 'Análise Estratégica',
      description: 'Nossos especialistas farão um estudo aprofundado do seu caso.',
    },
    {
      title: 'Atuação e Resultados',
      description: 'Atuamos com agilidade e transparência durante todo o processo.',
    },
  ],
  faq: [
    {
      question: 'Qual o horário de atendimento?',
      answer: 'Temos atendimento 24 horas para urgências e em horário comercial presencialmente.',
    },
    {
      question: 'Atendem online?',
      answer: 'Sim, atuamos digitalmente em todo o Brasil.',
    },
    {
      question: 'Onde o escritório está localizado caso eu precise de atendimento presencial?',
      answer:
        'Nossa matriz física fica localizada na Rua Francisco Rodrigues Viana, 244, bairro Baixa Grande, Arapiraca - AL.',
    },
  ],
  footer: {
    address: 'Atendimento Digital em Todo o Brasil | Sede Física: Arapiraca/AL',
    phones: ['82 99639-0799'],
    email: 'contato@andrelustosa.com.br',
    social: {
      instagram: 'https://www.instagram.com/andrelustosaadvogados/',
      facebook: 'https://www.facebook.com/andrelustosa',
      linkedin: '',
    },
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const title = 'André Lustosa Advogados | Escritório Digital';
  const description =
    'Escritório de advocacia atuando em todo o Brasil. Direito Trabalhista, Previdenciário, Consumidor e Civil. Agende sua consulta online.';
  const url = `${baseUrl}/`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: 'André Lustosa Advogados',
      locale: 'pt_BR',
      type: 'website',
      images: [{ url: '/logo_andre_lustosa.png', width: 1200, height: 630, alt: title }],
    },
    robots: { index: true, follow: true },
  };
}

const neueMontreal = localFont({
  src: [
    { path: '../../public/fonts/NeueMontreal-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../../public/fonts/NeueMontreal-Medium.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-neue-montreal',
  display: 'swap',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
});

export default function Home() {
  const url = `${baseUrl}/`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LegalService',
    name: 'André Lustosa Advogados',
    image: `${baseUrl}/logo_andre_lustosa.png`,
    url,
    telephone: '+5582996390799',
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Rua Francisco Rodrigues Viana, 244',
      addressLocality: 'Arapiraca',
      addressRegion: 'AL',
      postalCode: '57300-000',
      addressCountry: 'BR',
    },
    sameAs: [
      'https://www.instagram.com/andrelustosaadvogados/',
      'https://www.facebook.com/andrelustosa',
    ],
  };

  return (
    <div className={`${neueMontreal.variable} ${playfair.variable} font-sans`}>
      <Script
        id="json-ld"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <LPTracker />
      <HomeTemplate
        content={staticContent}
        whatsappNumber="+5582996390799"
      />
    </div>
  );
}
