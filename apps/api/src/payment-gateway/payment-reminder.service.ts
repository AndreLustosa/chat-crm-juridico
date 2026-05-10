import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { PaymentGatewayService } from './payment-gateway.service';
import { SettingsService } from '../settings/settings.service';
import { CronRunnerService } from '../common/cron/cron-runner.service';

/**
 * Tipos de template suportados — string union centralizada pra UI e
 * helpers terem a mesma fonte da verdade.
 *
 * Singles (1 parcela): usado quando o cliente so tem UMA parcela elegivel
 * naquele kind/janela. Mensagem direta com dados da parcela.
 *
 * Bulks (N parcelas): usado quando o mesmo cliente tem 2+ parcelas
 * elegiveis no mesmo kind/janela — agrega tudo em UMA mensagem com
 * `{parcelas_lista}` formatada multi-line. Evita o spam de 5 mensagens
 * iguais pra Maria que ta com 5 parcelas atrasadas.
 */
export const TEMPLATE_KINDS = [
  // Singles
  'initial',      // Cobrança inicial gerada
  'pre-due-3d',   // Lembrete: vence em 3 dias
  'pre-due-1d',   // Lembrete: vence amanhã
  'pre-due-0d',   // Lembrete: vence hoje
  'overdue-1d',   // Atraso 1 dia (cordial)
  'overdue-3d',   // Atraso 3 dias (firme)
  'overdue-7d',   // Atraso 7 dias (urgente)
  // Bulks (2+ parcelas no mesmo cliente)
  'bulk-pre-due', // Multiplas parcelas vencendo em breve
  'bulk-overdue', // Multiplas parcelas em atraso
] as const;
export type TemplateKind = typeof TEMPLATE_KINDS[number];

/**
 * Defaults dos templates — usados quando admin nao customizou. Mantem
 * comportamento original do sistema pré-templates pra ninguém perder
 * mensagem em deploy. Placeholders entre {chaves} sao substituidos no
 * render.
 *
 * Variaveis disponiveis em todos:
 *   {cliente}          - primeiro nome (ou "Cliente" fallback)
 *   {cliente_completo} - nome completo (ou "Cliente")
 *   {valor}            - valor formatado em R$
 *   {vencimento}       - data DD/MM/YYYY (ou "—")
 *   {processo}         - número CNJ (ou vazio)
 *   {forma}            - PIX | Boleto bancário | Cartão de crédito
 *   {portal_url}       - link do portal/pagamentos
 *   {pix_copy_paste}   - código PIX copia-e-cola (ou vazio)
 *   {boleto_url}       - URL do boleto (ou vazio)
 *   {dias_atraso}      - número de dias atrasado (so faz sentido em overdue-*)
 *   {assinatura}       - "_André Lustosa Advogados_" (sempre)
 */
