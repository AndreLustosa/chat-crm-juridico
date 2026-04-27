import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { PaymentGatewayService } from './payment-gateway.service';

/**
 * Envia avisos de cobrança de honorarios ao cliente via WhatsApp:
 *
 *   1. Aviso imediato ao gerar cobranca (chamado pelo PaymentGatewayService.
 *      createCharge / createChargeForLeadPayment apos criar a charge)
 *   2. Lembrete pré-vencimento (cron 9h: -3d, -1d, no dia)
 *   3. Cobranca de atraso (cron 14h: +1d, +3d, +7d, +15d)
 *   4. Reconcile automatico a cada 30min (chama PaymentGatewayService.reconcile)
 *
 * REGRA DE NEGOCIO IMPORTANTE: cliente SO recebe aviso de honorario
 * CONTRATUAL ou ENTRADA. SUCUMBENCIA (alvara judicial) e ACORDO (negociacao
 * especial) NAO disparam mensagem — esses tem fluxo proprio.
 *
 * Anti-spam:
 *   - last_reminder_sent_at + last_reminder_kind na charge evitam reenvio
 *     do mesmo aviso na mesma janela
 *   - reminder_count escala mensagem (cordial → firme → urgente → alerta
 *     interno ao advogado apos 15 dias)
 *   - Lead.payment_reminders_disabled permite cliente desligar tudo
 *   - Sleep 2s entre envios em batch pra nao engasgar Evolution API
 */
