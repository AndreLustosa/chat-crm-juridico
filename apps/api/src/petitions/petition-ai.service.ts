import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { tenantOrDefault } from '../common/constants/tenant';
import { maskCpf, maskCnpj, maskRg, maskAddress, maskSalary } from '../common/utils/lgpd-mask.util';
import { assertAiCostCap } from '../common/utils/ai-cost-cap.util';
import OpenAI from 'openai';
import { buildTokenParam } from '../common/utils/openai-token-param.util';

// Bug fix 2026-05-10 (Peticoes PR1 #14): timeout de 120s pra chamadas
// OpenAI. Antes sem timeout — fetch ficava in-flight indefinidamente.
const OPENAI_TIMEOUT_MS = 120_000;
// max_tokens cap pra prevenir resposta gigante de US$ 5+
const PETITION_MAX_TOKENS = 4096;

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
   *
   * Bug fix 2026-05-10 (Peticoes PR1):
   *   - #6: cost cap por user/tenant antes da chamada
   *   - #5: LGPD mask (CPF/RG/etc) por default; raw apenas se lgpdConsent=true
   *   - #9: tenantId obrigatorio pra evitar bypass de validacao
   *   - #10: audit log completo (user, tenant, petition_id) no AiUsage
   *   - #11: content_json = null (frontend renderiza do HTML — fim do stub)
   *   - #12: nome do escritorio + advogado injetado no prompt (anti-OAB-falsa)
   *   - #14: OpenAI client com timeout 120s
   */
  async generate(
    petitionId: string,
    userId: string,
    tenantId: string,
    opts: { lgpdConsent?: boolean } = {},
  ): Promise<any> {
    if (!tenantId) throw new BadRequestException('tenantId obrigatorio');
    if (!userId) throw new BadRequestException('userId obrigatorio');

    // Bug fix #6: cost cap PRE-chamada (impede DoS financeiro)
    await assertAiCostCap(this.prisma, userId, tenantId);

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
            lawyer: { select: { id: true, name: true, email: true } },
            tenant: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!petition) throw new NotFoundException('Petição não encontrada');
    // Bug fix #9: tenantId obrigatorio — bypass impossivel agora
    if (petition.tenant_id !== tenantId) {
      throw new NotFoundException('Petição não encontrada');
    }

    const legalCase = petition.legal_case;
    const lead = legalCase.lead;

    // 2. Obter API key
    const aiConfig = await this.settings.getAiConfig();
    if (!aiConfig.apiKey) {
      throw new BadRequestException('API key do OpenAI não configurada. Configure em Ajustes > IA.');
    }

    // 3. Montar prompt — com identificacao do escritorio (#12)
    const systemPrompt = this.buildSystemPrompt(
      legalCase.legal_area || 'geral',
      petition.type,
      (legalCase as any).tenant?.name || null,
      (legalCase as any).lawyer?.name || null,
    );
    // Bug fix #5: LGPD mask por default
    const userPrompt = this.buildUserPrompt(legalCase, lead, opts.lgpdConsent || false);

    // 4. Chamar OpenAI com timeout (#14)
    const model = (await this.settings.get('AI_PETITION_MODEL')) || 'gpt-4o';
    const ai = new OpenAI({ apiKey: aiConfig.apiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: 2 });

    // Bug fix 2026-05-10 (Peticoes PR3 #27):
    // prompt_hash + first chars do system/user pra investigar
    // incidente "peticao saiu com nome errado" sem capturar prompts
    // completos (privacidade). Hash sha256 reproduzivel — mesmo
    // input gera mesmo hash, util pra detectar reuso.
    const promptHash = require('crypto').createHash('sha256')
      .update(systemPrompt + '\n' + userPrompt)
      .digest('hex')
      .slice(0, 16);
    this.logger.log(
      `[PETITION-IA] Gerando ${petitionId} model=${model} user=${userId} tenant=${tenantId} ` +
      `lgpd_consent=${!!opts.lgpdConsent} prompt_hash=${promptHash} ` +
      `system_chars=${systemPrompt.length} user_chars=${userPrompt.length}`,
    );

    const response = await ai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      ...buildTokenParam(model, PETITION_MAX_TOKENS),
      temperature: 0.4,
    });

    const contentHtml = response.choices[0]?.message?.content || '';
    if (!contentHtml.trim()) {
      throw new BadRequestException('IA retornou conteúdo vazio');
    }

    // Bug fix #11: content_json = null. Antes htmlToTiptapJson retornava
    // doc com texto literal "(Conteudo gerado por IA — carregando...)".
    // Frontend renderiza direto do content_html via TiptapEditor —
    // setando JSON null forca esse path.
    const updated = await this.prisma.casePetition.update({
      where: { id: petitionId },
      data: {
        content_html: contentHtml,
        content_json: null as any,
      },
      include: {
        created_by: { select: { id: true, name: true } },
        _count: { select: { versions: true } },
      },
    });

    // 7. Registrar uso (audit completo #10 + prompt_hash #27)
    await this.saveUsage(model, response.usage, petition.legal_case_id, userId, tenantId, petitionId, promptHash);

    this.logger.log(
      `[PETITION-IA] ${petitionId} gerada tokens=${response.usage?.total_tokens || 0} prompt_hash=${promptHash}`,
    );

    return updated;
  }

  /**
   * Cria petição + gera conteúdo em um passo.
   */
  async createAndGenerate(
    caseId: string,
    data: { title: string; type: string; lgpdConsent?: boolean },
    userId: string,
    tenantId: string,
  ): Promise<any> {
    if (!tenantId) throw new BadRequestException('tenantId obrigatorio');

    // Criar petição vazia
    const petition = await this.prisma.casePetition.create({
      data: {
        legal_case_id: caseId,
        created_by_id: userId,
        tenant_id: tenantOrDefault(tenantId),
        title: data.title,
        type: data.type,
        status: 'RASCUNHO',
      },
    });

    // Gerar conteúdo
    return this.generate(petition.id, userId, tenantId, { lgpdConsent: data.lgpdConsent });
  }

  // ─── Private helpers ────────────────────────────────────

  /**
   * Bug fix 2026-05-10 (Peticoes PR1 #12):
   * Antes prompt nao passava nome do escritorio nem advogado. IA podia
   * inventar "Dr. Joao Silva, OAB/SP 12345". Peticao protocolada com
   * OAB falsa = exercicio irregular da advocacia (LCP art. 47).
   * Agora prompt EXIGE placeholders [OAB/UF numero] e [Nome do advogado]
   * em vez de inventar — advogado preenche manual antes de protocolar.
   */
  private buildSystemPrompt(
    legalArea: string,
    petitionType: string,
    officeName: string | null,
    lawyerName: string | null,
  ): string {
    const typeLabel = TYPE_LABELS[petitionType] || 'Petição';
    const identityBlock = officeName || lawyerName
      ? `\nESCRITORIO RESPONSAVEL: ${officeName || '[Nome do escritorio]'}\nADVOGADO RESPONSAVEL: ${lawyerName || '[Nome do advogado]'}\nAo assinar, USE EXATAMENTE essa identificacao.`
      : '';

    return `Você é um advogado brasileiro experiente, especializado em direito ${legalArea}.
Sua tarefa é redigir uma ${typeLabel} completa e bem fundamentada.${identityBlock}

REGRAS:
- Use linguagem jurídica formal e técnica, adequada para peticionar em juízo.
- Estruture o documento com: ENDEREÇAMENTO, QUALIFICAÇÃO DAS PARTES, DOS FATOS, DO DIREITO (FUNDAMENTOS JURÍDICOS), DOS PEDIDOS, e REQUERIMENTOS FINAIS.
- Cite artigos de lei, CLT, CPC, CF/88 e jurisprudência relevante quando aplicável.
- Adapte o conteúdo à área de ${legalArea}.
- Se não houver dados suficientes para alguma seção, inclua placeholders entre colchetes [COMPLETAR: descrição].
- NUNCA invente OAB de advogado. Use SEMPRE o placeholder [OAB/UF numero] na assinatura — advogado preenche antes de protocolar.
- Retorne o conteúdo em HTML limpo (use <h2>, <h3>, <p>, <strong>, <em>, <ul>, <ol>, <li>).
- NÃO inclua tags <html>, <head>, <body>. Apenas o conteúdo da petição.`;
  }

  /**
   * Bug fix 2026-05-10 (Peticoes PR1 #5):
   * Antes CPF/RG/endereco/CNPJ/salario iam pra OpenAI em plaintext —
   * provider US sem DPA, viola LGPD (multa ANPD + risco reputacional).
   * Agora mascara por default (xxx.xxx.xxx-12). Advogado pode marcar
   * lgpdConsent=true na UI pra enviar raw quando IP autoral exigir
   * (rara — peticao normalmente referencia "[CPF]").
   */
  private buildUserPrompt(legalCase: any, lead: any, lgpdConsent: boolean): string {
    const parts: string[] = [];

    parts.push('=== DADOS DO CLIENTE ===');
    parts.push(`Nome: ${lead.name || '[Nome não informado]'}`);
    // Telefone/email mascarados por default
    if (lead.phone) parts.push(`Telefone: ${lgpdConsent ? lead.phone : '[telefone do cliente — preencher antes de protocolar]'}`);
    if (lead.email) parts.push(`E-mail: ${lgpdConsent ? lead.email : '[email do cliente — preencher antes de protocolar]'}`);

    // Ficha trabalhista (resumo dos campos mais relevantes)
    if (lead.ficha_trabalhista?.data) {
      parts.push('\n=== FICHA DO CASO ===');
      const ficha = lead.ficha_trabalhista.data as any;
      if (ficha.nome_completo) parts.push(`Nome completo: ${ficha.nome_completo}`);
      if (ficha.cpf) parts.push(`CPF: ${lgpdConsent ? ficha.cpf : maskCpf(ficha.cpf)}`);
      if (ficha.rg) parts.push(`RG: ${lgpdConsent ? ficha.rg : maskRg(ficha.rg)}`);
      if (ficha.endereco_completo) parts.push(`Endereço: ${lgpdConsent ? ficha.endereco_completo : maskAddress(ficha.endereco_completo)}`);
      if (ficha.nome_empregador) parts.push(`Empregador: ${ficha.nome_empregador}`);
      if (ficha.cnpj_empregador) parts.push(`CNPJ Empregador: ${lgpdConsent ? ficha.cnpj_empregador : maskCnpj(ficha.cnpj_empregador)}`);
      if (ficha.cargo) parts.push(`Cargo: ${ficha.cargo}`);
      if (ficha.data_admissao) parts.push(`Admissão: ${ficha.data_admissao}`);
      if (ficha.data_demissao) parts.push(`Demissão: ${ficha.data_demissao}`);
      if (ficha.motivo_demissao) parts.push(`Motivo: ${ficha.motivo_demissao}`);
      if (ficha.salario) parts.push(`Último salário: ${lgpdConsent ? `R$ ${ficha.salario}` : maskSalary(ficha.salario)}`);
      if (ficha.jornada_trabalho) parts.push(`Jornada: ${ficha.jornada_trabalho}`);
      if (ficha.fazia_hora_extra) parts.push(`Horas extras: ${ficha.fazia_hora_extra}`);
      if (ficha.direitos_nao_pagos) parts.push(`Direitos não pagos: ${ficha.direitos_nao_pagos}`);
      if (ficha.descricao_problema) parts.push(`Descrição do problema: ${ficha.descricao_problema}`);
    }

    if (!lgpdConsent) {
      parts.push('\n=== AVISO IMPORTANTE PRA IA ===');
      parts.push('Os dados pessoais (CPF, RG, endereço, salário) foram MASCARADOS por questão de privacidade (LGPD).');
      parts.push('Use placeholders nos lugares correspondentes da peticao — advogado preenche valores reais antes de protocolar.');
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
   * Bug fix 2026-05-10 (Peticoes PR1 #11):
   * REMOVIDO. Antes esta funcao retornava `{ type: 'doc', content: [{
   * type: 'paragraph', content: [{ type: 'text', text: '(Conteudo
   * gerado por IA — carregando do HTML...)' }] }]}` — um STUB com
   * texto literal. Se o frontend caisse de volta ao content_json
   * (Tiptap state) por bug ou export pra docx, o documento PROTOCOLADO
   * teria literalmente o texto "(Conteudo gerado por IA — carregando
   * do HTML...)". Constrangimento + nulidade processual.
   *
   * Agora salvamos `content_json: null` no DB e o frontend renderiza
   * direto do content_html via TiptapEditor.parseHTML — fim do stub.
   */

  /**
   * Bug fix 2026-05-10 (Peticoes PR1 #10):
   * Audit log completo. Antes saveUsage so gravava model+tokens+cost
   * com conversation_id e skill_id null. Sem user_id, tenant_id,
   * petition_id, IP — incidente "petição saiu com nome errado" sem
   * responsavel rastreavel. Agora grava metadata completo.
   */
  private async saveUsage(
    model: string,
    usage: any,
    legalCaseId: string | null,
    userId: string,
    tenantId: string,
    petitionId: string,
    promptHash?: string,
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
        // Bug fix #10: contexto pra investigacao
        user_id: userId,
        tenant_id: tenantId,
        // Metadata estruturada — schema atual nao tem petition_id direto,
        // grava em meta_json se schema permitir, senao loga no descritor
        // (TODO: migration adicionar coluna petition_id no AiUsage)
        meta_json: {
          petition_id: petitionId,
          legal_case_id: legalCaseId,
          ...(promptHash ? { prompt_hash: promptHash } : {}),
        } as any,
      } as any,
    });
  }
}