const DEFAULT_TEMPLATES: Record<TemplateKind, string> = {
  'initial': [
    '💰 *Cobrança de Honorários*',
    '',
    'Olá, {cliente}!',
    '',
    '📁 Processo: {processo}',
    '💵 Valor: *{valor}*',
    '📅 Vencimento: {vencimento}',
    '💳 Forma: {forma}',
    '',
    'Para pagar, acesse seu portal:',
    '{portal_url}',
    '',
    'PIX copia-e-cola: {pix_copy_paste}',
    'Boleto: {boleto_url}',
    '',
    'Qualquer dúvida, é só responder por aqui.',
    '',
    '{assinatura}',
  ].join('\n'),

  'pre-due-3d': [
    '🔔 *Lembrete de pagamento*',
    '',
    'Olá, {cliente}!',
    '',
    'Sua parcela de honorários vence em *3 dias* ({vencimento}).',
    '💵 Valor: *{valor}*',
    '',
    'Para pagar, acesse: {portal_url}',
    '',
    'Sem custo extra se pagar até o vencimento.',
    '',
    '{assinatura}',
  ].join('\n'),

  'pre-due-1d': [
    '🔔 *Lembrete: vence amanhã*',
    '',
    'Olá, {cliente}!',
    '',
    'Sua parcela de honorários vence *amanhã* ({vencimento}).',
    '💵 Valor: *{valor}*',
    '',
    'Para pagar, acesse: {portal_url}',
    '',
    'Sem custo extra se pagar até o vencimento.',
    '',
    '{assinatura}',
  ].join('\n'),

  'pre-due-0d': [
    '🔔 *Lembrete: vence hoje*',
    '',
    'Olá, {cliente}!',
    '',
    'Sua parcela de honorários vence *hoje*.',
    '💵 Valor: *{valor}*',
    '',
    'Para pagar, acesse: {portal_url}',
    '',
    'Sem custo extra se pagar até o vencimento.',
    '',
    '{assinatura}',
  ].join('\n'),

  'overdue-1d': [
    '⏰ *Pagamento em atraso*',
    '',
    'Olá, {cliente}!',
    '',
    'Identificamos que sua parcela de honorários (vencida em {vencimento}) ainda não foi paga.',
    'Fica o lembrete pra regularizar quanto antes — só {dias_atraso} dia(s) de atraso.',
    '',
    '💵 Valor: *{valor}*',
    '',
    'Pague pelo portal: {portal_url}',
    '',
    '{assinatura}',
  ].join('\n'),

  'overdue-3d': [
    '⚠️ *Pagamento atrasado há 3 dias*',
    '',
    'Olá, {cliente}!',
    '',
    'Sua parcela de honorários (vencida em {vencimento}) está atrasada há *{dias_atraso} dias*.',
    'Pedimos a gentileza de regularizar pra evitar incidência de juros e multa.',
    '',
    '💵 Valor: *{valor}*',
    '',
    'Pague pelo portal: {portal_url}',
    '',
    '{assinatura}',
  ].join('\n'),

  'overdue-7d': [
    '🚨 *Pagamento atrasado — atenção*',
    '',
    'Olá, {cliente}!',
    '',
    'Sua parcela de honorários está atrasada há *{dias_atraso} dias* (vencimento em {vencimento}).',
    'Caso esteja com dificuldade de pagamento, entre em contato pra a gente conversar sobre uma alternativa.',
    '',
    '💵 Valor: *{valor}*',
    '',
    'Pague pelo portal: {portal_url}',
    '',
    '{assinatura}',
  ].join('\n'),

  // Templates BULK — usados quando o mesmo cliente tem 2+ parcelas
  // elegiveis. {parcelas_lista} eh formatada multi-line tipo:
  //   "▸ R$ 500,00 — vence 15/05 (Processo 0701234)"
  //   "▸ R$ 750,00 — vence 22/05"
  // {valor} no bulk eh o TOTAL de todas as parcelas somadas.
  // {qtd_parcelas} adiciona o numero pra mensagem ficar natural.

  'bulk-pre-due': [
    '🔔 *Lembrete: parcelas a vencer*',
    '',
    'Olá, {cliente}!',
    '',
    'Você tem *{qtd_parcelas} parcelas* de honorários com vencimento próximo:',
    '',
    '{parcelas_lista}',
    '',
    'Total: *{valor}*',
    '',
    'Para pagar, acesse: {portal_url}',
    '',
    'Sem custo extra se pagar até o vencimento.',
    '',
    '{assinatura}',
  ].join('\n'),

  'bulk-overdue': [
    '⚠️ *Parcelas em atraso*',
    '',
    'Olá, {cliente}!',
    '',
    'Identificamos que você tem *{qtd_parcelas} parcelas* de honorários em atraso:',
    '',
    '{parcelas_lista}',
    '',
    'Total em aberto: *{valor}*',
    '',
    'Pedimos a gentileza de regularizar pra evitar incidência de juros e multa.',
    'Caso esteja com dificuldade de pagamento, entre em contato pra a gente conversar sobre uma alternativa.',
    '',
    'Pague pelo portal: {portal_url}',
    '',
    '{assinatura}',
  ].join('\n'),
};

/**
 * Variaveis de exemplo pra preview na UI quando admin esta editando.
 * Renderiza com dados ficticios pra advogado conseguir ver como vai
 * ficar a mensagem antes de salvar.
 */
