import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { UpdateFichaDto } from './dto/update-ficha.dto';

// Total de campos úteis do formulário (para cálculo de %)
const TOTAL_FIELDS = 76;

@Injectable()
export class FichaTrabalhistaService {
  private readonly logger = new Logger(FichaTrabalhistaService.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
    private gateway: ChatGateway,
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
}
