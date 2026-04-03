import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { SettingsService } from '../settings/settings.service';
import { UpdateFichaDto } from './dto/update-ficha.dto';
import OpenAI from 'openai';

// Total de campos úteis do formulário (para cálculo de %)
const TOTAL_FIELDS = 76;

// Campos obrigatórios para finalização (espelha FICHA_SECTIONS com required: true)
const REQUIRED_FIELDS: { key: string; label: string }[] = [
  // Pessoal
  { key: 'nome_completo', label: 'Nome Completo' },
  { key: 'cpf', label: 'CPF' },
  { key: 'data_nascimento', label: 'Data de Nascimento' },
  { key: 'nome_mae', label: 'Nome da Mãe' },
  { key: 'estado_civil', label: 'Estado Civil' },
  { key: 'nacionalidade', label: 'Nacionalidade' },
  { key: 'profissao', label: 'Profissão' },
  { key: 'telefone', label: 'Telefone' },
  { key: 'email', label: 'E-mail' },
  // Endereço
  { key: 'cep', label: 'CEP' },
  { key: 'logradouro', label: 'Logradouro' },
  { key: 'numero', label: 'Número' },
  { key: 'bairro', label: 'Bairro' },
  { key: 'cidade', label: 'Cidade' },
  { key: 'estado_uf', label: 'UF' },
  // Contrato
  { key: 'nome_empregador', label: 'Nome do Empregador' },
  { key: 'funcao', label: 'Função/Cargo' },
  { key: 'data_admissao', label: 'Data de Admissão' },
  { key: 'situacao_atual', label: 'Situação Atual' },
  { key: 'salario', label: 'Último Salário' },
  { key: 'periodicidade_pagamento', label: 'Periodicidade' },
  { key: 'ctps_numero', label: 'Nº CTPS' },
  { key: 'ctps_assinada_corretamente', label: 'CTPS assinada corretamente?' },
  { key: 'atividades_realizadas', label: 'Atividades Realizadas' },
  // Jornada
  { key: 'horario_entrada', label: 'Horário de Entrada' },
  { key: 'horario_saida', label: 'Horário de Saída' },
  { key: 'tempo_intervalo', label: 'Tempo de Intervalo' },
  { key: 'dias_trabalhados', label: 'Dias Trabalhados' },
  { key: 'fazia_horas_extras', label: 'Fazia horas extras?' },
  // Verbas
  { key: 'fgts_depositado', label: 'FGTS depositado corretamente?' },
  { key: 'fgts_sacado', label: 'Conseguiu sacar o FGTS?' },
  { key: 'tem_ferias_pendentes', label: 'Tem férias pendentes?' },
  { key: 'tem_decimo_terceiro_pendente', label: 'Tem 13º pendente?' },
  // Provas
  { key: 'possui_testemunhas', label: 'Possui testemunhas?' },
  { key: 'possui_provas_documentais', label: 'Possui provas documentais?' },
];

@Injectable()
export class FichaTrabalhistaService {
  private readonly logger = new Logger(FichaTrabalhistaService.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
    private gateway: ChatGateway,
    private settings: SettingsService,
  ) {}

  /** Busca ficha do lead (cria vazia se não existir) */
  async findOrCreate(leadId: string) {
    // Verifica se o lead existe
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException(`Lead ${leadId} não encontrado`);

    return this.prisma.fichaTrabalhista.upsert({
      where: { lead_id: leadId },
      update: {},
      create: { lead_id: leadId, data: {} },
    });
  }

  /** Busca ficha existente (retorna null se não existe) */
  async findByLeadId(leadId: string) {
    return this.prisma.fichaTrabalhista.findUnique({
      where: { lead_id: leadId },
    });
  }

