import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async get(key: string): Promise<string | null> {
    try {
      const setting = await this.prisma.globalSetting.findUnique({
        where: { key },
      });
      return setting?.value || null;
    } catch (e) {
      console.error(`Erro ao buscar configuração [${key}] do banco:`, e.message);
      return null; // Retorna null para disparar o fallback da Env
    }
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.globalSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async getWhatsAppConfig() {
    const dbApiUrl = await this.get('EVOLUTION_API_URL');
    const dbApiKey = await this.get('EVOLUTION_GLOBAL_APIKEY');
    const dbWebhookUrl = await this.get('WEBHOOK_URL');

    console.log('Configurações carregadas do Banco:', { dbApiUrl, dbApiKey, dbWebhookUrl });

    return {
      apiUrl: dbApiUrl || process.env.EVOLUTION_API_URL,
      apiKey: dbApiKey || process.env.EVOLUTION_GLOBAL_APIKEY,
      webhookUrl: dbWebhookUrl || `${process.env.PUBLIC_API_URL || 'https://andrelustosaadvogados.com.br/api'}/webhooks/evolution`,
    };
  }

  async setWhatsAppConfig(apiUrl: string, apiKey: string, webhookUrl?: string) {
    await this.set('EVOLUTION_API_URL', apiUrl);
    await this.set('EVOLUTION_GLOBAL_APIKEY', apiKey);
    if (webhookUrl) {
      await this.set('WEBHOOK_URL', webhookUrl);
    }
  }

  async getAiConfig() {
    const apiKey = await this.get('OPENAI_API_KEY');
    const defaultModel = (await this.get('OPENAI_DEFAULT_MODEL')) || 'gpt-4o-mini';
    return {
      apiKey: apiKey || process.env.OPENAI_API_KEY || null,
      isConfigured: !!(apiKey || process.env.OPENAI_API_KEY),
      defaultModel,
    };
  }

  async setAiConfig(apiKey: string) {
    await this.set('OPENAI_API_KEY', apiKey); // BUG CORRIGIDO: era 'OPENAI_KEY'
  }

  async getDefaultModel(): Promise<string> {
    return (await this.get('OPENAI_DEFAULT_MODEL')) || 'gpt-4o-mini';
  }

  async setDefaultModel(model: string): Promise<void> {
    await this.set('OPENAI_DEFAULT_MODEL', model);
  }

  async getSkills() {
    let skills = await (this.prisma as any).promptSkill.findMany({
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    });

    if (skills.length === 0) {
      const defaultSkills = [
        {
          name: 'Triagem Geral',
          area: 'Geral',
          system_prompt: 'Você é um assistente de pré-atendimento do escritório {{firm_name}}.\nSeu objetivo é acolher o cliente {{lead_name}}, entender o problema jurídico com empatia e coletar informações essenciais do caso.\nResponda de forma humana e curta (máximo 3 frases, adequado para WhatsApp).\nNão forneça aconselhamento jurídico — apenas colete informações para o advogado.\nSe o cliente perguntar sobre honorários ou quiser falar com advogado, diga: ESCALAR_HUMANO',
          model: 'gpt-4o-mini',
          max_tokens: 300,
          temperature: 0.7,
          handoff_signal: 'ESCALAR_HUMANO',
          active: true,
          order: 0,
        },
        {
          name: 'Trabalhista',
          area: 'Trabalhista',
          system_prompt: 'Você é um assistente especializado em direito trabalhista do escritório {{firm_name}}.\nAtendendo {{lead_name}}. Área detectada: {{legal_area}}.\nColete: data de demissão, tipo de contrato, CTPS assinada, verbas recebidas, motivo da demissão.\nResponda de forma empática e objetiva (máximo 3 frases, WhatsApp).\nNão forneça pareceres jurídicos. Se pedirem orçamento ou quiserem falar com advogado: ESCALAR_HUMANO',
          model: 'gpt-4o-mini',
          max_tokens: 300,
          temperature: 0.7,
          handoff_signal: 'ESCALAR_HUMANO',
          active: true,
          order: 1,
        },
        {
          name: 'Civil',
          area: 'Civil',
          system_prompt: 'Você é um assistente de pré-atendimento em direito civil do escritório {{firm_name}}.\nAtendendo {{lead_name}}. Área: {{legal_area}}.\nColete: tipo de problema (contrato, dano, propriedade), valor envolvido, documentação disponível.\nResponda com empatia e brevidade (máximo 3 frases, WhatsApp).\nPara orçamentos ou advogado: ESCALAR_HUMANO',
          model: 'gpt-4o-mini',
          max_tokens: 300,
          temperature: 0.7,
          handoff_signal: 'ESCALAR_HUMANO',
          active: false,
          order: 2,
        },
        {
          name: 'Família',
          area: 'Família',
          system_prompt: 'Você é um assistente de pré-atendimento em direito de família do escritório {{firm_name}}.\nAtendendo {{lead_name}}. Área: {{legal_area}}.\nColete com cuidado e empatia: tipo de situação (divórcio, guarda, pensão, inventário), filhos menores, bens em comum.\nSeja acolhedor e sensível. Máximo 3 frases curtas.\nPara advogado ou orçamento: ESCALAR_HUMANO',
          model: 'gpt-4o-mini',
          max_tokens: 300,
          temperature: 0.8,
          handoff_signal: 'ESCALAR_HUMANO',
          active: false,
          order: 3,
        },
      ];

      for (const s of defaultSkills) {
        await (this.prisma as any).promptSkill.create({ data: s });
      }
      skills = await (this.prisma as any).promptSkill.findMany({
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
      });
    }

    return skills.map((s: any) => ({
      id: s.id,
      name: s.name,
      area: s.area,
      systemPrompt: s.system_prompt,
      model: s.model || 'gpt-4o-mini',
      maxTokens: s.max_tokens || 300,
      temperature: s.temperature ?? 0.7,
      handoffSignal: s.handoff_signal || null,
      isActive: s.active,
      order: s.order || 0,
    }));
  }

  async toggleSkill(id: string, active: boolean) {
    return (this.prisma as any).promptSkill.update({
      where: { id },
      data: { active },
    });
  }

  async createSkill(data: {
    name: string;
    area: string;
    system_prompt: string;
    model?: string;
    max_tokens?: number;
    temperature?: number;
    handoff_signal?: string | null;
    active?: boolean;
    order?: number;
  }) {
    return (this.prisma as any).promptSkill.create({ data });
  }

  async updateSkill(
    id: string,
    data: Partial<{
      name: string;
      area: string;
      system_prompt: string;
      model: string;
      max_tokens: number;
      temperature: number;
      handoff_signal: string | null;
      active: boolean;
      order: number;
    }>,
  ) {
    return (this.prisma as any).promptSkill.update({ where: { id }, data });
  }

  async deleteSkill(id: string) {
    return (this.prisma as any).promptSkill.delete({ where: { id } });
  }
}