@Injectable()
export class PaymentReminderService {
  private readonly logger = new Logger(PaymentReminderService.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
    private paymentGateway: PaymentGatewayService,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────

  /**
   * So notifica honorario CONTRATUAL ou ENTRADA. Pula SUCUMBENCIA (vem
   * de alvara, nao do cliente) e ACORDO (negociacao especial — advogado
   * trata caso a caso).
   */
  private shouldNotifyForType(type: string | null | undefined): boolean {
    if (!type) return false;
    const t = type.toUpperCase();
    return t === 'CONTRATUAL' || t === 'ENTRADA';
  }

  /**
   * Normaliza telefone pro formato E.164 brasileiro com 12 digitos
   * (55+DD+8). Mesma regra usada em payment-gateway.service.ts pra
   * compatibilidade com Evolution API.
   */
  private normalizePhone(raw: string): string {
    let p = (raw || '').replace(/\D/g, '');
    if (p.length <= 11) p = '55' + p;
    // Remove 9 extra: 5582999867111 (13dig) → 558299867111 (12dig)
    if (p.length === 13 && p.startsWith('55') && p[4] === '9') {
      p = p.slice(0, 4) + p.slice(5);
    }
    return p;
  }

  private formatCurrency(amount: number | string): string {
    return Number(amount).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  }

  private formatDate(d: Date): string {
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  /**
   * Carrega contexto do cliente (lead) e tipo do honorario pra decidir
   * se manda e como. Retorna null se nao deve enviar.
   *
   * Cobre 2 caminhos:
   *   a) charge.honorario_payment_id → caso ativo (CaseHonorario.type)
   *   b) charge.lead_honorario_payment_id → fase negociacao (LeadHonorario.type)
   */
  private async loadChargeContext(chargeId: string): Promise<{
    chargeId: string;
    leadId: string;
    leadName: string | null;
    leadPhone: string;
    instanceName: string | null;
    conversationId: string | null;
    honorarioType: string;
    honorarioPaymentId: string | null;
    leadHonorarioPaymentId: string | null;
    legalCase: { case_number: string | null; legal_area: string | null } | null;
    amount: number;
    dueDate: Date | null;
    pixCopyPaste: string | null;
    boletoUrl: string | null;
    invoiceUrl: string | null;
    billingType: string;
    portalUrl: string;
  } | null> {
    const charge = await this.prisma.paymentGatewayCharge.findUnique({
      where: { id: chargeId },
      include: {
        honorario_payment: {
          include: {
            honorario: {
              include: {
                legal_case: {
                  select: {
                    case_number: true,
                    legal_area: true,
                    lead: { select: { id: true, name: true, phone: true, payment_reminders_disabled: true } },
                  },
                },
              },
            },
          },
        },
        lead_honorario_payment: {
          include: {
            lead_honorario: {
              include: {
                lead: { select: { id: true, name: true, phone: true, payment_reminders_disabled: true } },
              },
            },
          },
        },
      },
    });

    if (!charge) return null;

    let honorarioType = '';
    let leadId = '';
    let leadName: string | null = null;
    let leadPhone = '';
    let optOut = false;
    let legalCase: { case_number: string | null; legal_area: string | null } | null = null;
    let honorarioPaymentId: string | null = null;
    let leadHonorarioPaymentId: string | null = null;

    if (charge.honorario_payment) {
      const hp: any = charge.honorario_payment;
      honorarioPaymentId = hp.id;
      honorarioType = hp.honorario?.type || '';
      const lc = hp.honorario?.legal_case;
      legalCase = lc ? { case_number: lc.case_number, legal_area: lc.legal_area } : null;
      const lead = lc?.lead;
      if (lead) {
        leadId = lead.id;
        leadName = lead.name;
        leadPhone = lead.phone || '';
        optOut = !!lead.payment_reminders_disabled;
      }
    } else if (charge.lead_honorario_payment) {
      const lhp: any = charge.lead_honorario_payment;
      leadHonorarioPaymentId = lhp.id;
      honorarioType = lhp.lead_honorario?.type || '';
      const lead = lhp.lead_honorario?.lead;
      if (lead) {
        leadId = lead.id;
        leadName = lead.name;
        leadPhone = lead.phone || '';
        optOut = !!lead.payment_reminders_disabled;
      }
    }

    if (!leadId || !leadPhone) {
      this.logger.warn(`[PaymentReminder] charge ${chargeId} sem lead/telefone — skip`);
      return null;
    }

    if (optOut) {
      this.logger.log(`[PaymentReminder] lead ${leadId} optou por nao receber lembretes — skip`);
      return null;
    }

    if (!this.shouldNotifyForType(honorarioType)) {
      this.logger.log(`[PaymentReminder] tipo ${honorarioType} nao notifica cliente (so CONTRATUAL/ENTRADA) — skip`);
      return null;
    }

    // Pega ultima conversa do lead pra usar mesma instance Evolution
    const lastConvo = await this.prisma.conversation.findFirst({
      where: { lead_id: leadId, status: { not: 'ENCERRADO' } },
      orderBy: { last_message_at: 'desc' },
      select: { id: true, instance_name: true },
    }).catch(() => null);

    const portalBase = process.env.PORTAL_BASE_URL || process.env.APP_URL
      || 'https://crm.andrelustosaadvogados.com.br';

    return {
      chargeId,
      leadId,
      leadName,
      leadPhone,
      instanceName: lastConvo?.instance_name ?? null,
      conversationId: lastConvo?.id ?? null,
      honorarioType,
      honorarioPaymentId,
      leadHonorarioPaymentId,
      legalCase,
      amount: Number(charge.amount),
      dueDate: charge.due_date,
      pixCopyPaste: charge.pix_copy_paste,
      boletoUrl: charge.boleto_url,
      invoiceUrl: charge.invoice_url,
      billingType: charge.billing_type,
      portalUrl: `${portalBase}/portal/pagamentos`,
    };
  }

  /**
   * Envia mensagem WhatsApp + registra como Message na conversa do
   * cliente (pra advogado ver no historico) + atualiza tracking na
   * charge (last_reminder_sent_at, reminder_count, last_reminder_kind).
   */
  private async sendAndTrack(
    ctx: NonNullable<Awaited<ReturnType<typeof this.loadChargeContext>>>,
    text: string,
    kind: string,
  ): Promise<boolean> {
    const phone = this.normalizePhone(ctx.leadPhone);
    try {
      const sendResult = await this.whatsapp.sendText(
        phone,
        text,
        ctx.instanceName ?? undefined,
      );
      this.logger.log(`[PaymentReminder] ${kind} enviado pra ${phone} (charge=${ctx.chargeId})`);

      // Registra a mensagem na conversa do cliente (historico no app
      // do advogado mostra "voce enviou cobranca em X")
      if (ctx.conversationId) {
        const evolutionMsgId = sendResult?.data?.key?.id || `sys_payment_${Date.now()}`;
        await this.prisma.message.create({
          data: {
            conversation_id: ctx.conversationId,
            direction: 'out',
            type: 'text',
            text,
            external_message_id: evolutionMsgId,
            status: 'enviado',
          },
        }).catch(() => {});
        await this.prisma.conversation.update({
          where: { id: ctx.conversationId },
          data: { last_message_at: new Date() },
        }).catch(() => {});
      }

      // Tracking — incrementa count e marca kind/timestamp
      await this.prisma.paymentGatewayCharge.update({
        where: { id: ctx.chargeId },
        data: {
          last_reminder_sent_at: new Date(),
          last_reminder_kind: kind,
          reminder_count: { increment: 1 },
        },
      });
      return true;
    } catch (e: any) {
      this.logger.warn(`[PaymentReminder] Falha ao enviar ${kind} pra ${phone}: ${e.message}`);
      return false;
    }
  }

  // ─── Fase 1: aviso imediato ao gerar cobranca ────────────────

  /**
   * Chamado pelo PaymentGatewayService logo apos criar a charge.
   * Manda WhatsApp com QR PIX ou link boleto direcionando o cliente
   * pro portal pra pagar com 1 clique.
   */
  async sendInitialChargeNotification(chargeId: string): Promise<boolean> {
    const ctx = await this.loadChargeContext(chargeId);
    if (!ctx) return false;

    const firstName = (ctx.leadName || 'Cliente').split(' ')[0];
    const valor = this.formatCurrency(ctx.amount);
    const venc = ctx.dueDate ? this.formatDate(ctx.dueDate) : null;
    const proc = ctx.legalCase?.case_number;

    const lines: string[] = [];
    lines.push(`💰 *Cobrança de Honorários*`);
    lines.push('');
    lines.push(`Olá, ${firstName}!`);
    lines.push('');
    if (proc) lines.push(`📁 Processo: ${proc}`);
    lines.push(`💵 Valor: *${valor}*`);
    if (venc) lines.push(`📅 Vencimento: ${venc}`);
    lines.push(`💳 Forma: ${ctx.billingType === 'PIX' ? 'PIX' : ctx.billingType === 'BOLETO' ? 'Boleto bancário' : 'Cartão de crédito'}`);
    lines.push('');
    lines.push(`Para pagar, acesse seu portal:`);
    lines.push(ctx.portalUrl);
    if (ctx.billingType === 'PIX' && ctx.pixCopyPaste) {
      lines.push('');
      lines.push(`Ou use o PIX copia-e-cola abaixo:`);
      lines.push('');
      lines.push(ctx.pixCopyPaste);
    } else if (ctx.billingType === 'BOLETO' && ctx.boletoUrl) {
      lines.push('');
      lines.push(`Boleto: ${ctx.boletoUrl}`);
    }
    lines.push('');
    lines.push(`Qualquer dúvida, é só responder por aqui.`);
    lines.push('');
    lines.push(`_André Lustosa Advogados_`);

    return this.sendAndTrack(ctx, lines.join('\n'), 'initial');
  }

  // ─── Fase 2: lembrete pre-vencimento ─────────────────────────

  /**
   * Cron 9h da manha — varre cobrancas PENDING com vencimento em 3, 1
   * ou 0 dias. Manda mensagem cordial. Skip se mesmo kind ja enviado
   * (evita repetir 'pre-due-3d' duas vezes).
   *
   * 9h escolhido pra cair em horario comercial e dar tempo do cliente
   * pagar no mesmo dia (vs 14h que ja eh tarde pra agencia bancaria).
   */
  @Cron('0 9 * * *', { timeZone: 'America/Maceio' })
  async sendPreDueReminders() {
    const now = new Date();
    const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
    const buckets: Array<{ kind: string; minDays: number; maxDays: number }> = [
      { kind: 'pre-due-3d', minDays: 3, maxDays: 4 }, // venc em 3 dias (ate amanha+3)
      { kind: 'pre-due-1d', minDays: 1, maxDays: 2 }, // venc em 1 dia (amanha)
      { kind: 'pre-due-0d', minDays: 0, maxDays: 1 }, // venc hoje
    ];

    let totalSent = 0;
    for (const { kind, minDays, maxDays } of buckets) {
      const start = new Date(today0); start.setDate(start.getDate() + minDays);
      const end = new Date(today0); end.setDate(end.getDate() + maxDays);

      const charges = await this.prisma.paymentGatewayCharge.findMany({
        where: {
          status: 'PENDING',
          due_date: { gte: start, lt: end },
          // Anti-spam: nao reenviar mesmo kind. last_reminder_kind null
          // (nunca enviou) ou diferente do atual passa.
          OR: [
            { last_reminder_kind: null },
            { last_reminder_kind: { not: kind } },
          ],
        },
        select: { id: true },
        take: 200,
      });
      if (charges.length === 0) continue;
      this.logger.log(`[Cron pre-due] ${kind}: ${charges.length} charge(s) na janela`);

      for (const c of charges) {
        const ok = await this.sendPreDueReminder(c.id, kind);
        if (ok) totalSent++;
        // Throttle pra nao engasgar Evolution API
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (totalSent > 0) this.logger.log(`[Cron pre-due] ${totalSent} lembrete(s) enviado(s)`);
  }

  private async sendPreDueReminder(chargeId: string, kind: string): Promise<boolean> {
    const ctx = await this.loadChargeContext(chargeId);
    if (!ctx) return false;

    const firstName = (ctx.leadName || 'Cliente').split(' ')[0];
    const valor = this.formatCurrency(ctx.amount);
    const venc = ctx.dueDate ? this.formatDate(ctx.dueDate) : null;

    let header = '';
    let urgency = '';
    if (kind === 'pre-due-3d') {
      header = '🔔 *Lembrete de pagamento*';
      urgency = `Sua parcela de honorários vence em *3 dias* (${venc}).`;
    } else if (kind === 'pre-due-1d') {
      header = '🔔 *Lembrete: vence amanhã*';
      urgency = `Sua parcela de honorários vence *amanhã* (${venc}).`;
    } else { // pre-due-0d
      header = '🔔 *Lembrete: vence hoje*';
      urgency = `Sua parcela de honorários vence *hoje*.`;
    }

    const lines: string[] = [];
    lines.push(header);
    lines.push('');
    lines.push(`Olá, ${firstName}!`);
    lines.push('');
    lines.push(urgency);
    lines.push(`💵 Valor: *${valor}*`);
    lines.push('');
    lines.push(`Para pagar, acesse: ${ctx.portalUrl}`);
    lines.push('');
    lines.push(`Sem custo extra se pagar até o vencimento.`);
    lines.push('');
    lines.push(`_André Lustosa Advogados_`);

    return this.sendAndTrack(ctx, lines.join('\n'), kind);
  }

  // ─── Fase 3: cobranca de atraso ──────────────────────────────

  /**
   * Cron 14h da tarde — varre cobrancas PENDING ou OVERDUE com vencimento
   * vencido em 1, 3, 7 ou 15+ dias. Mensagem escalona em tom (cordial →
   * firme → urgente). Apos 15 dias, NAO manda pro cliente — alerta o
   * advogado internamente pra ele decidir se liga, manda email formal,
   * ou aciona cobranca extrajudicial.
   *
   * 14h escolhido pra dar tempo do cliente ler antes do fim do expediente
   * e pagar no mesmo dia se lembrou agora.
   */
  @Cron('0 14 * * *', { timeZone: 'America/Maceio' })
  async sendOverdueReminders() {
    const now = new Date();
    const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
    const buckets: Array<{ kind: string; minDays: number; maxDays: number; alertLawyer?: boolean }> = [
      { kind: 'overdue-1d', minDays: 1, maxDays: 2 },
      { kind: 'overdue-3d', minDays: 3, maxDays: 4 },
      { kind: 'overdue-7d', minDays: 7, maxDays: 8 },
      { kind: 'overdue-15d', minDays: 15, maxDays: 99999, alertLawyer: true },
    ];

    let totalSent = 0;
    let totalAlerts = 0;
    for (const { kind, minDays, maxDays, alertLawyer } of buckets) {
      // venc atras de minDays a maxDays
      const start = new Date(today0); start.setDate(start.getDate() - maxDays);
      const end = new Date(today0); end.setDate(end.getDate() - minDays);
      end.setHours(23, 59, 59, 999);

      const charges = await this.prisma.paymentGatewayCharge.findMany({
        where: {
          status: { in: ['PENDING', 'OVERDUE'] },
          due_date: { gte: start, lt: end },
          OR: [
            { last_reminder_kind: null },
            { last_reminder_kind: { not: kind } },
          ],
        },
        select: { id: true },
        take: 200,
      });
      if (charges.length === 0) continue;
      this.logger.log(`[Cron overdue] ${kind}: ${charges.length} charge(s) na janela`);

      for (const c of charges) {
        if (alertLawyer) {
          const ok = await this.alertLawyerOverdue15Days(c.id);
          if (ok) totalAlerts++;
        } else {
          const ok = await this.sendOverdueReminder(c.id, kind);
          if (ok) totalSent++;
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (totalSent > 0) this.logger.log(`[Cron overdue] ${totalSent} cobranca(s) enviada(s)`);
    if (totalAlerts > 0) this.logger.log(`[Cron overdue] ${totalAlerts} alerta(s) ao advogado (15d+)`);
  }

  private async sendOverdueReminder(chargeId: string, kind: string): Promise<boolean> {
    const ctx = await this.loadChargeContext(chargeId);
    if (!ctx) return false;

    const firstName = (ctx.leadName || 'Cliente').split(' ')[0];
    const valor = this.formatCurrency(ctx.amount);
    const venc = ctx.dueDate ? this.formatDate(ctx.dueDate) : '—';
    const dias = kind === 'overdue-1d' ? 1 : kind === 'overdue-3d' ? 3 : 7;

    let header = '';
    let body = '';
    if (kind === 'overdue-1d') {
      header = '⏰ *Pagamento em atraso*';
      body = `Identificamos que sua parcela de honorários (vencida em ${venc}) ainda não foi paga.\nFica o lembrete pra regularizar quanto antes — só ${dias} dia(s) de atraso.`;
    } else if (kind === 'overdue-3d') {
      header = '⚠️ *Pagamento atrasado há 3 dias*';
      body = `Sua parcela de honorários (vencida em ${venc}) está atrasada há *${dias} dias*.\nPedimos a gentileza de regularizar pra evitar incidência de juros e multa.`;
    } else { // overdue-7d
      header = '🚨 *Pagamento atrasado — atenção*';
      body = `Sua parcela de honorários está atrasada há *${dias} dias* (vencimento em ${venc}).\nCaso esteja com dificuldade de pagamento, entre em contato pra a gente conversar sobre uma alternativa.`;
    }

    const lines: string[] = [];
    lines.push(header);
    lines.push('');
    lines.push(`Olá, ${firstName}!`);
    lines.push('');
    lines.push(body);
    lines.push('');
    lines.push(`💵 Valor: *${valor}*`);
    lines.push('');
    lines.push(`Pague pelo portal: ${ctx.portalUrl}`);
    lines.push('');
    lines.push(`_André Lustosa Advogados_`);

    return this.sendAndTrack(ctx, lines.join('\n'), kind);
  }

  /**
   * Atraso 15+ dias — NAO manda mensagem ao cliente. Notifica o advogado
   * via NotificationsService pra ele decidir o proximo passo (ligar,
   * email formal, cobranca extrajudicial). Marca tracking pra nao
   * disparar de novo.
   */
  private async alertLawyerOverdue15Days(chargeId: string): Promise<boolean> {
    const ctx = await this.loadChargeContext(chargeId);
    if (!ctx) {
      // Mesmo se ctx eh null (tipo nao notifica), ainda alerta o advogado
      // pra ele saber. Vou recarregar dados crus pra alerta interno.
      return this.alertLawyerForChargeRaw(chargeId);
    }

    // Marca tracking direto sem mensagem ao cliente
    await this.prisma.paymentGatewayCharge.update({
      where: { id: ctx.chargeId },
      data: {
        last_reminder_sent_at: new Date(),
        last_reminder_kind: 'overdue-15d',
        reminder_count: { increment: 1 },
      },
    });

    // Notifica todos advogados/admins do tenant — sem NotificationsService
    // por simplicidade, log estruturado pra agora. Frontend pode pegar
    // via list de charges com last_reminder_kind='overdue-15d'.
    this.logger.warn(
      `[ALERT] Cobranca ${chargeId} atrasada 15+ dias — Cliente ${ctx.leadName} ` +
      `(${ctx.leadPhone}), R$ ${ctx.amount}. Considerar contato direto.`,
    );
    return true;
  }

  private async alertLawyerForChargeRaw(chargeId: string): Promise<boolean> {
    // Fallback quando ctx nao carrega — so loga, sem dados de cliente
    await this.prisma.paymentGatewayCharge.update({
      where: { id: chargeId },
      data: {
        last_reminder_sent_at: new Date(),
        last_reminder_kind: 'overdue-15d',
        reminder_count: { increment: 1 },
      },
    }).catch(() => {});
    this.logger.warn(`[ALERT] Cobranca ${chargeId} atrasada 15+ dias mas ctx invalido — manual review`);
    return false;
  }

  // ─── Fase 4: reconcile automatico ────────────────────────────

  /**
   * Cron a cada 30min — sincroniza status de cobrancas PENDING com o
   * Asaas. Cobre caso de webhook que falhou ou demorou. Quando rola
   * mudanca de status (ex: PAGO), o paymentGateway.handleWebhook ja
   * dispara a notif de pagamento confirmado automaticamente.
   *
   * 30min escolhido como balance: webhook normal chega em segundos, mas
   * se Asaas teve down ou nosso server reiniciou no momento, o reconcile
   * pega de volta no proximo ciclo.
   */
  @Cron('*/30 * * * *')
  async reconcilePendingCharges() {
    try {
      // Reconcile sem tenantId — varre todos os tenants (ATTENTION:
      // multi-tenant ainda eh single-instance, sem isolation real aqui).
      const result = await this.paymentGateway.reconcile();
      if (result.updated > 0) {
        this.logger.log(`[Cron reconcile] ${result.updated} charge(s) atualizada(s)`);
      }
    } catch (e: any) {
      this.logger.error(`[Cron reconcile] Falhou: ${e.message}`);
    }
  }
}
