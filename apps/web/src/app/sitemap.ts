import { MetadataRoute } from 'next';

const baseUrl =
  process.env.NEXT_PUBLIC_APP_URL || 'https://andrelustosaadvogados.com.br';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1,
    },
    {
      url: `${baseUrl}/geral/arapiraca`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/arapiraca/trabalhista`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/arapiraca/trabalhista/verbas-rescisorias`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.92,
    },
    {
      url: `${baseUrl}/arapiraca/trabalhista/verbas-rescisorias/dispensa-sem-justa-causa`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.88,
    },
    {
      url: `${baseUrl}/arapiraca/trabalhista/verbas-rescisorias/pedido-de-demissao`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.88,
    },
    {
      url: `${baseUrl}/arapiraca/trabalhista/verbas-rescisorias/justa-causa`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.88,
    },
    {
      url: `${baseUrl}/arapiraca/trabalhista/verbas-rescisorias/rescisao-indireta`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.88,
    },
    {
      url: `${baseUrl}/arapiraca/trabalhista/verbas-rescisorias/rescisao-por-acordo`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.88,
    },
    {
      url: `${baseUrl}/arapiraca/trabalhista/verbas-rescisorias/contrato-de-experiencia`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.88,
    },
    {
      url: `${baseUrl}/arapiraca/trabalhista/verbas-rescisorias/aviso-previo`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.88,
    },
    {
      url: `${baseUrl}/arapiraca/trabalhista/verbas-rescisorias/fgts-multa-40`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.88,
    },
    {
      url: `${baseUrl}/arapiraca/criminal`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/arapiraca/criminal/medidas-protetivas`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.85,
    },
    {
      url: `${baseUrl}/arapiraca/criminal/defesa-homem-lei-maria-da-penha`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.85,
    },
    {
      url: `${baseUrl}/arapiraca/trabalhista/sem-carteira-assinada`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
  ];
}
