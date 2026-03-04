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
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/logo_andre_lustosa.png'],
      creator: '@andrelustosa',
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
    priceRange: '$$$',
    openingHoursSpecification: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      opens: '08:00',
      closes: '18:00',
    },
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Rua Francisco Rodrigues Viana, 244',
      addressLocality: 'Arapiraca',
      addressRegion: 'AL',
      postalCode: '57300-000',
      addressCountry: 'BR',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: -9.751,
      longitude: -36.660,
    },
    areaServed: {
      '@type': 'Country',
      name: 'Brasil',
    },
    serviceType: ['Direito Trabalhista', 'Direito Previdenciário', 'Direito do Consumidor', 'Direito Civil'],
    sameAs: [
      'https://www.instagram.com/andrelustosaadvogados/',
      'https://www.facebook.com/andrelustosa',
    ],
  };

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'Qual o horário de atendimento do escritório André Lustosa Advogados?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'O escritório André Lustosa Advogados oferece atendimento 24 horas via WhatsApp para urgências e atendimento presencial em horário comercial (segunda a sexta, 8h–18h) na sede em Arapiraca/AL.',
        },
      },
      {
        '@type': 'Question',
        name: 'O André Lustosa Advogados atende fora de Arapiraca?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Sim. O escritório André Lustosa Advogados atua digitalmente em todo o Brasil. Documentos são enviados digitalmente e consultas são realizadas por videoconferência ou WhatsApp, sem necessidade de deslocamento.',
        },
      },
      {
        '@type': 'Question',
        name: 'Quais áreas do direito o André Lustosa Advogados atende?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'O escritório André Lustosa Advogados é especializado em Direito Trabalhista (rescisão, horas extras, assédio moral), Direito Previdenciário (aposentadoria, BPC/LOAS, pensão por morte), Direito do Consumidor (cobranças indevidas, negativação no SPC/Serasa) e Direito Civil (contratos, família, imobiliário).',
        },
      },
      {
        '@type': 'Question',
        name: 'Como funciona o primeiro atendimento no André Lustosa Advogados?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'O primeiro atendimento começa pelo WhatsApp (+55 82 99639-0799). A equipe faz uma análise preliminar do caso, os especialistas estudam a situação em profundidade e a atuação inicia com agilidade e transparência.',
        },
      },
      {
        '@type': 'Question',
        name: 'Onde fica o escritório André Lustosa Advogados?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'A sede física do escritório André Lustosa Advogados fica na Rua Francisco Rodrigues Viana, 244, bairro Baixa Grande, Arapiraca – AL, CEP 57300-000. O atendimento digital cobre todo o Brasil.',
        },
      },
    ],
  };

  return (
    <div className={`${neueMontreal.variable} ${playfair.variable} font-sans`}>
      <Script
        id="json-ld"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Script
        id="json-ld-faq"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <LPTracker />
      <HomeTemplate
        content={staticContent}
        whatsappNumber="+5582996390799"
      />
    </div>
  );
}