const PREVIEW_VARS: Record<string, string> = {
  cliente: 'Maria',
  cliente_completo: 'Maria Silva Souza',
  valor: 'R$ 1.250,00',
  vencimento: '15/05/2026',
  processo: '0701234-56.2024.8.02.0058',
  forma: 'PIX',
  portal_url: 'https://crm.andrelustosaadvogados.com.br/portal/pagamentos',
  pix_copy_paste: '00020126360014BR.GOV.BCB.PIX0114+5582999999...',
  boleto_url: 'https://www.asaas.com/b/pdf/abc123',
  dias_atraso: '3',
  assinatura: '_André Lustosa Advogados_',
  // Bulk-only — preview com 3 parcelas de exemplo
  qtd_parcelas: '3',
  parcelas_lista: [
    '▸ R$ 500,00 — venc. 15/05 (Processo 0701234)',
    '▸ R$ 750,00 — venc. 22/05',
    '▸ R$ 1.000,00 — venc. 29/05 (Processo 0801555)',
  ].join('\n'),
};

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
    private settings: SettingsService,
    private cronRunner: CronRunnerService,
  ) {}

  // ─── Templates customizaveis pelo admin ───────────────────────

  /**
   * Carrega todos os templates do banco. Mescla com defaults — se admin
   * customizou apenas alguns kinds, os outros vem dos hardcoded.
   *
   * Settings key: PAYMENT_TEMPLATES contem JSON { kind: text }.
   */
  // Bug fix 2026-05-10 (Honorarios PR5 #36):
  // Cache TTL 60s. Antes cron 9h/14h percorria 200 charges, chamando
  // loadAllTemplates por charge → settings.get → DB (200 round-trips
  // redundantes). saveTemplates invalida cache via invalidateTemplateCache.
  private templatesCache: Record<TemplateKind, string> | null = null;
  private templatesCacheExpiresAt = 0;
  private static readonly TEMPLATES_CACHE_TTL_MS = 60_000;

  async loadAllTemplates(): Promise<Record<TemplateKind, string>> {
    if (this.templatesCache && this.templatesCacheExpiresAt > Date.now()) {
      return this.templatesCache;
    }
    const raw = await this.settings.get('PAYMENT_TEMPLATES').catch(() => null);
    let custom: Partial<Record<TemplateKind, string>> = {};
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') custom = parsed;
      } catch {
        this.logger.warn('[PaymentTemplate] PAYMENT_TEMPLATES malformado — usando defaults');
      }
    }
    const result = { ...DEFAULT_TEMPLATES };
    for (const k of TEMPLATE_KINDS) {
      if (typeof custom[k] === 'string' && (custom[k] as string).trim()) {
        result[k] = custom[k] as string;
      }
    }
    this.templatesCache = result;
    this.templatesCacheExpiresAt = Date.now() + PaymentReminderService.TEMPLATES_CACHE_TTL_MS;
    return result;
  }

  /** Invalidador chamado por saveTemplates pra que UI ja veja edicao. */
  private invalidateTemplateCache(): void {
    this.templatesCache = null;
    this.templatesCacheExpiresAt = 0;
  }

  /**
   * Salva templates customizados. Recebe parcial — kinds nao informados
   * permanecem como estao (ou seja, admin pode editar so um sem afetar
   * os outros). Strings vazias removem a customizacao (volta pro default).
   */
  async saveTemplates(updates: Partial<Record<TemplateKind, string>>): Promise<Record<TemplateKind, string>> {
    const existing = await this.loadCustomTemplatesRaw();
    for (const [k, v] of Object.entries(updates)) {
      if (!TEMPLATE_KINDS.includes(k as TemplateKind)) continue;
      if (typeof v !== 'string' || !v.trim()) {
        delete (existing as any)[k];
      } else {
        (existing as any)[k] = v;
      }
    }
    await this.settings.set('PAYMENT_TEMPLATES', JSON.stringify(existing));
    // Bug fix 2026-05-10 (PR5 #36): invalida cache pra UI ja ver
    this.invalidateTemplateCache();
    return this.loadAllTemplates();
  }

  /**
   * Retorna so as customizacoes (sem mesclar com defaults) — usado
   * internamente pra o save preservar overrides existentes.
   */
  private async loadCustomTemplatesRaw(): Promise<Partial<Record<TemplateKind, string>>> {
    const raw = await this.settings.get('PAYMENT_TEMPLATES').catch(() => null);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch {
      return {};
    }
  }

  /**
   * Substitui placeholders {variavel} no texto pelo valor correspondente.
   * Variavel ausente vira string vazia. Sem regex maluco — split
   * simples pra evitar pegar falsos positivos.
   */
  private interpolate(text: string, vars: Record<string, string>): string {
    return text.replace(/\{(\w+)\}/g, (match, key) => {
      return vars[key] !== undefined ? vars[key] : '';
    });
  }

  /**
   * Renderiza preview com dados ficticios pra UI mostrar ao admin
   * como vai ficar a mensagem.
   */
  async previewTemplate(kind: TemplateKind, customText?: string): Promise<string> {
    const all = await this.loadAllTemplates();
    const tpl = customText ?? all[kind];
    if (!tpl) return '';
    return this.interpolate(tpl, PREVIEW_VARS);
  }

  /**
   * Lista as variaveis disponiveis com descricao — usada pela UI pra
   * mostrar lista clicavel de placeholders.
   */
  listAvailableVariables(): Array<{ key: string; label: string; example: string; bulkOnly?: boolean }> {
    return [
      { key: 'cliente',          label: 'Primeiro nome',                example: PREVIEW_VARS.cliente },
      { key: 'cliente_completo', label: 'Nome completo',                example: PREVIEW_VARS.cliente_completo },
      { key: 'valor',            label: 'Valor formatado (ou total no bulk)', example: PREVIEW_VARS.valor },
      { key: 'vencimento',       label: 'Data de vencimento',           example: PREVIEW_VARS.vencimento },
      { key: 'processo',         label: 'Número do processo',           example: PREVIEW_VARS.processo },
      { key: 'forma',            label: 'Forma de pagamento',           example: PREVIEW_VARS.forma },
      { key: 'portal_url',       label: 'Link do portal',               example: PREVIEW_VARS.portal_url },
      { key: 'pix_copy_paste',   label: 'PIX copia-e-cola',             example: 'código PIX...' },
      { key: 'boleto_url',       label: 'Link do boleto',               example: 'URL do boleto' },
      { key: 'dias_atraso',      label: 'Dias de atraso',               example: PREVIEW_VARS.dias_atraso },
      { key: 'assinatura',       label: 'Assinatura',                   example: PREVIEW_VARS.assinatura },
      // Bulk-only
      { key: 'qtd_parcelas',     label: 'Quantidade de parcelas (bulk)', example: PREVIEW_VARS.qtd_parcelas, bulkOnly: true },
      { key: 'parcelas_lista',   label: 'Lista de parcelas formatada (bulk)', example: '▸ R$ X — venc. DD/MM ...', bulkOnly: true },
    ];
  }

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

    // Pega ultima conversa do lead pra usar mesma instance Evolution.
    // Filtra por instancia REGISTRADA DESTE tenant (defesa multi-tenant
    // pos-incidente 2026-04-29 + hardening 2026-05-06).
    const leadTenant = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { tenant_id: true },
    });
    const knownInstances = (await this.prisma.instance.findMany({
      where: { type: 'whatsapp', tenant_id: leadTenant?.tenant_id ?? undefined },
      select: { name: true },
    })).map(i => i.name);

    const lastConvo = await this.prisma.conversation.findFirst({
      where: {
        lead_id: leadId,
        status: { not: 'ENCERRADO' },
        ...(knownInstances.length > 0 ? { instance_name: { in: knownInstances } } : {}),
      },
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
    const text = await this.renderForCharge('initial', ctx);
    return this.sendAndTrack(ctx, text, 'initial');
  }

  /**
   * Constroi o map de variaveis pra interpolacao a partir do context da
   * charge. Calcula dias_atraso, normaliza forma de pagamento, preenche
   * vazios pra placeholders ausentes nao quebrarem o template.
   */
  private buildVarsForCharge(ctx: NonNullable<Awaited<ReturnType<typeof this.loadChargeContext>>>): Record<string, string> {
    const fullName = ctx.leadName || 'Cliente';
    const firstName = fullName.split(' ')[0];
    const valor = this.formatCurrency(ctx.amount);
    const venc = ctx.dueDate ? this.formatDate(ctx.dueDate) : '—';
    const proc = ctx.legalCase?.case_number || '';
    const forma = ctx.billingType === 'PIX' ? 'PIX'
      : ctx.billingType === 'BOLETO' ? 'Boleto bancário'
      : ctx.billingType === 'CREDIT_CARD' ? 'Cartão de crédito'
      : ctx.billingType;
    let diasAtraso = '0';
    if (ctx.dueDate) {
      const diff = Math.floor((Date.now() - ctx.dueDate.getTime()) / (1000 * 60 * 60 * 24));
      diasAtraso = String(Math.max(0, diff));
    }
    return {
      cliente: firstName,
      cliente_completo: fullName,
      valor,
      vencimento: venc,
      processo: proc,
      forma,
      portal_url: ctx.portalUrl,
      pix_copy_paste: ctx.pixCopyPaste || '',
      boleto_url: ctx.boletoUrl || '',
      dias_atraso: diasAtraso,
      assinatura: '_André Lustosa Advogados_',
    };
  }

  /**
   * Renderiza um template usando os dados de uma charge real.
   * Centraliza a logica pros fluxos initial/pre-due/overdue todos
   * passarem pela mesma pipeline.
   */
  private async renderForCharge(
    kind: TemplateKind,
    ctx: NonNullable<Awaited<ReturnType<typeof this.loadChargeContext>>>,
  ): Promise<string> {
    const all = await this.loadAllTemplates();
    const template = all[kind] || DEFAULT_TEMPLATES[kind];
    const vars = this.buildVarsForCharge(ctx);
    let text = this.interpolate(template, vars);

    // Limpa linhas que ficaram com so o "label:" (placeholder vazio).
    // Ex: se nao tem PIX copy-paste, "PIX copia-e-cola: " sozinho fica feio.
    // Heuristica: linha que termina em ": " ou eh so " " apos limpar
    // espacos eh removida.
    text = text
      .split('\n')
      .filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return true; // mantem linha vazia (espaco de paragrafo)
        // Remove "Label:" sem valor depois
        if (/^[^:]+:\s*$/.test(trimmed)) return false;
        return true;
      })
      .join('\n')
      // Colapsa multiplas linhas vazias seguidas em maximo 2
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return text;
  }

  /**
   * Constroi vars pra mensagem BULK (multiplas parcelas do mesmo cliente).
   * Diferenca pro single:
   *   - {valor} eh o TOTAL somado de todas as parcelas (nao a 1a)
   *   - {parcelas_lista} eh a lista formatada multi-line
   *   - {qtd_parcelas} eh o count
   *   - {vencimento}, {dias_atraso}, {processo} ficam vazios (cada
   *     parcela tem o seu — listamos no parcelas_lista, nao no header)
   */
  private buildVarsForBulk(
    leadName: string | null,
    portalUrl: string,
    contexts: Array<NonNullable<Awaited<ReturnType<typeof this.loadChargeContext>>>>,
  ): Record<string, string> {
    const fullName = leadName || 'Cliente';
    const firstName = fullName.split(' ')[0];
    const total = contexts.reduce((s, c) => s + c.amount, 0);

    // Cada linha: "▸ R$ 500,00 — venc. 15/05 (Processo 0701234)"
    const linhas = contexts.map(c => {
      const vTxt = this.formatCurrency(c.amount);
      const dTxt = c.dueDate
        ? c.dueDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
        : '—';
      const procSuffix = c.legalCase?.case_number
        ? ` (Processo ${c.legalCase.case_number})`
        : '';
      return `▸ ${vTxt} — venc. ${dTxt}${procSuffix}`;
    });

    return {
      cliente: firstName,
      cliente_completo: fullName,
      valor: this.formatCurrency(total),
      vencimento: '',
      processo: '',
      forma: '',
      portal_url: portalUrl,
      pix_copy_paste: '',
      boleto_url: '',
      dias_atraso: '',
      assinatura: '_André Lustosa Advogados_',
      qtd_parcelas: String(contexts.length),
      parcelas_lista: linhas.join('\n'),
    };
  }

  /**
   * Renderiza template bulk usando dados de N charges.
   * Reusa cleanup do renderForCharge — linhas com placeholder vazio caem.
   */
  private async renderForBulk(
    kind: 'bulk-pre-due' | 'bulk-overdue',
    leadName: string | null,
    portalUrl: string,
    contexts: Array<NonNullable<Awaited<ReturnType<typeof this.loadChargeContext>>>>,
  ): Promise<string> {
    const all = await this.loadAllTemplates();
    const template = all[kind] || DEFAULT_TEMPLATES[kind];
    const vars = this.buildVarsForBulk(leadName, portalUrl, contexts);
    let text = this.interpolate(template, vars);
    text = text
      .split('\n')
      .filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        if (/^[^:]+:\s*$/.test(trimmed)) return false;
        return true;
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return text;
  }

  /**
   * Envia mensagem bulk + atualiza tracking em TODAS as charges do grupo
   * (cada uma ganha last_reminder_kind/sent_at, nao so a primeira).
   * Sem isso, no proximo cron o sistema tentaria reenviar pras outras.
   */
  private async sendBulkAndTrack(
    leadName: string | null,
    leadPhone: string,
    instanceName: string | null,
    conversationId: string | null,
    contexts: Array<NonNullable<Awaited<ReturnType<typeof this.loadChargeContext>>>>,
    text: string,
    kind: string,
  ): Promise<boolean> {
    const phone = this.normalizePhone(leadPhone);
    try {
      const sendResult = await this.whatsapp.sendText(phone, text, instanceName ?? undefined);
      this.logger.log(
        `[PaymentReminder] BULK ${kind} pra ${phone} — ${contexts.length} parcela(s) ` +
        `(charges: ${contexts.map(c => c.chargeId).join(', ')})`,
      );

      if (conversationId) {
        const evolutionMsgId = sendResult?.data?.key?.id || `sys_payment_${Date.now()}`;
        await this.prisma.message.create({
          data: {
            conversation_id: conversationId,
            direction: 'out',
            type: 'text',
            text,
            external_message_id: evolutionMsgId,
            status: 'enviado',
          },
        }).catch(() => {});
        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { last_message_at: new Date() },
        }).catch(() => {});
      }

      // Atualiza tracking em TODAS as charges do grupo
      const now = new Date();
      await this.prisma.paymentGatewayCharge.updateMany({
        where: { id: { in: contexts.map(c => c.chargeId) } },
        data: {
          last_reminder_sent_at: now,
          last_reminder_kind: kind,
          reminder_count: { increment: 1 },
        },
      });
      return true;
    } catch (e: any) {
      this.logger.warn(`[PaymentReminder] Falha bulk ${kind} pra ${phone}: ${e.message}`);
      return false;
    }
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
    await this.cronRunner.run(
      'payment-pre-due-reminders',
      30 * 60,
      async () => {
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

      // Agrupa por lead pra detectar bulk (cliente com multiplas
      // parcelas no mesmo kind). 1 charge -> single template;
      // 2+ charges -> bulk template
      const sent = await this.sendForChargesGrouped(
        charges.map(c => c.id),
        kind as TemplateKind,
        'bulk-pre-due',
      );
      totalSent += sent;
    }
    if (totalSent > 0) this.logger.log(`[Cron pre-due] ${totalSent} lembrete(s) enviado(s)`);
      },
      { description: 'Lembrete WhatsApp 3/1/0 dias antes do vencimento (Asaas)', schedule: '0 9 * * *' },
    );
  }

  /**
   * Carrega contextos das charges, agrupa por leadId, e envia:
   *   - 1 charge no grupo: usa template single (kind)
   *   - 2+ charges: usa template bulk (bulkKind)
   *
   * Filtros (skip silencioso) feitos pelo loadChargeContext:
   *   - Tipo nao eh CONTRATUAL/ENTRADA
   *   - Lead.payment_reminders_disabled = true
   *   - Sem telefone
   *
   * Returns: total de mensagens enviadas (cada bulk conta 1 mesmo
   * agregando N parcelas).
   */
  private async sendForChargesGrouped(
    chargeIds: string[],
    singleKind: TemplateKind,
    bulkKind: 'bulk-pre-due' | 'bulk-overdue',
  ): Promise<number> {
    // Carrega contexts em paralelo (so charges elegiveis vem com ctx)
    const ctxs = await Promise.all(chargeIds.map(id => this.loadChargeContext(id)));
    const valid = ctxs.filter((c): c is NonNullable<typeof c> => !!c);
    if (valid.length === 0) return 0;

    // Agrupa por lead
    const byLead = new Map<string, typeof valid>();
    for (const c of valid) {
      const arr = byLead.get(c.leadId) || [];
      arr.push(c);
      byLead.set(c.leadId, arr);
    }

    let sent = 0;
    for (const [, group] of byLead) {
      try {
        if (group.length === 1) {
          // Single — usa template kind original
          const ctx = group[0];
          const text = await this.renderForCharge(singleKind, ctx);
          const ok = await this.sendAndTrack(ctx, text, singleKind);
          if (ok) sent++;
        } else {
          // Bulk — agrega
          const head = group[0];
          const text = await this.renderForBulk(bulkKind, head.leadName, head.portalUrl, group);
          const ok = await this.sendBulkAndTrack(
            head.leadName,
            head.leadPhone,
            head.instanceName,
            head.conversationId,
            group,
            text,
            bulkKind,
          );
          if (ok) sent++;
        }
      } catch (e: any) {
        this.logger.warn(`[Grouped send] erro: ${e.message}`);
      }
      // Bug fix 2026-05-10 (Honorarios PR4 #37 — anti-ban WhatsApp):
      // Antes throttle fixo 2s entre clientes — em batch de 200 cobrancas,
      // 200 mensagens em 6.7min na MESMA instancia → risco de ban
      // (ja experienciado em 28/04/2026, broadcast de 78 alvos derrubou a
      // conta). Agora:
      //   1. Jitter aleatorio 3-7s (quebra padrao deterministico)
      //   2. Cap diario: maximo 100 mensagens por execucao do cron
      //      (se houver mais, manda outras no proximo dia)
      //   3. Pausa longa a cada 30 mensagens (15s) — simula
      //      comportamento humano de fazer pausas
      const jitterMs = 3000 + Math.floor(Math.random() * 4000); // 3-7s
      await new Promise(r => setTimeout(r, jitterMs));
      if (sent > 0 && sent % 30 === 0) {
        this.logger.log(`[Anti-ban] Pausa de 15s apos ${sent} mensagens enviadas`);
        await new Promise(r => setTimeout(r, 15000));
      }
      const ANTI_BAN_DAILY_CAP = 100;
      if (sent >= ANTI_BAN_DAILY_CAP) {
        this.logger.warn(
          `[Anti-ban] Cap diario atingido (${ANTI_BAN_DAILY_CAP} mensagens) — pausando envios. ` +
          `Restantes serao enviados no proximo cron.`,
        );
        break;
      }
    }
    return sent;
  }

  private async sendPreDueReminder(chargeId: string, kind: string): Promise<boolean> {
    const ctx = await this.loadChargeContext(chargeId);
    if (!ctx) return false;
    if (!TEMPLATE_KINDS.includes(kind as TemplateKind)) {
      this.logger.warn(`[PreDue] kind invalido: ${kind}`);
      return false;
    }
    const text = await this.renderForCharge(kind as TemplateKind, ctx);
    return this.sendAndTrack(ctx, text, kind);
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
    await this.cronRunner.run(
      'payment-overdue-reminders',
      30 * 60,
      async () => {
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

      if (alertLawyer) {
        // 15+ dias: alerta interno por charge mesmo (advogado quer
        // ver cada caso separado pra decidir acao). Sem agregacao.
        for (const c of charges) {
          const ok = await this.alertLawyerOverdue15Days(c.id);
          if (ok) totalAlerts++;
          await new Promise(r => setTimeout(r, 500)); // throttle leve so
        }
      } else {
        // 1d/3d/7d: agrupa por lead pra evitar spam
        const sent = await this.sendForChargesGrouped(
          charges.map(c => c.id),
          kind as TemplateKind,
          'bulk-overdue',
        );
        totalSent += sent;
      }
    }
    if (totalSent > 0) this.logger.log(`[Cron overdue] ${totalSent} cobranca(s) enviada(s)`);
    if (totalAlerts > 0) this.logger.log(`[Cron overdue] ${totalAlerts} alerta(s) ao advogado (15d+)`);
      },
      { description: 'Lembrete WhatsApp para cobrancas atrasadas (1/3/7 dias) + alerta advogado em 15d+', schedule: '0 14 * * *' },
    );
  }

  private async sendOverdueReminder(chargeId: string, kind: string): Promise<boolean> {
    const ctx = await this.loadChargeContext(chargeId);
    if (!ctx) return false;
    if (!TEMPLATE_KINDS.includes(kind as TemplateKind)) {
      this.logger.warn(`[Overdue] kind invalido: ${kind}`);
      return false;
    }
    const text = await this.renderForCharge(kind as TemplateKind, ctx);
    return this.sendAndTrack(ctx, text, kind);
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
    await this.cronRunner.run(
      'payment-reconcile-pending',
      20 * 60,
      async () => {
        // Reconcile sem tenantId — varre todos os tenants (ATTENTION:
        // multi-tenant ainda eh single-instance, sem isolation real aqui).
        const result = await this.paymentGateway.reconcile();
        if (result.updated > 0) {
          this.logger.log(`[Cron reconcile] ${result.updated} charge(s) atualizada(s)`);
        }
      },
      { description: 'Sincroniza status de cobrancas PENDING com Asaas (fallback de webhook)', schedule: '*/30 * * * *' },
    );
  }
}