  /** Atualiza campos parcialmente (merge no JSON data) */
  async updatePartial(leadId: string, fields: UpdateFichaDto, filledBy?: string) {
    const existing = await this.findOrCreate(leadId);
    const oldData = (existing.data as Record<string, any>) || {};

    // Filtrar apenas campos com valor (não undefined)
    const cleanFields: Record<string, any> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        cleanFields[key] = value;
      }
    }

    const merged = { ...oldData, ...cleanFields };

    // Calcular percentual de preenchimento
    const filled = Object.values(merged).filter(
      (v) => v !== null && v !== undefined && v !== '',
    ).length;
    const pct = Math.min(100, Math.round((filled / TOTAL_FIELDS) * 100));

    const updated = await this.prisma.fichaTrabalhista.update({
      where: { lead_id: leadId },
      data: {
        data: merged,
        nome_completo: cleanFields.nome_completo ?? existing.nome_completo,
        nome_empregador: cleanFields.nome_empregador ?? existing.nome_empregador,
        completion_pct: pct,
        ...(filledBy ? { filled_by: filledBy } : {}),
      },
    });

    // Emitir atualização em tempo real
    this.gateway.server?.emit('fichaUpdated', {
      leadId,
      completion_pct: pct,
      finalizado: updated.finalizado,
    });

    // Sincronizar dados da ficha → AiMemory (não bloqueia o retorno)
    this.syncToMemory(leadId, merged).catch((err) =>
      this.logger.warn(`[Ficha] Falha ao sincronizar memória: ${err.message}`),
    );

    // Se ficha já finalizada e edição veio do lead, notificar via WhatsApp (debounce 1 por ficha)
    if (existing.finalizado && filledBy === 'lead') {
      this.notifyFichaEdited(leadId).catch((err) =>
        this.logger.warn(`[Ficha] Falha ao notificar edição: ${err.message}`),
      );
    }

    return updated;
  }

  /** Sincroniza campos da ficha → AiMemory (facts_json) */
  private async syncToMemory(leadId: string, fichaData: Record<string, any>) {
    // Mapear ficha → facts_json (inverso do fillFromMemory)
    const hasValue = (v: any) => v !== null && v !== undefined && v !== '';

    const leadFacts: Record<string, any> = {};
    if (hasValue(fichaData.nome_completo)) leadFacts.full_name = fichaData.nome_completo;
    if (hasValue(fichaData.cpf)) leadFacts.cpf = fichaData.cpf;
    if (hasValue(fichaData.nome_mae)) leadFacts.mother_name = fichaData.nome_mae;
    if (hasValue(fichaData.cidade)) leadFacts.city = fichaData.cidade;
    if (hasValue(fichaData.estado_uf)) leadFacts.state = fichaData.estado_uf;
    if (hasValue(fichaData.telefone)) leadFacts.phones = [fichaData.telefone];
    if (hasValue(fichaData.email)) leadFacts.emails = [fichaData.email];

    const partiesFacts: Record<string, any> = {};
    if (hasValue(fichaData.nome_empregador)) partiesFacts.counterparty_name = fichaData.nome_empregador;
    if (hasValue(fichaData.cnpjcpf_empregador)) partiesFacts.counterparty_id = fichaData.cnpjcpf_empregador;

    const currentFacts: Record<string, any> = {};
    if (hasValue(fichaData.situacao_atual)) currentFacts.employment_status = fichaData.situacao_atual;
    if (hasValue(fichaData.motivos_reclamacao)) currentFacts.main_issue = fichaData.motivos_reclamacao;

    const keyValues: Record<string, any> = {};
    if (hasValue(fichaData.salario)) keyValues.salario = fichaData.salario;
    if (hasValue(fichaData.funcao)) keyValues.funcao = fichaData.funcao;
    if (hasValue(fichaData.cidade_trabalho)) keyValues.cidade_trabalho = fichaData.cidade_trabalho;

    const keyDates: Record<string, any> = {};
    if (hasValue(fichaData.data_admissao)) keyDates.admissao = fichaData.data_admissao;
    if (hasValue(fichaData.data_saida)) keyDates.demissao = fichaData.data_saida;

    // Só sincronizar se houver dados relevantes para a memória
    if (
      Object.keys(leadFacts).length === 0 &&
      Object.keys(partiesFacts).length === 0 &&
      Object.keys(currentFacts).length === 0 &&
      Object.keys(keyValues).length === 0 &&
      Object.keys(keyDates).length === 0
    ) {
      return;
    }

    // Buscar memória existente e fazer merge profundo
    const existing = await this.prisma.aiMemory.findUnique({
      where: { lead_id: leadId },
    });

    let facts: any = {};
    try {
      facts = existing?.facts_json
        ? typeof existing.facts_json === 'string'
          ? JSON.parse(existing.facts_json as string)
          : existing.facts_json
        : {};
    } catch {
      facts = {};
    }

    // Merge profundo preservando campos que a ficha não cobre
    facts.lead = { ...(facts.lead || {}), ...leadFacts };
    facts.parties = { ...(facts.parties || {}), ...partiesFacts };
    if (!facts.facts) facts.facts = {};
    facts.facts.current = { ...(facts.facts.current || {}), ...currentFacts };
    facts.facts.current.key_values = { ...(facts.facts.current.key_values || {}), ...keyValues };
    facts.facts.current.key_dates = { ...(facts.facts.current.key_dates || {}), ...keyDates };

    // Upsert na AiMemory
    if (existing) {
      await this.prisma.aiMemory.update({
        where: { lead_id: leadId },
        data: {
          facts_json: facts,
          last_updated_at: new Date(),
          version: { increment: 1 },
        },
      });
    } else {
      await this.prisma.aiMemory.create({
        data: {
          lead_id: leadId,
          summary: `Ficha trabalhista preenchida: ${fichaData.nome_completo || 'lead'}`,
          facts_json: facts,
        },
      });
    }

    this.logger.log(`[Ficha] Memória sincronizada para lead ${leadId}`);
  }

  /** Marca como finalizado + envia msg WhatsApp + avança stage CRM */
  async finalize(leadId: string) {
    const existing = await this.findByLeadId(leadId);
    if (!existing) throw new NotFoundException('Ficha não encontrada');

    // Validar campos obrigatórios
    const data = (existing.data as Record<string, any>) || {};
    const missing = REQUIRED_FIELDS.filter(
      (f) => !data[f.key] || String(data[f.key]).trim() === '',
    );
    if (missing.length > 0) {
      const names = missing.slice(0, 5).map((f) => f.label).join(', ');
      const extra = missing.length > 5 ? ` e mais ${missing.length - 5}` : '';
      throw new BadRequestException(
        `Preencha os campos obrigatórios antes de finalizar: ${names}${extra}`,
      );
    }

    // 1. Marca finalizado
    const ficha = await this.prisma.fichaTrabalhista.update({
      where: { lead_id: leadId },
      data: { finalizado: true },
    });

    // 2. Busca lead com conversa aberta
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        conversations: {
          where: { status: 'ABERTO' },
          orderBy: { last_message_at: 'desc' },
          take: 1,
        },
      },
    });

    if (!lead) throw new NotFoundException('Lead não encontrado');

    // 3. Avança stage baseado em quem preencheu
    const nextStage =
      ficha.filled_by === 'ai' ? 'AGUARDANDO_DOCS' : 'REUNIAO_AGENDADA';
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { stage: nextStage },
    });
    this.logger.log(
      `[Ficha] Lead ${leadId} avançou para stage: ${nextStage} (filled_by: ${ficha.filled_by})`,
    );

    // 4. Envia mensagem WhatsApp
    const conv = lead.conversations?.[0];
    if (conv) {
      try {
        await this.whatsapp.sendText(
          lead.phone,
          'Sua ficha trabalhista foi recebida com sucesso! Nosso advogado vai analisar as informações e entrará em contato em breve.',
          (conv as any).instance_name || undefined,
        );
        this.logger.log(`[Ficha] Mensagem de confirmação enviada para ${lead.phone}`);
      } catch (e: any) {
        this.logger.warn(`[Ficha] Falha ao enviar msg WhatsApp: ${e.message}`);
      }
    }

    // 5. Emitir evento WebSocket
    this.gateway.server?.emit('fichaUpdated', {
      leadId,
      completion_pct: ficha.completion_pct,
      finalizado: true,
      stage: nextStage,
    });

    // 6. Emitir inboxUpdate para atualizar o CRM/Kanban
    this.gateway.emitConversationsUpdate(null);

    // 7. Registrar na AiMemory que a ficha foi finalizada
    this.syncFichaStatusToMemory(leadId, 'finalizada').catch((err) =>
      this.logger.warn(`[Ficha] Falha ao registrar finalização na memória: ${err.message}`),
    );

    return ficha;
  }

  /** Preenche ficha com dados da AiMemory (mapeamento facts_json → campos) */
  async fillFromMemory(leadId: string) {
    const memory = await this.prisma.aiMemory.findUnique({
      where: { lead_id: leadId },
    });
    if (!memory?.facts_json) return null;

    const facts = memory.facts_json as any;
    const mappedData: UpdateFichaDto = {};

    // Mapear lead data
    if (facts.lead?.full_name) mappedData.nome_completo = facts.lead.full_name;
    if (facts.lead?.cpf) mappedData.cpf = facts.lead.cpf;
    if (facts.lead?.city) mappedData.cidade = facts.lead.city;
    if (facts.lead?.state) mappedData.estado_uf = facts.lead.state;
    if (facts.lead?.phones?.[0]) mappedData.telefone = facts.lead.phones[0];
    if (facts.lead?.emails?.[0]) mappedData.email = facts.lead.emails[0];
    if (facts.lead?.mother_name) mappedData.nome_mae = facts.lead.mother_name;

    // Mapear parties (empregador)
    if (facts.parties?.counterparty_name)
      mappedData.nome_empregador = facts.parties.counterparty_name;
    if (facts.parties?.counterparty_id)
      mappedData.cnpjcpf_empregador = facts.parties.counterparty_id;

    // Mapear facts.current
    if (facts.facts?.current?.employment_status)
      mappedData.situacao_atual = facts.facts.current.employment_status;
    if (facts.facts?.current?.main_issue)
      mappedData.motivos_reclamacao = facts.facts.current.main_issue;

    // Mapear key_values (salário, etc.)
    const kv = facts.facts?.current?.key_values || {};
    if (kv.salario) mappedData.salario = String(kv.salario);

    // Mapear key_dates
    const kd = facts.facts?.current?.key_dates || {};
    if (kd.admissao) mappedData.data_admissao = kd.admissao;
    if (kd.demissao || kd.saida)
      mappedData.data_saida = kd.demissao || kd.saida;

    if (Object.keys(mappedData).length > 0) {
      this.logger.log(
        `[Ficha] Preenchendo ${Object.keys(mappedData).length} campos da memória para lead ${leadId}`,
      );
      return this.updatePartial(leadId, mappedData, 'ai');
    }
    return null;
  }

  /** Registra na AiMemory o status da ficha (finalizada/editada) */
  private async syncFichaStatusToMemory(leadId: string, status: string) {
    const existing = await this.prisma.aiMemory.findUnique({
      where: { lead_id: leadId },
    });

    let facts: any = {};
    try {
      facts = existing?.facts_json
        ? typeof existing.facts_json === 'string'
          ? JSON.parse(existing.facts_json as string)
          : existing.facts_json
        : {};
    } catch {
      facts = {};
    }

    // Registrar status da ficha
    facts.ficha_trabalhista = {
      ...(facts.ficha_trabalhista || {}),
      status,
      updated_at: new Date().toISOString(),
    };

    const today = new Date().toISOString().slice(0, 10);
    const summaryLine = `[FICHA ${today}] Ficha trabalhista ${status}`;
    const newSummary = (
      summaryLine + (existing?.summary ? '\n' + existing.summary : '')
    ).slice(0, 2000);

    if (existing) {
      await this.prisma.aiMemory.update({
        where: { lead_id: leadId },
        data: {
          facts_json: facts,
          summary: newSummary,
          last_updated_at: new Date(),
          version: { increment: 1 },
        },
      });
    } else {
      await this.prisma.aiMemory.create({
        data: { lead_id: leadId, summary: newSummary, facts_json: facts },
      });
    }

    this.logger.log(`[Ficha] Status "${status}" registrado na memória do lead ${leadId}`);
  }

  /** Envia WhatsApp informando que a edição foi recebida (debounce por lead) */
  private editNotifyTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private async notifyFichaEdited(leadId: string) {
    // Debounce de 30s — evita spam se o lead editar vários campos seguidos
    if (this.editNotifyTimers.has(leadId)) {
      clearTimeout(this.editNotifyTimers.get(leadId)!);
    }

    this.editNotifyTimers.set(
      leadId,
      setTimeout(async () => {
        this.editNotifyTimers.delete(leadId);
        try {
          const lead = await this.prisma.lead.findUnique({
            where: { id: leadId },
            include: {
              conversations: {
                where: { status: 'ABERTO' },
                orderBy: { last_message_at: 'desc' },
                take: 1,
              },
            },
          });
          if (!lead) return;

          const conv = lead.conversations?.[0];
          if (conv) {
            await this.whatsapp.sendText(
              lead.phone,
              'Recebemos a atualização da sua ficha trabalhista. Nosso advogado será informado das alterações.',
              (conv as any).instance_name || undefined,
            );
            this.logger.log(`[Ficha] Notificação de edição enviada para ${lead.phone}`);
          }

          // Registrar na memória
          this.syncFichaStatusToMemory(leadId, 'editada após finalização').catch(() => {});
        } catch (e: any) {
          this.logger.warn(`[Ficha] Falha ao notificar edição: ${e.message}`);
        }
      }, 30_000),
    );
  }

  /** Corrige texto ditado por voz usando IA (pontuação, gramática, coerência) */
  async correctField(field: string, text: string): Promise<{ corrected: string }> {
    const apiKey = await this.settings.get('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('[Ficha] OPENAI_API_KEY não configurada — correção ignorada');
      return { corrected: text };
    }

    const FIELD_LABELS: Record<string, string> = {
      motivo_saida: 'Motivo da Saída do emprego',
      atividades_realizadas: 'Atividades Realizadas no trabalho',
      detalhes_acidente: 'Detalhes do Acidente de trabalho',
      detalhes_assedio_moral: 'Detalhes do Assédio Moral sofrido',
      detalhes_verbas_pendentes: 'Detalhes de Verbas Rescisórias pendentes',
      detalhes_testemunhas: 'Nomes e Contatos das Testemunhas',
      detalhes_provas_documentais: 'Descrição das Provas Documentais',
      motivos_reclamacao: 'Motivos da Reclamação Trabalhista',
    };

    const label = FIELD_LABELS[field] || field;

    try {
      const openai = new OpenAI({ apiKey });
      const result = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        temperature: 0.3,
        max_tokens: 1000,
        messages: [
          {
            role: 'system',
            content: `Você é um revisor de texto jurídico trabalhista. O texto abaixo foi DITADO POR VOZ por um cliente preenchendo uma ficha trabalhista.

Sua tarefa:
1. Corrigir pontuação e gramática
2. Organizar o texto de forma clara e coerente
3. Manter TODAS as informações originais — NÃO remova nem invente dados
4. Manter linguagem simples (é um cliente, não um advogado)
5. Se houver repetições por erro de ditado, remova as duplicatas
6. NÃO adicione informações que não existem no original

Campo: "${label}"

Responda APENAS com o texto corrigido, sem explicações.`,
          },
          { role: 'user', content: text },
        ],
      });

      const corrected = result.choices[0]?.message?.content?.trim() || text;
      this.logger.log(`[Ficha] Campo "${field}" corrigido por IA (${text.length}→${corrected.length} chars)`);
      return { corrected };
    } catch (e: any) {
      this.logger.warn(`[Ficha] Falha na correção IA: ${e.message}`);
      return { corrected: text };
    }
  }
}
