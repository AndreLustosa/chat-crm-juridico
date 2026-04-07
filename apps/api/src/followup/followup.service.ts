import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import OpenAI from 'openai';

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface DossieCompleto {
  pessoa: {
    id: string; nome: string; telefone: string; email?: string;
    tipo: 'lead' | 'cliente'; estagio: string; canal_preferido: string;
    dias_sem_contato: number; inadimplente: boolean; origin?: string;
  };
  historico: {
    total_msgs: number; ultima_msg_resumo: string; ultima_msg_direcao: string;
    dias_sem_resposta: number; sentimento: string;
    ultimas_msgs: Array<{ direcao: string; text: string; created_at: string }>;
  };
  processual?: {
    processos: Array<{ numero: string; tipo: string; status: string; proximo_andamento?: string }>;
  };
  tarefa: {
    sequencia_nome: string; step_position: number; total_steps: number;
    tentativa_numero: number; objetivo: string; tom: string; canal: string;
    mensagens_anteriores: string[];
  };
  financeiro?: { inadimplente: boolean; valor_devido?: number };
  data_hora_atual: string; dia_semana: string;
}

@Injectable()
export class FollowupService {
  private readonly logger = new Logger(FollowupService.name);
  private _openai: OpenAI | null = null;

  private get openai(): OpenAI {
    if (!this._openai) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY não configurada. Configure a variável de ambiente para usar o Follow-up IA.');
      this._openai = new OpenAI({ apiKey });
    }
    return this._openai;
  }

  constructor(
    private prisma: PrismaService,
    @InjectQueue('followup-jobs') private followupQueue: Queue,
  ) {}

  // ─── CRUD Sequências ─────────────────────────────────────────────────────

  async listSequences(tenantId?: string) {
    return this.prisma.followupSequence.findMany({
      where: tenantId ? { OR: [{ tenant_id: tenantId }, { tenant_id: null }] } : {},
      include: { steps: { orderBy: { position: 'asc' } }, _count: { select: { enrollments: true } } },
      orderBy: { created_at: 'desc' },
    });
  }

  async createSequence(data: {
    name: string; description?: string; category?: string;
    auto_enroll_stages?: string[]; max_attempts?: number; tenant_id?: string;
    steps?: Array<{ position: number; delay_hours: number; channel: string; tone: string; objective: string; custom_prompt?: string; auto_send?: boolean }>;
  }) {
    const { steps, ...seqData } = data;
    return this.prisma.followupSequence.create({
      data: {
        ...seqData,
        steps: steps ? { create: steps } : undefined,
      },
      include: { steps: { orderBy: { position: 'asc' } } },
    });
  }

  async updateSequence(id: string, data: Partial<{
    name: string; description: string; category: string; active: boolean;
    auto_enroll_stages: string[]; max_attempts: number;
  }>) {
    return this.prisma.followupSequence.update({ where: { id }, data,
      include: { steps: { orderBy: { position: 'asc' } } },
    });
  }

  async deleteSequence(id: string) {
    // Cancelar enrollments ativos antes de deletar
    await this.prisma.followupEnrollment.updateMany({
      where: { sequence_id: id, status: { in: ['ATIVO', 'PAUSADO'] } },
      data: { status: 'CANCELADO' },
    });
    await this.prisma.followupSequence.delete({ where: { id } });
    return { ok: true };
  }

  async addStep(sequenceId: string, data: {
    position: number; delay_hours: number; channel: string; tone: string;
    objective: string; custom_prompt?: string; auto_send?: boolean;
  }) {
    return this.prisma.followupStep.create({ data: { sequence_id: sequenceId, ...data } });
  }

  async updateStep(stepId: string, data: Partial<{
    position: number; delay_hours: number; channel: string; tone: string;
    objective: string; custom_prompt: string; auto_send: boolean;
  }>) {
    return this.prisma.followupStep.update({ where: { id: stepId }, data });
  }

  async deleteStep(stepId: string) {
    await this.prisma.followupStep.delete({ where: { id: stepId } });
    return { ok: true };
  }

  // ─── Enrollments ─────────────────────────────────────────────────────────

  async listEnrollments(filters: { status?: string; sequence_id?: string; lead_id?: string } = {}) {
    return this.prisma.followupEnrollment.findMany({
      where: {
        ...(filters.status && { status: filters.status }),
        ...(filters.sequence_id && { sequence_id: filters.sequence_id }),
        ...(filters.lead_id && { lead_id: filters.lead_id }),
      },
      include: {
        lead: { select: { id: true, name: true, phone: true, stage: true } },
        sequence: { select: { id: true, name: true, category: true } },
        messages: { orderBy: { created_at: 'desc' }, take: 1 },
      },
      orderBy: { next_send_at: 'asc' },
    });
  }

  async enrollLead(leadId: string, sequenceId: string) {
    const [lead, sequence] = await Promise.all([
      this.prisma.lead.findUnique({ where: { id: leadId } }),
      this.prisma.followupSequence.findUnique({ where: { id: sequenceId }, include: { steps: { orderBy: { position: 'asc' }, take: 1 } } }),
    ]);
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (!sequence) throw new NotFoundException('Sequência não encontrada');
    if (!sequence.active) throw new BadRequestException('Sequência inativa');

    // Verificar se já existe enrollment concluído — não re-enrolar automaticamente
    const existing = await this.prisma.followupEnrollment.findUnique({
      where: { lead_id_sequence_id: { lead_id: leadId, sequence_id: sequenceId } },
    });
    if (existing && existing.status === 'CONCLUIDO') {
      throw new BadRequestException('Lead já concluiu esta sequência. Cancele antes de re-enrolar.');
    }

    const firstStep = sequence.steps[0];
    const nextSendAt = firstStep ? new Date(Date.now() + firstStep.delay_hours * 3600 * 1000) : null;

    const enrollment = await this.prisma.followupEnrollment.upsert({
      where: { lead_id_sequence_id: { lead_id: leadId, sequence_id: sequenceId } },
      create: { lead_id: leadId, sequence_id: sequenceId, next_send_at: nextSendAt, status: 'ATIVO' },
      update: { status: 'ATIVO', current_step: 1, next_send_at: nextSendAt, paused_reason: null },
    });

    if (nextSendAt && firstStep) {
      const delay = Math.max(0, nextSendAt.getTime() - Date.now());
      await this.followupQueue.add('process-step', { enrollment_id: enrollment.id }, { delay, jobId: `enroll-${enrollment.id}-step-1`, removeOnComplete: true });
    }

    return enrollment;
  }

  async pauseEnrollment(enrollmentId: string, reason?: string) {
    return this.prisma.followupEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'PAUSADO', paused_reason: reason },
    });
  }

  async resumeEnrollment(enrollmentId: string) {
    const enrollment = await this.prisma.followupEnrollment.findUnique({
      where: { id: enrollmentId },
      include: { sequence: { include: { steps: { orderBy: { position: 'asc' } } } } },
    });
    if (!enrollment) throw new NotFoundException('Enrollment não encontrado');
    if (enrollment.status !== 'PAUSADO') throw new BadRequestException('Enrollment não está pausado');

    const currentStep = enrollment.sequence.steps.find(s => s.position === enrollment.current_step);
    const nextSendAt = currentStep ? new Date(Date.now() + currentStep.delay_hours * 3600 * 1000) : new Date(Date.now() + 3600000);

    const updated = await this.prisma.followupEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'ATIVO', paused_reason: null, next_send_at: nextSendAt },
    });

    await this.followupQueue.add('process-step', { enrollment_id: enrollmentId }, {
      delay: Math.max(0, nextSendAt.getTime() - Date.now()),
      jobId: `resume-${enrollmentId}-${Date.now()}`,
      removeOnComplete: true,
    });

    return updated;
  }

  async cancelEnrollment(enrollmentId: string) {
    return this.prisma.followupEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'CANCELADO' },
    });
  }

  async markConverted(enrollmentId: string) {
    return this.prisma.followupEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'CONVERTIDO' },
    });
  }

  // ─── Fila de Aprovação ───────────────────────────────────────────────────

  async listPendingApprovals(tenantId?: string) {
    return this.prisma.followupMessage.findMany({
      where: {
        status: 'PENDENTE_APROVACAO',
        ...(tenantId && { enrollment: { lead: { tenant_id: tenantId } } }),
      },
      include: {
        enrollment: {
          include: {
            lead: { select: { id: true, name: true, phone: true, stage: true } },
            sequence: { select: { id: true, name: true } },
            messages: { orderBy: { created_at: 'desc' }, take: 5, select: { id: true, generated_text: true, sent_text: true, status: true, created_at: true, channel: true } },
          },
        },
        step: { select: { position: true, channel: true, tone: true, objective: true } },
      },
      orderBy: { created_at: 'asc' },
    });
  }

  async approveMessage(messageId: string, approvedBy: string, editedText?: string) {
    const msg = await this.prisma.followupMessage.update({
      where: { id: messageId },
      data: {
        status: 'APROVADO',
        approved_by: approvedBy,
        approved_at: new Date(),
        sent_text: editedText || undefined,
      },
    });
    // Enfileira envio imediato
    await this.followupQueue.add('send-message', { message_id: messageId }, { jobId: `send-${messageId}`, removeOnComplete: true });
    return msg;
  }

  async rejectMessage(messageId: string, approvedBy: string) {
    return this.prisma.followupMessage.update({
      where: { id: messageId },
      data: { status: 'REJEITADO', approved_by: approvedBy, approved_at: new Date() },
    });
  }

  async regenerateMessage(messageId: string) {
    const msg = await this.prisma.followupMessage.findUnique({
      where: { id: messageId },
      include: {
        enrollment: { include: { lead: true, sequence: true } },
        step: true,
      },
    });
    if (!msg) throw new NotFoundException('Mensagem não encontrada');

    const dossie = await this.buildDossie(msg.enrollment, msg.step, msg.enrollment.lead);
    const newText = await this.generateMessage(dossie, msg.step.custom_prompt);

    return this.prisma.followupMessage.update({
      where: { id: messageId },
      data: { generated_text: newText, context_json: dossie as any, status: 'PENDENTE_APROVACAO' },
    });
  }

  // ─── Context Assembler ───────────────────────────────────────────────────

  async buildDossie(enrollment: any, step: any, lead: any): Promise<DossieCompleto> {
    // Conversa ativa
    const convo = await this.prisma.conversation.findFirst({
      where: { lead_id: lead.id, status: 'ABERTO' },
      orderBy: { last_message_at: 'desc' },
    });

    // Últimas mensagens
    const ultimasMsgs = convo ? await this.prisma.message.findMany({
      where: { conversation_id: convo.id, type: { not: 'note' } },
      orderBy: { created_at: 'desc' }, take: 10,
      select: { direction: true, text: true, created_at: true },
    }) : [];

    const diasSemContato = convo?.last_message_at
      ? Math.floor((Date.now() - convo.last_message_at.getTime()) / 86400000) : 999;

    // Processos
    const casos = await this.prisma.legalCase.findMany({
      where: { lead_id: lead.id },
      select: { case_number: true, action_type: true, stage: true, legal_area: true },
      take: 5,
    });

    // Mensagens anteriores desta sequência (para não repetir)
    const msgsAnteriores = await this.prisma.followupMessage.findMany({
      where: { enrollment_id: enrollment.id, status: { in: ['ENVIADO', 'APROVADO'] } },
      select: { sent_text: true, generated_text: true },
      orderBy: { created_at: 'desc' }, take: 5,
    });

    const hoje = new Date();
    const diasSemana = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

    return {
      pessoa: {
        id: lead.id, nome: lead.name || 'Cliente', telefone: lead.phone,
        email: lead.email, tipo: casos.length > 0 ? 'cliente' : 'lead',
        estagio: lead.stage, canal_preferido: 'whatsapp',
        dias_sem_contato: diasSemContato, inadimplente: false, origin: lead.origin,
      },
      historico: {
        total_msgs: ultimasMsgs.length,
        ultima_msg_resumo: ultimasMsgs[0]?.text?.substring(0, 200) || 'Sem mensagens anteriores',
        ultima_msg_direcao: ultimasMsgs[0]?.direction || 'N/A',
        dias_sem_resposta: diasSemContato,
        sentimento: diasSemContato > 14 ? 'frio' : diasSemContato > 7 ? 'morno' : 'ativo',
        ultimas_msgs: ultimasMsgs.reverse().map(m => ({
          direcao: m.direction, text: m.text?.substring(0, 300) || '', created_at: m.created_at.toISOString(),
        })),
      },
      processual: casos.length > 0 ? {
        processos: casos.map(c => ({
          numero: c.case_number || 'Sem número', tipo: c.action_type || 'Geral',
          area: c.legal_area || 'Geral', status: c.stage || 'Em andamento',
        })),
      } : undefined,
      tarefa: {
        sequencia_nome: enrollment.sequence?.name || 'Follow-up',
        step_position: step.position, total_steps: enrollment.sequence?.steps?.length || step.position,
        tentativa_numero: enrollment.current_step,
        objetivo: step.objective, tom: step.tone, canal: step.channel,
        mensagens_anteriores: msgsAnteriores.map(m => m.sent_text || m.generated_text),
      },
      data_hora_atual: hoje.toLocaleString('pt-BR', { timeZone: 'America/Maceio' }),
      dia_semana: diasSemana[hoje.getDay()],
    };
  }

  // ─── Message Generator ───────────────────────────────────────────────────

  async generateMessage(dossie: DossieCompleto, customPrompt?: string | null): Promise<string> {
    const escritorioNome = 'Lustosa Advogados';
    const advogadoNome = 'André Lustosa';

    const systemPrompt = `Você é ${advogadoNome}, advogado do escritório ${escritorioNome}.
Está escrevendo uma mensagem de follow-up via ${dossie.tarefa.canal} para ${dossie.pessoa.nome}.

REGRAS ABSOLUTAS:
1. Nunca revele que é IA ou que a mensagem foi gerada automaticamente
2. Use o nome da pessoa naturalmente (não repita a cada frase)
3. Nunca invente fatos sobre processos — use APENAS as informações fornecidas
4. NÃO faça promessas sobre resultados de processos
5. NÃO mencione valores de honorários (a menos que seja cobrança explícita)
6. WhatsApp: máx 250 palavras, direto ao ponto, termine com pergunta aberta
7. Email: assunto na primeira linha como "ASSUNTO: ...", corpo mais elaborado
8. NUNCA copie mensagens anteriores — sempre uma abordagem diferente
9. Tom obrigatório: ${dossie.tarefa.tom}
10. Sem frases genéricas: "venho por meio desta", "nesta oportunidade", "sem mais para o momento"

CONTEXTO COMPLETO:
${JSON.stringify(dossie, null, 2)}

OBJETIVO DESTE FOLLOW-UP:
${dossie.tarefa.objetivo}

MENSAGENS ANTERIORES (NÃO REPITA):
${dossie.tarefa.mensagens_anteriores.length > 0 ? dossie.tarefa.mensagens_anteriores.join('\n---\n') : 'Nenhuma mensagem anterior nesta sequência.'}

${customPrompt ? `INSTRUÇÃO ADICIONAL:\n${customPrompt}` : ''}

Gere APENAS o texto da mensagem, sem introduções ou explicações.`;

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: systemPrompt }],
      max_tokens: 600,
      temperature: 0.85,
    });

    return completion.choices[0]?.message?.content?.trim() || 'Olá! Gostaríamos de dar continuidade ao seu atendimento. Podemos conversar?';
  }

  // ─── Risk Classifier ─────────────────────────────────────────────────────

  classifyRisk(dossie: DossieCompleto, step: any): 'baixo' | 'medio' | 'alto' {
    let score = 0;
    if (dossie.historico.sentimento === 'frio' && dossie.tarefa.tentativa_numero > 3) score += 2;
    if (dossie.financeiro?.inadimplente && dossie.tarefa.tentativa_numero >= 3) score += 2;
    if (dossie.tarefa.tom === 'firme' && dossie.tarefa.tentativa_numero >= 2) score += 2;
    if (dossie.pessoa.tipo === 'cliente' && dossie.historico.dias_sem_resposta > 30) score += 1;
    if (score >= 4) return 'alto';
    if (score >= 2) return 'medio';
    return 'baixo';
  }

  // ─── Stats ───────────────────────────────────────────────────────────────

  async getStats(tenantId?: string) {
    const tenantFilter = tenantId ? { lead: { tenant_id: tenantId } } : {};
    const msgTenantFilter = tenantId ? { enrollment: { lead: { tenant_id: tenantId } } } : {};
    const [total, ativos, pendentes, enviados, convertidos] = await Promise.all([
      this.prisma.followupEnrollment.count({ where: tenantFilter }),
      this.prisma.followupEnrollment.count({ where: { status: 'ATIVO', ...tenantFilter } }),
      this.prisma.followupMessage.count({ where: { status: 'PENDENTE_APROVACAO', ...msgTenantFilter } }),
      this.prisma.followupMessage.count({ where: { status: 'ENVIADO', ...msgTenantFilter } }),
      this.prisma.followupEnrollment.count({ where: { status: 'CONVERTIDO', ...tenantFilter } }),
    ]);
    const taxaConversao = total > 0 ? Math.round((convertidos / total) * 1000) / 10 : 0;
    return { total_enrollments: total, ativos, pendentes_aprovacao: pendentes, total_enviados: enviados, convertidos, taxa_conversao: taxaConversao };
  }

  // ─── Auto-enroll por stage ───────────────────────────────────────────────

  async autoEnrollByStage(leadId: string, stage: string) {
    const sequences = await this.prisma.followupSequence.findMany({
      where: { active: true, auto_enroll_stages: { has: stage } },
    });
    for (const seq of sequences) {
      try {
        await this.enrollLead(leadId, seq.id);
        this.logger.log(`[FOLLOWUP] Auto-enroll lead ${leadId} → sequência "${seq.name}" (stage: ${stage})`);
      } catch { /* já enrolled ou outro erro — ignorar */ }
    }
  }

  // ─── Análise de Resposta (Response Listener) — usada pelo API diretamente ─

  async analyzeResponse(text: string, dossie: any): Promise<{
    sentimento: string; intencao: string; urgencia: string;
    requer_humano: boolean; resumo: string; proxima_acao: string;
  }> {
    const prompt = `Analise esta resposta de um lead/cliente jurídico e retorne JSON.

RESPOSTA DO LEAD: "${text}"

CONTEXTO: Lead "${dossie.pessoa?.nome}" no estágio "${dossie.pessoa?.estagio}".

Retorne APENAS este JSON (sem markdown):
{
  "sentimento": "positivo|neutro|negativo",
  "intencao": "quer_contratar|pedindo_informacao|negociando|recusando|pedindo_prazo|insatisfeito|pedindo_atualizacao|confirmando|incerto",
  "urgencia": "alta|media|baixa",
  "requer_humano": true|false,
  "resumo": "Uma frase resumindo a resposta",
  "proxima_acao": "O que fazer a seguir"
}

Considere requer_humano=true se:
- Menciona trocar de advogado ou insatisfação grave
- Assunto sensível (luto, separação, prisão de familiar)
- Negociação de valores ou acordos
- Reclamação de serviço`;

    try {
      const r = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300, temperature: 0.3,
        response_format: { type: 'json_object' },
      });
      const json = JSON.parse(r.choices[0]?.message?.content || '{}');
      return {
        sentimento: json.sentimento || 'neutro',
        intencao: json.intencao || 'incerto',
        urgencia: json.urgencia || 'media',
        requer_humano: json.requer_humano || false,
        resumo: json.resumo || 'Sem resumo',
        proxima_acao: json.proxima_acao || 'Aguardar próximo passo',
      };
    } catch {
      return { sentimento: 'neutro', intencao: 'incerto', urgencia: 'media', requer_humano: false, resumo: 'Sem análise', proxima_acao: 'Revisar manualmente' };
    }
  }

  // ─── Seed de Sequências Padrão ───────────────────────────────────────────

  async seedDefaultSequences() {
    type StepDef = {
      position: number; delay_hours: number; channel: string;
      tone: string; objective: string; auto_send: boolean; custom_prompt?: string;
    };
    type SeqDef = {
      name: string; description: string; category: string;
      auto_enroll_stages: string[]; max_attempts: number; steps: StepDef[];
    };
    const sequences: SeqDef[] = [
      {
        name: 'Novo Lead — Captação',
        description: 'Sequência padrão para novos leads que ainda não contrataram',
        category: 'LEADS',
        auto_enroll_stages: ['NOVO', 'QUALIFICANDO'],
        max_attempts: 9,
        steps: [
          { position: 1, delay_hours: 0, channel: 'whatsapp', tone: 'amigavel', objective: 'Apresentar o escritório e entender a necessidade do lead', auto_send: true },
          { position: 2, delay_hours: 2, channel: 'whatsapp', tone: 'amigavel', objective: 'Complemento com informação útil sobre o tipo de caso', auto_send: true },
          { position: 3, delay_hours: 48, channel: 'whatsapp', tone: 'profissional', objective: 'Abordagem diferente, oferecer consulta gratuita', auto_send: true },
          { position: 4, delay_hours: 96, channel: 'whatsapp', tone: 'empatico', objective: 'Demonstrar empatia com a situação do lead', auto_send: false },
          { position: 5, delay_hours: 168, channel: 'email', tone: 'profissional', objective: 'Email elaborado com credenciais do escritório e casos de sucesso', auto_send: false },
          { position: 6, delay_hours: 336, channel: 'whatsapp', tone: 'amigavel', objective: 'Última tentativa direta — perguntar se ainda tem interesse', auto_send: false },
          { position: 7, delay_hours: 720, channel: 'email', tone: 'amigavel', objective: 'Nurturing: conteúdo informativo relevante para o tipo de caso', auto_send: true },
          { position: 8, delay_hours: 1440, channel: 'email', tone: 'amigavel', objective: 'Nurturing: mudança de lei ou prazo prescricional relevante', auto_send: true },
          { position: 9, delay_hours: 2160, channel: 'whatsapp', tone: 'amigavel', objective: 'Reengajamento gentil após 3 meses', auto_send: false },
        ],
      },
      {
        name: 'Pós-Consulta — Não Contratou',
        description: 'Para leads que fizeram consulta mas ainda não fecharam',
        category: 'LEADS',
        auto_enroll_stages: ['QUALIFICANDO'],
        max_attempts: 6,
        steps: [
          { position: 1, delay_hours: 24, channel: 'whatsapp', tone: 'amigavel', objective: 'Agradecer pela consulta e manter o contato aberto', auto_send: true },
          { position: 2, delay_hours: 72, channel: 'email', tone: 'profissional', objective: 'Resumo do que foi discutido e próximos passos sugeridos', auto_send: false },
          { position: 3, delay_hours: 168, channel: 'whatsapp', tone: 'amigavel', objective: 'Verificar se conseguiu pensar sobre o que foi discutido', auto_send: false },
          { position: 4, delay_hours: 336, channel: 'whatsapp', tone: 'empatico', objective: 'Verificar objeções e oferecer soluções', auto_send: false },
          { position: 5, delay_hours: 720, channel: 'email', tone: 'profissional', objective: 'Caso relevante semelhante ou mudança de cenário favorável', auto_send: false },
          { position: 6, delay_hours: 1440, channel: 'whatsapp', tone: 'amigavel', objective: 'Reengajamento após 2 meses', auto_send: false },
        ],
      },
      {
        name: 'Cliente Ativo — Manutenção',
        description: 'Manutenção de relacionamento com clientes com processos ativos',
        category: 'CLIENTS',
        auto_enroll_stages: ['FINALIZADO'],
        max_attempts: 4,
        steps: [
          { position: 1, delay_hours: 360, channel: 'whatsapp', tone: 'profissional', objective: 'Atualização quinzenal do andamento processual em linguagem simples', auto_send: false },
          { position: 2, delay_hours: 360, channel: 'whatsapp', tone: 'profissional', objective: 'Segunda atualização — informar próximos passos', auto_send: false },
          { position: 3, delay_hours: 360, channel: 'whatsapp', tone: 'empatico', objective: 'Verificar se cliente tem dúvidas ou preocupações', auto_send: false },
          { position: 4, delay_hours: 360, channel: 'whatsapp', tone: 'amigavel', objective: 'Check-in de relacionamento — manter cliente informado', auto_send: false },
        ],
      },
      {
        name: 'Cobrança de Honorários',
        description: 'Sequência de cobrança de honorários em atraso — escalada gradual',
        category: 'COBRANCA',
        auto_enroll_stages: [] as string[],
        max_attempts: 5,
        steps: [
          { position: 1, delay_hours: 24, channel: 'whatsapp', tone: 'amigavel', objective: 'Lembrete amigável de pagamento com dados de PIX', auto_send: true, custom_prompt: undefined as string | undefined },
          { position: 2, delay_hours: 120, channel: 'whatsapp', tone: 'profissional', objective: 'Segundo lembrete, oferecer parcelamento como alternativa', auto_send: false, custom_prompt: undefined as string | undefined },
          { position: 3, delay_hours: 240, channel: 'email', tone: 'profissional', objective: 'Notificação formal por email, mencionar prazo para regularizar', auto_send: false, custom_prompt: undefined as string | undefined },
          { position: 4, delay_hours: 360, channel: 'email', tone: 'firme', objective: 'Aviso de possível suspensão de trabalhos por inadimplência', auto_send: false, custom_prompt: undefined as string | undefined },
          { position: 5, delay_hours: 1080, channel: 'whatsapp', tone: 'firme', objective: 'Última tentativa antes de medidas administrativas', auto_send: false, custom_prompt: 'Esta é a última mensagem antes de encaminhar para providências administrativas. Seja firme mas profissional. Mencione que o prazo para regularização está se esgotando.' },
        ],
      },
    ];

    const created: string[] = [];
    for (const seq of sequences) {
      const existing = await this.prisma.followupSequence.findFirst({ where: { name: seq.name } });
      if (!existing) {
        const { steps, ...seqData } = seq;
        const createdSeq = await this.prisma.followupSequence.create({
          data: {
            ...seqData,
            steps: {
              create: steps.map(({ custom_prompt, ...rest }) => ({
                ...rest,
                ...(custom_prompt ? { custom_prompt } : {}),
              })),
            },
          },
          include: { steps: true },
        });
        created.push(createdSeq.name);
      }
    }

    return { created, message: `${created.length} sequência(s) padrão criada(s)` };
  }
}
