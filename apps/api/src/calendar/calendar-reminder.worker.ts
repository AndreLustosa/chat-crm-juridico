import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { SettingsService } from '../settings/settings.service';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// ─── Formatação de datas em pt-BR ────────────────────────────────────────────

// App usa UTC "naive" — horários salvos no banco como UTC = horário local de Maceió.
// Por isso exibimos em UTC puro (sem conversão de fuso) para não subtrair 3h.
function formatDateTime(date: Date): string {
  return date.toLocaleString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutos`;
  if (minutes === 60) return '1 hora';
  if (minutes < 1440) return `${Math.round(minutes / 60)} horas`;
  if (minutes === 1440) return '1 dia';
  return `${Math.round(minutes / 1440)} dias`;
}

// ─── Templates fallback (quando IA indisponível) ──────────────────────────────

function templateCliente(event: any, minutesBefore: number): string {
  const prazo = minutesLabel(minutesBefore);
  const dateStr = formatDateTime(event.start_at);
  const nome = (event.lead?.name || 'Cliente').split(' ')[0];
  return (
    `⚖️ *Lembrete de Audiência*\n\n` +
    `Olá, ${nome}!\n\n` +
    `Sua audiência está marcada para *${prazo}*:\n\n` +
    `📅 *Data/Hora:* ${dateStr}\n` +
    (event.location ? `📍 *Local:* ${event.location}\n` : '') +
    `\nPor favor, chegue com *30 minutos de antecedência*.\n` +
    `Em caso de dúvidas, entre em contato com o escritório.\n\n` +
    `_Aviso automático do escritório_`
  );
}

function templateAdvogado(event: any, minutesBefore: number): string {
  const prazo = minutesLabel(minutesBefore);
  const dateStr = formatDateTime(event.start_at);
  const tipo = event.type;
  const caseNum = event.legal_case?.case_number || event.title;
  const advNome = (event.assigned_user?.name || 'Advogado').split(' ').slice(0, 2).join(' ');

  if (tipo === 'AUDIENCIA') {
    return (
      `⚖️ *Lembrete de Audiência — ${prazo} antes*\n\n` +
      `Olá, ${advNome}!\n\n` +
      `📋 *Processo:* ${caseNum}\n` +
      `📅 *Data/Hora:* ${dateStr}\n` +
      (event.location ? `📍 *Local:* ${event.location}\n` : '') +
      (event.lead?.name ? `👤 *Cliente:* ${event.lead.name}\n` : '') +
      `\n_Lembrete automático do CRM Jurídico_`
    );
  }
  if (tipo === 'PRAZO') {
    return (
      `⏰ *Lembrete de Prazo — ${prazo} restantes*\n\n` +
      `Olá, ${advNome}!\n\n` +
      `📋 *Prazo:* ${event.title}\n` +
      `📅 *Vencimento:* ${dateStr}\n` +
      (caseNum ? `🔢 *Processo:* ${caseNum}\n` : '') +
      `\n_Lembrete automático do CRM Jurídico_`
    );
  }
  return (
    `📅 *Lembrete — ${prazo} antes*\n\nOlá, ${advNome}!\n\n*${event.title}*\n📅 ${dateStr}\n\n_Lembrete automático do CRM Jurídico_`
  );
}

// ─── Montagem do contexto para a IA ──────────────────────────────────────────

function buildContext(event: any, memory: any, legalCase: any, ficha: any, djenPubs?: any[]): string {
  const lines: string[] = [];

  // Evento
  lines.push(`## EVENTO`);
  lines.push(`Tipo: ${event.type}`);
  lines.push(`Título: ${event.title}`);
  lines.push(`Data/Hora: ${formatDateTime(event.start_at)}`);
  if (event.location) lines.push(`Local: ${event.location}`);
  if (event.description) lines.push(`Descrição: ${event.description}`);

  // Cliente
  if (event.lead) {
    lines.push(`\n## CLIENTE`);
    lines.push(`Nome: ${event.lead.name || 'Não informado'}`);
  }

  // Advogado
  if (event.assigned_user) {
    lines.push(`\n## ADVOGADO RESPONSÁVEL`);
    lines.push(`Nome: ${event.assigned_user.name}`);
  }

  // Processo
  if (legalCase) {
    lines.push(`\n## PROCESSO`);
    if (legalCase.case_number) lines.push(`Número: ${legalCase.case_number}`);
    if (legalCase.legal_area) lines.push(`Área: ${legalCase.legal_area}`);
    if (legalCase.action_type) lines.push(`Tipo de ação: ${legalCase.action_type}`);
    if (legalCase.opposing_party) lines.push(`Parte contrária: ${legalCase.opposing_party}`);
    if (legalCase.court) lines.push(`Tribunal/Vara: ${legalCase.court}`);
    if (legalCase.judge) lines.push(`Juiz/Desembargador: ${legalCase.judge}`);
    if (legalCase.claim_value) lines.push(`Valor da causa: R$ ${Number(legalCase.claim_value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    if (legalCase.notes) lines.push(`Notas do advogado: ${legalCase.notes}`);
  }

  // Memória do cliente (AiMemory)
  if (memory) {
    lines.push(`\n## MEMÓRIA DO CASO (histórico do atendimento)`);
    if (memory.summary) lines.push(`Resumo: ${memory.summary}`);

    let facts: any = {};
    try { facts = typeof memory.facts_json === 'string' ? JSON.parse(memory.facts_json) : (memory.facts_json || {}); } catch { facts = {}; }

    if (facts.case?.area) lines.push(`Área detectada: ${facts.case.area}`);
    if (facts.case?.subarea) lines.push(`Subárea: ${facts.case.subarea}`);
    if (facts.parties?.counterparty_name) lines.push(`Empresa/parte adversa: ${facts.parties.counterparty_name}`);
    if (facts.facts?.current?.main_issue) lines.push(`Problema principal: ${facts.facts.current.main_issue}`);
    if (facts.facts?.current?.employment_status) lines.push(`Situação trabalhista: ${facts.facts.current.employment_status}`);

    const keyDates = facts.facts?.current?.key_dates || {};
    const dateEntries = Object.entries(keyDates).filter(([, v]) => v);
    if (dateEntries.length > 0) {
      lines.push(`Datas importantes: ${dateEntries.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }

    const keyVals = facts.facts?.current?.key_values || {};
    const valEntries = Object.entries(keyVals).filter(([, v]) => v);
    if (valEntries.length > 0) {
      lines.push(`Valores relevantes: ${valEntries.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }

    const coreFacts: string[] = facts.facts?.core_facts || [];
    if (coreFacts.length > 0) {
      lines.push(`Fatos-chave: ${coreFacts.slice(0, 10).join(' | ')}`);
    }

    const openQuestions: string[] = facts.open_questions || [];
    if (openQuestions.length > 0) {
      lines.push(`Dúvidas abertas do cliente: ${openQuestions.slice(0, 5).join(' | ')}`);
    }
  }

  // Ficha trabalhista (resumo)
  if (ficha && ficha.data) {
    let fichaData: any = {};
    try { fichaData = typeof ficha.data === 'string' ? JSON.parse(ficha.data) : (ficha.data || {}); } catch { fichaData = {}; }
    const fichaLines: string[] = [];
    if (fichaData.data_admissao) fichaLines.push(`Admissão: ${fichaData.data_admissao}`);
    if (fichaData.data_demissao) fichaLines.push(`Demissão: ${fichaData.data_demissao}`);
    if (fichaData.tipo_rescisao) fichaLines.push(`Tipo de rescisão: ${fichaData.tipo_rescisao}`);
    if (fichaData.ultimo_salario) fichaLines.push(`Último salário: ${fichaData.ultimo_salario}`);
    if (fichaLines.length > 0) {
      lines.push(`\n## FICHA TRABALHISTA`);
      fichaLines.forEach(l => lines.push(l));
    }
  }

  // Publicações DJEN (histórico das movimentações do processo)
  if (djenPubs && djenPubs.length > 0) {
    lines.push(`\n## HISTÓRICO DJEN (${djenPubs.length} publicação(ões) recente(s))`);
    djenPubs.forEach((pub, idx) => {
      const date = new Date(pub.data_disponibilizacao).toLocaleDateString('pt-BR');
      lines.push(`\nPublicação ${idx + 1} — ${date}:`);
      if (pub.tipo_comunicacao) lines.push(`  Tipo: ${pub.tipo_comunicacao}`);
      if (pub.assunto) lines.push(`  Assunto: ${pub.assunto}`);
      const snippet = (pub.conteudo || '').slice(0, 400);
      if (snippet) lines.push(`  Conteúdo: ${snippet}${pub.conteudo?.length > 400 ? '…' : ''}`);
    });
  }

  return lines.join('\n');
}

// ─── Worker ───────────────────────────────────────────────────────────────────

@Processor('calendar-reminders')
export class CalendarReminderWorker extends WorkerHost {
  private readonly logger = new Logger(CalendarReminderWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsappService,
    private readonly settings: SettingsService,
  ) {
    super();
  }

  async process(job: Job<any>) {
    // ── Notificação imediata de audiência agendada ────────────────────────────
    if (job.name === 'notify-hearing-scheduled') {
      return this.processHearingScheduled(job.data.eventId, false);
    }

    // ── Notificação de remarcação de audiência ────────────────────────────────
    if (job.name === 'notify-hearing-rescheduled') {
      return this.processHearingScheduled(job.data.eventId, true);
    }

    // ── Lembretes antes do evento (fluxo original) ────────────────────────────
    const { reminderId, eventId, channel } = job.data;

    if (channel !== 'WHATSAPP' && channel !== 'EMAIL') {
      this.logger.warn(`Worker: canal desconhecido "${channel}" para reminder ${reminderId}`);
      return;
    }

    const reminder = await this.prisma.eventReminder.findUnique({
      where: { id: reminderId },
      select: { id: true, sent_at: true, minutes_before: true },
    });

    if (!reminder) {
      this.logger.warn(`Reminder ${reminderId} não encontrado — pode ter sido deletado`);
      return;
    }
    if (reminder.sent_at) {
      this.logger.log(`Reminder ${reminderId} já enviado em ${reminder.sent_at.toISOString()} — ignorando`);
      return;
    }

    // Carrega evento com todos os dados necessários para personalização
    const event = await this.prisma.calendarEvent.findUnique({
      where: { id: eventId },
      include: {
        assigned_user: { select: { id: true, name: true, phone: true } },
        lead: { select: { id: true, name: true, phone: true } },
        legal_case: {
          select: {
            id: true,
            case_number: true,
            legal_area: true,
            action_type: true,
            opposing_party: true,
            court: true,
            judge: true,
            claim_value: true,
            notes: true,
          },
        },
      },
    });

    if (!event) {
      this.logger.warn(`Evento ${eventId} não encontrado`);
      return;
    }

    if (['CANCELADO', 'CONCLUIDO'].includes(event.status)) {
      this.logger.log(`Evento ${eventId} está ${event.status} — lembrete ignorado`);
      await this.prisma.eventReminder.update({ where: { id: reminderId }, data: { sent_at: new Date() } });
      return;
    }

    if (channel === 'WHATSAPP') {
      await this.sendWhatsAppReminders(event, reminder.minutes_before);
    }

    await this.prisma.eventReminder.update({
      where: { id: reminderId },
      data: { sent_at: new Date() },
    });

    this.logger.log(`[REMINDER] ${channel} enviado para evento "${event.title}" (${eventId})`);
  }

  // ─── Orquestra os envios ──────────────────────────────────────────────────

  private async sendWhatsAppReminders(event: any, minutesBefore: number) {
    const isAudiencia = event.type === 'AUDIENCIA';

    // Carrega contexto adicional do cliente (memória + ficha + publicações DJEN)
    const leadId = event.lead?.id;
    const legalCaseId = event.legal_case?.id;
    const [memory, ficha, djenPubs] = await Promise.all([
      leadId
        ? this.prisma.aiMemory.findUnique({ where: { lead_id: leadId } }).catch(() => null)
        : null,
      leadId && (event.legal_case?.legal_area?.toUpperCase().includes('TRABALHIST'))
        ? this.prisma.fichaTrabalhista.findUnique({ where: { lead_id: leadId } }).catch(() => null)
        : null,
      legalCaseId
        ? (this.prisma as any).djenPublication.findMany({
            where: { legal_case_id: legalCaseId },
            orderBy: { data_disponibilizacao: 'desc' },
            take: 5,
            select: { tipo_comunicacao: true, assunto: true, conteudo: true, data_disponibilizacao: true },
          }).catch(() => [])
        : Promise.resolve([]),
    ]);

    const context = buildContext(event, memory, event.legal_case, ficha, djenPubs);

    // ── 1. Mensagem para o Advogado (sempre) ─────────────────────────
    if (event.assigned_user?.phone) {
      const advPhone = event.assigned_user.phone.replace(/\D/g, '');
      // Advogado recebe template rico — sem precisar de IA (já conhece o caso)
      const advMsg = templateAdvogado(event, minutesBefore);
      try {
        await this.whatsapp.sendText(advPhone, advMsg);
        this.logger.log(`[REMINDER] WhatsApp enviado para advogado ${advPhone}`);
      } catch (e: any) {
        this.logger.warn(`[REMINDER] Erro ao enviar para advogado ${advPhone}: ${e.message}`);
      }
    }

    // ── 2. Mensagem para o Cliente via IA (apenas audiências) ─────────
    if (isAudiencia && event.lead?.phone) {
      const clientPhone = event.lead.phone.replace(/\D/g, '');
      let clientMsg: string;

      try {
        clientMsg = await this.generateClientMessage(event, minutesBefore, context);
        this.logger.log(`[REMINDER] Mensagem IA gerada para cliente ${clientPhone}`);
      } catch (e: any) {
        this.logger.warn(`[REMINDER] IA indisponível, usando template: ${e.message}`);
        clientMsg = templateCliente(event, minutesBefore);
      }

      // Busca a conversa ativa antes de enviar
      const lastConvo = await this.prisma.conversation.findFirst({
        where: { lead_id: event.lead.id, status: { not: 'ENCERRADO' } },
        orderBy: { last_message_at: 'desc' },
        select: { id: true, instance_name: true },
      }).catch(() => null);

      let reminderSendResult: any;
      try {
        reminderSendResult = await this.whatsapp.sendText(
          clientPhone,
          clientMsg,
          lastConvo?.instance_name ?? undefined,
        );
        this.logger.log(`[REMINDER] WhatsApp enviado para cliente ${clientPhone}`);
      } catch (e: any) {
        this.logger.warn(`[REMINDER] Erro ao enviar para cliente ${clientPhone}: ${e.message}`);
      }

      // ── Salva mensagem e contexto na conversa (visível para operador) ──
      if (lastConvo && reminderSendResult !== undefined) {
        try {
          const evolutionMsgId = reminderSendResult?.data?.key?.id || `sys_reminder_${Date.now()}`;
          await this.prisma.message.create({
            data: {
              conversation_id: lastConvo.id,
              direction: 'out',
              type: 'text',
              text: clientMsg,
              external_message_id: evolutionMsgId,
              status: 'enviado',
            },
          });
          await this.prisma.conversation.update({
            where: { id: lastConvo.id },
            data: {
              last_message_at: new Date(),
              ai_mode: true, // reativa IA para responder dúvidas do cliente
              reminder_context: {
                type: event.type,
                event_title: event.title,
                event_date: formatDateTime(event.start_at),
                event_date_iso: event.start_at.toISOString(),
                location: event.location || null,
                message_sent: clientMsg.slice(0, 800),
                minutes_before: minutesBefore,
                sent_at: new Date().toISOString(),
              },
            },
          });
          this.logger.log(`[REMINDER] Mensagem salva e IA reativada na conversa ${lastConvo.id}`);
        } catch (e: any) {
          this.logger.warn(`[REMINDER] Falha ao salvar mensagem na conversa: ${e.message}`);
        }
      }
    }
  }

  // ─── Notificação imediata de audiência agendada ───────────────────────────

  private async processHearingScheduled(eventId: string, isRescheduled = false) {
    const event = await this.prisma.calendarEvent.findUnique({
      where: { id: eventId },
      include: {
        assigned_user: { select: { id: true, name: true, phone: true } },
        lead: { select: { id: true, name: true, phone: true } },
        legal_case: {
          select: {
            id: true, case_number: true, legal_area: true, action_type: true,
            opposing_party: true, court: true, judge: true, claim_value: true, notes: true,
          },
        },
      },
    });

    if (!event) {
      this.logger.warn(`[HEARING-NOTIFY] Evento ${eventId} não encontrado — cancelado`);
      return;
    }
    if (['CANCELADO', 'CONCLUIDO'].includes(event.status)) {
      this.logger.log(`[HEARING-NOTIFY] Evento ${eventId} já está ${event.status} — ignorado`);
      return;
    }
    if (!event.lead?.phone) {
      this.logger.log(`[HEARING-NOTIFY] Evento ${eventId} sem telefone do cliente — ignorado`);
      return;
    }

    const leadId = event.lead.id;
    const legalCaseId = event.legal_case?.id;
    const [memory, ficha, djenPubs] = await Promise.all([
      this.prisma.aiMemory.findUnique({ where: { lead_id: leadId } }).catch(() => null),
      event.legal_case?.legal_area?.toUpperCase().includes('TRABALHIST')
        ? this.prisma.fichaTrabalhista.findUnique({ where: { lead_id: leadId } }).catch(() => null)
        : null,
      legalCaseId
        ? (this.prisma as any).djenPublication.findMany({
            where: { legal_case_id: legalCaseId },
            orderBy: { data_disponibilizacao: 'desc' },
            take: 5,
            select: { tipo_comunicacao: true, assunto: true, conteudo: true, data_disponibilizacao: true },
          }).catch(() => [])
        : Promise.resolve([]),
    ]);

    const context = buildContext(event, memory, event.legal_case, ficha, djenPubs);
    const clientPhone = event.lead.phone.replace(/\D/g, '');
    const firstName = (event.lead.name || 'Cliente').split(' ')[0];

    let msg: string;
    try {
      msg = await this.generateHearingScheduledMessage(event, context, firstName, isRescheduled);
      this.logger.log(`[HEARING-NOTIFY] Mensagem IA gerada para ${clientPhone} (remarcação=${isRescheduled})`);
    } catch (e: any) {
      this.logger.warn(`[HEARING-NOTIFY] IA indisponível, usando template: ${e.message}`);
      msg = isRescheduled
        ? this.templateHearingRescheduled(event, firstName)
        : this.templateHearingScheduled(event, firstName);
    }

    // Busca a conversa ativa antes de enviar (precisamos do ID para salvar a mensagem)
    const lastConvo = await this.prisma.conversation.findFirst({
      where: { lead_id: leadId, status: { not: 'ENCERRADO' } },
      orderBy: { last_message_at: 'desc' },
      select: { id: true, ai_mode: true, instance_name: true },
    });

    let sendResult: any;
    try {
      sendResult = await this.whatsapp.sendText(
        clientPhone,
        msg,
        lastConvo?.instance_name ?? undefined,
      );
      this.logger.log(`[HEARING-NOTIFY] WhatsApp enviado para ${clientPhone} sobre audiência ${eventId}`);
    } catch (e: any) {
      this.logger.warn(`[HEARING-NOTIFY] Erro ao enviar para ${clientPhone}: ${e.message}`);
      return;
    }

    // Salva mensagem na conversa (visível para o operador no chat)
    // e atualiza reminder_context para a IA/operador saberem o contexto
    if (lastConvo) {
      try {
        const evolutionMsgId = sendResult?.data?.key?.id || `sys_hearing_${Date.now()}`;
        await this.prisma.message.create({
          data: {
            conversation_id: lastConvo.id,
            direction: 'out',
            type: 'text',
            text: msg,
            external_message_id: evolutionMsgId,
            status: 'enviado',
          },
        });
        await this.prisma.conversation.update({
          where: { id: lastConvo.id },
          data: {
            last_message_at: new Date(),
            ai_mode: true, // reativa IA para responder dúvidas do cliente
            reminder_context: {
              type: 'AUDIENCIA_AGENDADA',
              event_title: event.title,
              event_date: formatDateTime(event.start_at),
              event_date_iso: event.start_at.toISOString(),
              location: event.location || null,
              message_sent: msg.slice(0, 800),
              sent_at: new Date().toISOString(),
            },
          },
        });
        this.logger.log(`[HEARING-NOTIFY] Mensagem salva e IA reativada na conversa ${lastConvo.id}`);
      } catch (e: any) {
        this.logger.warn(`[HEARING-NOTIFY] Falha ao salvar mensagem na conversa: ${e.message}`);
      }
    }
  }

  private templateHearingRescheduled(event: any, firstName: string): string {
    const dateStr = formatDateTime(event.start_at);
    return (
      `📅 *Audiência Remarcada*\n\n` +
      `Olá, ${firstName}!\n\n` +
      `Informamos que sua audiência foi *remarcada* para uma nova data:\n\n` +
      `📅 *Nova Data/Hora:* ${dateStr}\n` +
      (event.location ? `📍 *Local:* ${event.location}\n` : '') +
      `\nPor favor, anote a nova data. Chegue com *30 minutos de antecedência*.\n` +
      `Qualquer dúvida, é só responder esta mensagem.\n\n` +
      `_André Lustosa Advogados_`
    );
  }

  private templateHearingScheduled(event: any, firstName: string): string {
    const dateStr = formatDateTime(event.start_at);
    return (
      `⚖️ *Audiência Agendada*\n\n` +
      `Olá, ${firstName}!\n\n` +
      `Gostaríamos de informar que sua audiência foi agendada:\n\n` +
      `📅 *Data/Hora:* ${dateStr}\n` +
      (event.location ? `📍 *Local:* ${event.location}\n` : '') +
      `\nRecomendamos chegar com *30 minutos de antecedência*.\n` +
      `Qualquer dúvida, estamos à disposição.\n\n` +
      `_André Lustosa Advogados_`
    );
  }

  private async generateHearingScheduledMessage(event: any, context: string, firstName: string, isRescheduled = false): Promise<string> {
    const aiConfig = await this.settings.getAiConfig();
    const model = aiConfig.defaultModel || 'gpt-4o-mini';
    const isAnthropic = model.startsWith('claude');
    const dateStr = formatDateTime(event.start_at);

    const systemPrompt = `Você é o assistente do escritório de advocacia André Lustosa Advogados.
Sua tarefa é enviar uma mensagem via WhatsApp informando ao cliente que sua audiência foi agendada.

REGRAS:
- Escreva em português brasileiro natural e acolhedor
- Seja direto e claro — o cliente precisa saber a data, horário e local
- Use formatação WhatsApp (*negrito*) com moderação
- Personalize com base no histórico/contexto do caso quando relevante
- NÃO invente informações — use apenas o contexto fornecido
- Se o caso for trabalhista, reforce brevemente a importância da audiência
- Oriente a chegar com 30 minutos de antecedência
- Deixe claro que pode tirar dúvidas respondendo esta mensagem
- Limite: máximo 200 palavras
- Finalize com "_André Lustosa Advogados_"`;

    const userPrompt = isRescheduled
      ? `Crie uma mensagem informando ao cliente que a audiência foi *remarcada* para uma nova data.
Deixe claro que é uma remarcação (não um novo agendamento).

DADOS DA NOVA AUDIÊNCIA:
Data/Hora: ${dateStr}
${event.location ? `Local: ${event.location}` : 'Local: a confirmar'}

CONTEXTO DO CASO:
${context}

Nome do cliente: "${firstName}"

Gere APENAS a mensagem final para WhatsApp, sem explicações.`
      : `Crie uma mensagem informando ao cliente que a audiência foi agendada.

DADOS DA AUDIÊNCIA:
Data/Hora: ${dateStr}
${event.location ? `Local: ${event.location}` : 'Local: a confirmar'}
${event.title ? `Título: ${event.title}` : ''}

CONTEXTO DO CASO:
${context}

Nome do cliente: "${firstName}"

Gere APENAS a mensagem final para WhatsApp, sem explicações.`;

    if (isAnthropic) {
      const anthropicKey = (await this.settings.get('ANTHROPIC_API_KEY')) || process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY não configurada');
      const client = new Anthropic({ apiKey: anthropicKey });
      const response = await client.messages.create({
        model, max_tokens: 350, temperature: 0.7,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      return ((response.content[0] as any)?.text || '').trim();
    } else {
      const openaiKey = (await this.settings.get('OPENAI_API_KEY')) || process.env.OPENAI_API_KEY;
      if (!openaiKey) throw new Error('OPENAI_API_KEY não configurada');
      const openai = new OpenAI({ apiKey: openaiKey });
      const completion = await openai.chat.completions.create({
        model, max_tokens: 350, temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
      return (completion.choices[0]?.message?.content || '').trim();
    }
  }

  // ─── Geração da mensagem via IA ───────────────────────────────────────────

  private async generateClientMessage(
    event: any,
    minutesBefore: number,
    context: string,
  ): Promise<string> {
    const aiConfig = await this.settings.getAiConfig();
    const model = aiConfig.defaultModel || 'gpt-4o-mini';
    const isAnthropic = model.startsWith('claude');
    const prazo = minutesLabel(minutesBefore);
    const firstName = (event.lead?.name || 'Cliente').split(' ')[0];

    const systemPrompt = `Você é o assistente virtual do escritório de advocacia André Lustosa Advogados.
Sua função é enviar lembretes personalizados e humanizados via WhatsApp para os clientes.

REGRAS IMPORTANTES:
- Escreva em português brasileiro natural e acolhedor, sem ser formal demais
- Seja direto e objetivo — a mensagem deve ser lida rapidamente no celular
- Use formatação WhatsApp (*negrito*, _itálico_) com moderação
- Personalize com base no histórico e contexto do caso
- NÃO invente informações — use apenas o que está no contexto fornecido
- NÃO mencione valores monetários a menos que estejam explicitamente no contexto
- Se o caso for trabalhista, mencione a importância da audiência para o direito do cliente
- Sempre indique o horário e local de forma clara
- Sempre oriente a chegar com antecedência (30 min)
- Finalize sinalizando disponibilidade para dúvidas
- Limite: máximo 250 palavras
- NÃO use assinatura longa — apenas "_André Lustosa Advogados_" no final`;

    const userPrompt = `Crie uma mensagem de lembrete personalizada para o cliente sobre a audiência que ocorre em ${prazo}.

DADOS DO CASO:
${context}

O nome do cliente é "${firstName}".
A audiência é em ${prazo}.

Gere APENAS a mensagem final formatada para WhatsApp, sem explicações adicionais.`;

    if (isAnthropic) {
      const anthropicKey = (await this.settings.get('ANTHROPIC_API_KEY')) || process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY não configurada');
      const client = new Anthropic({ apiKey: anthropicKey });
      const response = await client.messages.create({
        model,
        max_tokens: 400,
        temperature: 0.7,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      return ((response.content[0] as any)?.text || '').trim();
    } else {
      const openaiKey = (await this.settings.get('OPENAI_API_KEY')) || process.env.OPENAI_API_KEY;
      if (!openaiKey) throw new Error('OPENAI_API_KEY não configurada');
      const openai = new OpenAI({ apiKey: openaiKey });
      const completion = await openai.chat.completions.create({
        model,
        max_tokens: 400,
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
      return (completion.choices[0]?.message?.content || '').trim();
    }
  }
}
