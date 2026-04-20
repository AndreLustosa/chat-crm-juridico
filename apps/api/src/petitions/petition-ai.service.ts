import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import OpenAI from 'openai';

const TYPE_LABELS: Record<string, string> = {
  INICIAL: 'Petição Inicial',
  CONTESTACAO: 'Contestação',
  REPLICA: 'Réplica',
  EMBARGOS: 'Embargos de Declaração',
  RECURSO: 'Recurso Ordinário',
  MANIFESTACAO: 'Manifestação',
  OUTRO: 'Petição',
};

const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini':  { input: 0.15,  output: 0.60  },
  'gpt-4o':       { input: 5.00,  output: 15.00 },
  'gpt-4.1':      { input: 2.00,  output: 8.00  },
  'gpt-4.1-mini': { input: 0.40,  output: 1.60  },
  'gpt-5':        { input: 15.00, output: 60.00 },
};

@Injectable()
export class PetitionAiService {
  private readonly logger = new Logger(PetitionAiService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  /**
   * Gera conteúdo de petição via OpenAI para uma petição existente.
   */
  async generate(petitionId: string, tenantId?: string): Promise<any> {
    // 1. Buscar petição com caso e dados relacionados
    const petition = await this.prisma.casePetition.findUnique({
      where: { id: petitionId },
      include: {
        legal_case: {
          include: {
            lead: {
              include: {
                profile: true, // LeadProfile (sistema novo — 2026-04-20)
                ficha_trabalhista: true,
              },
            },
            events: { orderBy: { created_at: 'desc' }, take: 10 },
            deadlines: { orderBy: { due_at: 'asc' }, take: 5 },
          },
        },
      },
    });

    if (!petition) throw new NotFoundException('Petição não encontrada');
    if (tenantId && petition.tenant_id && petition.tenant_id !== tenantId) {
      throw new NotFoundException('Petição não encontrada');
    }

    const legalCase = petition.legal_case;
    const lead = legalCase.lead;

    // 2. Obter API key
    const aiConfig = await this.settings.getAiConfig();
    if (!aiConfig.apiKey) {
      throw new BadRequestException('API key do OpenAI não configurada. Configure em Ajustes > IA.');
    }

    // 3. Montar prompt
    const systemPrompt = this.buildSystemPrompt(
      legalCase.legal_area || 'geral',
      petition.type,
    );
    const userPrompt = this.buildUserPrompt(legalCase, lead);

    // 4. Chamar OpenAI
    const model = (await this.settings.get('AI_PETITION_MODEL')) || 'gpt-4o';
    const ai = new OpenAI({ apiKey: aiConfig.apiKey });

    this.logger.log(`Gerando petição ${petitionId} com ${model}...`);

    const response = await ai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0.4,
    });

    const contentHtml = response.choices[0]?.message?.content || '';
    if (!contentHtml.trim()) {
      throw new BadRequestException('IA retornou conteúdo vazio');
    }

    // 5. Converter HTML para Tiptap JSON simplificado
    const contentJson = this.htmlToTiptapJson(contentHtml);

    // 6. Salvar na petição
    const updated = await this.prisma.casePetition.update({
      where: { id: petitionId },
      data: {
        content_html: contentHtml,
        content_json: contentJson,
      },
      include: {
        created_by: { select: { id: true, name: true } },
        _count: { select: { versions: true } },
      },
    });

    // 7. Registrar uso
    await this.saveUsage(model, response.usage, petition.legal_case_id);

    this.logger.log(
      `Petição ${petitionId} gerada: ${response.usage?.total_tokens || 0} tokens`,
    );

    return updated;
  }

  /**
   * Cria petição + gera conteúdo em um passo.
   */
  async createAndGenerate(
    caseId: string,
    data: { title: string; type: string },
    userId: string,
    tenantId?: string,
  ): Promise<any> {
    // Criar petição vazia
    const petition = await this.prisma.casePetition.create({
      data: {
        legal_case_id: caseId,
        created_by_id: userId,
        tenant_id: tenantId || null,
        title: data.title,
        type: data.type,
        status: 'RASCUNHO',
      },
    });

    // Gerar conteúdo
    return this.generate(petition.id, tenantId);
  }

  // ─── Private helpers ────────────────────────────────────

  private buildSystemPrompt(legalArea: string, petitionType: string): string {
    const typeLabel = TYPE_LABELS[petitionType] || 'Petição';
    return `Você é um advogado brasileiro experiente, especializado em direito ${legalArea}.
Sua tarefa é redigir uma ${typeLabel} completa e bem fundamentada.

REGRAS:
- Use linguagem jurídica formal e técnica, adequada para peticionar em juízo.
- Estruture o documento com: ENDEREÇAMENTO, QUALIFICAÇÃO DAS PARTES, DOS FATOS, DO DIREITO (FUNDAMENTOS JURÍDICOS), DOS PEDIDOS, e REQUERIMENTOS FINAIS.
- Cite artigos de lei, CLT, CPC, CF/88 e jurisprudência relevante quando aplicável.
- Adapte o conteúdo à área de ${legalArea}.
- Se não houver dados suficientes para alguma seção, inclua placeholders entre colchetes [COMPLETAR: descrição].
- Retorne o conteúdo em HTML limpo (use <h2>, <h3>, <p>, <strong>, <em>, <ul>, <ol>, <li>).
- NÃO inclua tags <html>, <head>, <body>. Apenas o conteúdo da petição.`;
  }

  private buildUserPrompt(legalCase: any, lead: any): string {
    const parts: string[] = [];

    parts.push('=== DADOS DO CLIENTE ===');
    parts.push(`Nome: ${lead.name || '[Nome não informado]'}`);
    if (lead.phone) parts.push(`Telefone: ${lead.phone}`);
    if (lead.email) parts.push(`E-mail: ${lead.email}`);

    // Ficha trabalhista (resumo dos campos mais relevantes)
    if (lead.ficha_trabalhista?.data) {
      parts.push('\n=== FICHA DO CASO ===');
      const ficha = lead.ficha_trabalhista.data as any;
      if (ficha.nome_completo) parts.push(`Nome completo: ${ficha.nome_completo}`);
      if (ficha.cpf) parts.push(`CPF: ${ficha.cpf}`);
      if (ficha.rg) parts.push(`RG: ${ficha.rg}`);
      if (ficha.endereco_completo) parts.push(`Endereço: ${ficha.endereco_completo}`);
      if (ficha.nome_empregador) parts.push(`Empregador: ${ficha.nome_empregador}`);
      if (ficha.cnpj_empregador) parts.push(`CNPJ Empregador: ${ficha.cnpj_empregador}`);
      if (ficha.cargo) parts.push(`Cargo: ${ficha.cargo}`);
      if (ficha.data_admissao) parts.push(`Admissão: ${ficha.data_admissao}`);
      if (ficha.data_demissao) parts.push(`Demissão: ${ficha.data_demissao}`);
      if (ficha.motivo_demissao) parts.push(`Motivo: ${ficha.motivo_demissao}`);
      if (ficha.salario) parts.push(`Último salário: R$ ${ficha.salario}`);
      if (ficha.jornada_trabalho) parts.push(`Jornada: ${ficha.jornada_trabalho}`);
      if (ficha.fazia_hora_extra) parts.push(`Horas extras: ${ficha.fazia_hora_extra}`);
      if (ficha.direitos_nao_pagos) parts.push(`Direitos não pagos: ${ficha.direitos_nao_pagos}`);
      if (ficha.descricao_problema) parts.push(`Descrição do problema: ${ficha.descricao_problema}`);
    }

    // Perfil do cliente (LeadProfile — sistema novo desde 2026-04-20, fase 2d-2)
    if (lead.profile?.summary) {
      parts.push('\n=== PERFIL DO CLIENTE (consolidado pela IA) ===');
      parts.push(lead.profile.summary);
    }

    // Detalhes do caso
    parts.push('\n=== DETALHES PROCESSUAIS ===');
    if (legalCase.legal_area) parts.push(`Área: ${legalCase.legal_area}`);
    if (legalCase.action_type) parts.push(`Tipo de ação: ${legalCase.action_type}`);
    if (legalCase.claim_value) parts.push(`Valor da causa: R$ ${legalCase.claim_value}`);
    if (legalCase.opposing_party) parts.push(`Parte contrária: ${legalCase.opposing_party}`);
    if (legalCase.court) parts.push(`Vara/Tribunal: ${legalCase.court}`);
    if (legalCase.judge) parts.push(`Juiz: ${legalCase.judge}`);
    if (legalCase.case_number) parts.push(`Número do processo: ${legalCase.case_number}`);
    if (legalCase.notes) parts.push(`Observações: ${legalCase.notes}`);

    // Eventos do caso
    if (legalCase.events?.length > 0) {
      parts.push('\n=== EVENTOS RECENTES ===');
      for (const ev of legalCase.events.slice(0, 5)) {
        parts.push(`- [${ev.type}] ${ev.title}${ev.description ? ': ' + ev.description : ''}`);
      }
    }

    parts.push('\n\nCom base nas informações acima, redija a petição completa.');

    return parts.join('\n');
  }

  /**
   * Converte HTML simples para Tiptap JSON (ProseMirror doc).
   * Abordagem: criar um doc com um único nó paragraph contendo o HTML como texto.
   * O TiptapEditor no frontend interpretará content_html diretamente.
   */
  private htmlToTiptapJson(html: string): any {
    // Para o Tiptap, é mais confiável armazenar o HTML e deixar
    // o editor frontend fazer o parsing. Retornamos um doc mínimo.
    return {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '(Conteúdo gerado por IA — carregando do HTML...)' }],
        },
      ],
    };
  }

  private async saveUsage(
    model: string,
    usage: any,
    legalCaseId?: string,
  ): Promise<void> {
    if (!usage) return;

    const priceEntry = Object.entries(OPENAI_PRICING).find(([key]) =>
      model.startsWith(key),
    );
    const price = priceEntry ? priceEntry[1] : { input: 5.0, output: 15.0 };

    const costUsd =
      (usage.prompt_tokens * price.input) / 1_000_000 +
      (usage.completion_tokens * price.output) / 1_000_000;

    await this.prisma.aiUsage.create({
      data: {
        conversation_id: null,
        skill_id: null,
        model,
        call_type: 'petition',
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0,
        cost_usd: costUsd,
      },
    });
  }
}
