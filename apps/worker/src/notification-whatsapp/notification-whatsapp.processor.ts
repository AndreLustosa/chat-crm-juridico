import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Circuit breaker contra ban da Evolution / WhatsApp.
 *
 * Contexto: incidente 28/04/2026 — broadcast de 78 alvos derrubou a conta
 * (memoria `whatsapp_ban_disparo`). A causa raiz foi 100 jobs disparando
 * em rajada apos delay BullMQ — Evolution nao detecta como humano.
 *
 * Defesas adicionadas aqui:
 *   1. Jitter aleatorio 0.5-3s antes de cada envio — quebra rajada
 *      sincrona de jobs que terminam delay BullMQ ao mesmo tempo
 *   2. Circuit breaker — se taxa de erro nas ultimas N janelas for >= 50%,
 *      pula envio e re-enfileira pra mais tarde. Reseta janela 5min.
 *   3. Counters em memoria — perde no restart, mas se houver problema real,
 *      a janela de 5min nova ja vai pegar de novo.
 *
 * NAO substitui rate-limit do lado do worker BullMQ (concurrency=1 evita
 * paralelismo), mas previne picos quando varias notificacoes terminam
 * delay no mesmo segundo.
 */
const CIRCUIT_WINDOW_MS = 5 * 60 * 1000;     // janela de 5min
const CIRCUIT_MIN_SAMPLES = 5;               // so abre circuit apos 5 samples
const CIRCUIT_FAILURE_THRESHOLD = 0.5;       // 50% de erro = abre
const JITTER_MIN_MS = 500;
const JITTER_MAX_MS = 3000;

// Bug fix 2026-05-10 (NotifService PR2 #4): rate limit por user.
// Antes circuit breaker era GLOBAL (mede saude da Evolution toda) — nao
// protegia contra cenario "pico de 50 mensagens em conversas diferentes
// pro mesmo advogado em 5min". Cada conversa diferente bypassa dedup
// (dedup eh por conversation), entao 50 WhatsApps em rajada saem pro
// mesmo numero de telefone — Evolution flagga isso como bot.
//
// Estrategia: DB count (Notification.whatsapp_sent_at) na ultima 1h.
// Se >= MAX_WHATSAPP_PER_HOUR, skip + log warn. Persistente (sobrevive
// restart). Custo: 1 query extra por job (negligivel — index existe em
// user_id, whatsapp_sent_at).
const MAX_WHATSAPP_PER_HOUR_PER_USER = 15;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1h

interface CircuitWindow {
  windowStart: number;
  total: number;
  failures: number;
}

/**
 * Processa jobs de notificação por WhatsApp.
 * Cada job é enfileirado com delay de 5min após uma Notification ser criada.
 * Se a notificação já foi lida (push/socket), o WhatsApp NÃO é enviado.
 */
@Processor('notification-whatsapp')
export class NotificationWhatsappProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationWhatsappProcessor.name);
  private circuit: CircuitWindow = { windowStart: Date.now(), total: 0, failures: 0 };

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {
    super();
  }

  /** Janela rotativa: zera counters apos CIRCUIT_WINDOW_MS desde o ultimo reset. */
  private rotateCircuitWindowIfNeeded(): void {
    const now = Date.now();
    if (now - this.circuit.windowStart >= CIRCUIT_WINDOW_MS) {
      this.circuit = { windowStart: now, total: 0, failures: 0 };
    }
  }

  /**
   * Retorna true se o circuit ESTA ABERTO (ou seja, nao deve enviar).
   * So abre se ja teve samples suficientes — evita falso-positivo no boot.
   */
  private isCircuitOpen(): boolean {
    this.rotateCircuitWindowIfNeeded();
    if (this.circuit.total < CIRCUIT_MIN_SAMPLES) return false;
    return this.circuit.failures / this.circuit.total >= CIRCUIT_FAILURE_THRESHOLD;
  }

  private recordSuccess(): void {
    this.rotateCircuitWindowIfNeeded();
    this.circuit.total++;
  }

  private recordFailure(): void {
    this.rotateCircuitWindowIfNeeded();
    this.circuit.total++;
    this.circuit.failures++;
  }

  private async jitter(): Promise<void> {
    const ms = JITTER_MIN_MS + Math.floor(Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS));
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async process(job: Job<{ notificationId: string; userId: string }>) {
    const { notificationId, userId } = job.data;

    // Circuit breaker: se taxa de erro >50% nos ultimos 5min, throw para
    // BullMQ retentar com backoff. Protege contra ban Evolution quando algo
    // sistemico esta errado (instancia desconectada, apikey rotacionada, etc).
    if (this.isCircuitOpen()) {
      this.logger.warn(
        `[NotifWA] Circuit breaker ABERTO (${this.circuit.failures}/${this.circuit.total} falhas em ${CIRCUIT_WINDOW_MS / 1000 / 60}min) — re-enfileirando`,
      );
      throw new Error('Circuit breaker open — temporary backoff');
    }

    try {
      // 1. Notificação já foi lida? (socket/push dentro dos 5min)
      const notification = await (this.prisma as any).notification.findUnique({
        where: { id: notificationId },
      });

      if (!notification) {
        this.logger.log(`[NotifWA] Notificação ${notificationId} não encontrada — skip`);
        return;
      }

      if (notification.read_at) {
        this.logger.log(`[NotifWA] Notificação ${notificationId} já lida — WhatsApp não enviado`);
        return;
      }

      // 2. Usuário tem telefone cadastrado?
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { phone: true, name: true },
      });

      if (!user?.phone) {
        this.logger.warn(`[NotifWA] Usuário ${userId} sem telefone cadastrado — skip`);
        return;
      }

      // 3. Preferência do usuário — WhatsApp habilitado para este tipo?
      const settings = await (this.prisma as any).notificationSetting.findUnique({
        where: { user_id: userId },
      });

      if (settings?.preferences) {
        const prefs = settings.preferences as any;
        const typePrefs = prefs[notification.notification_type];
        if (typePrefs && typePrefs.whatsapp === false) {
          this.logger.log(`[NotifWA] WhatsApp desabilitado para tipo "${notification.notification_type}" — skip`);
          return;
        }
      }

      // Bug fix 2026-05-10 (NotifService PR1 #3): respeitar ConversationMute
      // no fallback de WhatsApp. Antes ChatGateway so usava o mute pra
      // pular sound/desktop, mas a Notification era criada e o WhatsApp
      // disparava 5min depois mesmo com conversation mutada — cliente
      // reclamava "mutei mas continuo recebendo WhatsApp". Agora:
      //   - Se notification eh de incoming_message E conversation muted
      //     pra esse user, marca como skip (mute respeitado em todos os
      //     canais) e nao dispara
      const conversationIdForMute = notification.data?.conversationId;
      if (conversationIdForMute && notification.notification_type === 'incoming_message') {
        const muteRecord = await (this.prisma as any).conversationMute.findUnique({
          where: {
            user_id_conversation_id: {
              user_id: userId,
              conversation_id: conversationIdForMute,
            },
          },
          select: { muted_until: true },
        }).catch(() => null);
        const isMuted = muteRecord && (
          !muteRecord.muted_until || new Date(muteRecord.muted_until) > new Date()
        );
        if (isMuted) {
          this.logger.log(
            `[NotifWA] Conversation ${conversationIdForMute} esta mutada pelo user ${userId} — skip WhatsApp (mute respeitado em todos canais)`,
          );
          return;
        }
      }

      // Bug fix 2026-05-10 (NotifService PR2 #4): rate limit por user.
      // Conta WhatsApps enviados ao user nas ultimas 1h. Se >=15, skip.
      // Janela conservadora — advogado normal recebe 5-10/dia. Pico
      // de 15+/hora indica problema (bot escrevendo no chat, varias
      // delegacoes ao mesmo estagiario, evento massivo). Melhor perder
      // 1 notif do que arriscar ban (bug 2026-04-28 ainda fresco).
      const sentInLastHour = await (this.prisma as any).notification.count({
        where: {
          user_id: userId,
          whatsapp_sent_at: { gte: new Date(Date.now() - RATE_LIMIT_WINDOW_MS) },
        },
      }).catch(() => 0);
      if (sentInLastHour >= MAX_WHATSAPP_PER_HOUR_PER_USER) {
        this.logger.warn(
          `[NotifWA] Rate limit: user ${userId} ja recebeu ${sentInLastHour} WhatsApps na ultima hora ` +
          `(max ${MAX_WHATSAPP_PER_HOUR_PER_USER}) — skip notif ${notificationId}. ` +
          `Notificacao continua acessivel via push/socket/sino.`,
        );
        return;
      }

      // 4. Dedup por (conversa | lead | task | type-fallback) — INDEPENDENTE
      // de read_at.
      //
      // Bug reportado 2026-04-26 (Gianny): cada mensagem nova do cliente
      // gerava 1 WhatsApp se a Notification anterior tivesse read_at
      // preenchido (advogado tinha aberto o app no meio). Spam.
      //
      // Bug fix 2026-05-10 (NotifService PR2 #5): EXPANDIR dedup. Antes
      // so cobria conversationId/leadId. Resultado: 5 tasks delegadas
      // ao mesmo estagiario no mesmo minuto = 5 WhatsApps em rajada
      // (cada Notification tem data.taskId diferente, sem cobertura).
      //
      // Estrategia em camadas:
      //   a) Se tem conversationId → dedup por conversationId+type 60min
      //   b) Se tem leadId → dedup por leadId+type 60min
      //   c) Se tem taskId → dedup por taskId+type 60min (cobre task_assigned,
      //      task_comment, task_overdue, task_reopened do MESMO task)
      //   d) Fallback: dedup por type-only 15min (cobre rajada de
      //      task_assigned multiplas tasks diferentes ao mesmo user)
      const DEDUP_WINDOW_MS = 60 * 60 * 1000;
      const FALLBACK_DEDUP_MS = 15 * 60 * 1000;

      const data = notification.data || {};
      let dedupKey: string | undefined;
      let dedupPath: string | undefined;
      if (data.conversationId) { dedupKey = data.conversationId; dedupPath = 'conversationId'; }
      else if (data.leadId) { dedupKey = data.leadId; dedupPath = 'leadId'; }
      else if (data.taskId) { dedupKey = data.taskId; dedupPath = 'taskId'; }

      if (dedupKey && dedupPath) {
        const recentWhatsappSent = await (this.prisma as any).notification.findFirst({
          where: {
            user_id: userId,
            notification_type: notification.notification_type,
            data: { path: [dedupPath], equals: dedupKey },
            whatsapp_sent_at: { gte: new Date(Date.now() - DEDUP_WINDOW_MS) },
            id: { not: notificationId },
          },
          orderBy: { whatsapp_sent_at: 'desc' },
          select: { id: true, whatsapp_sent_at: true },
        });
        if (recentWhatsappSent) {
          this.logger.log(
            `[NotifWA] Dedup ativo: WhatsApp ja enviado pra ${dedupPath}=${dedupKey} ` +
            `as ${recentWhatsappSent.whatsapp_sent_at?.toISOString()} — skip`,
          );
          return;
        }
      } else {
        // Fallback: sem chave de entidade — dedup por (user, type) 15min.
        // Protege contra rajadas de notif sem dedup-key (raras, mas existem).
        const recentTypeSent = await (this.prisma as any).notification.findFirst({
          where: {
            user_id: userId,
            notification_type: notification.notification_type,
            whatsapp_sent_at: { gte: new Date(Date.now() - FALLBACK_DEDUP_MS) },
            id: { not: notificationId },
          },
          orderBy: { whatsapp_sent_at: 'desc' },
          select: { id: true, whatsapp_sent_at: true },
        });
        if (recentTypeSent) {
          this.logger.log(
            `[NotifWA] Dedup fallback (type-only ${FALLBACK_DEDUP_MS / 60000}min): ` +
            `${notification.notification_type} ja enviado pra user ${userId} as ` +
            `${recentTypeSent.whatsapp_sent_at?.toISOString()} — skip`,
          );
          return;
        }
      }

      // 5. Envia via Evolution API
      const { apiUrl, apiKey } = await this.settings.getEvolutionConfig();
      if (!apiUrl || !apiKey) {
        this.logger.warn('[NotifWA] Evolution API não configurada — skip');
        return;
      }

      // Bug fix 2026-05-10 (NotifService PR1 #2): resolver instance via
      // tenant_id da notification em vez de pegar EVOLUTION_INSTANCE_NAME
      // global. Antes em deploy multi-tenant (Lexcon convive na mesma
      // Evolution), notif do tenant A poderia disparar via instancia de B.
      // Estrategia:
      //   1. Busca primeira Instance whatsapp do tenant da notif
      //   2. Fallback pra env (single-tenant deploy atual)
      //   3. Se nada — skip com log
      let instanceName: string | undefined;
      if (notification.tenant_id) {
        const tenantInstance = await (this.prisma as any).instance.findFirst({
          where: { type: 'whatsapp', tenant_id: notification.tenant_id },
          select: { name: true },
        }).catch(() => null);
        if (tenantInstance?.name) instanceName = tenantInstance.name;
      }
      if (!instanceName) {
        instanceName = process.env.EVOLUTION_INSTANCE_NAME || undefined;
        if (instanceName && notification.tenant_id) {
          this.logger.warn(`[NotifWA] Tenant ${notification.tenant_id} sem Instance cadastrada — fallback pro env ${instanceName}`);
        }
      }
      if (!instanceName) {
        this.logger.warn(`[NotifWA] Sem instancia disponivel pra notif ${notificationId} (tenant=${notification.tenant_id || 'sem'}) — skip`);
        return;
      }

      const appUrl = process.env.APP_URL || 'https://crm.andrelustosaadvogados.com.br';
      const deepLink = notification.data?.conversationId
        ? `${appUrl}/atendimento`
        : notification.data?.leadId
          ? `${appUrl}/atendimento/crm`
          : appUrl;

      // ─── Resumo das mensagens recentes do cliente ───────────────────
      //
      // Antes (Gianny, 2026-04-26): notificacao mostrava so "Nova mensagem
      // recebida" — generica. Agora mostra preview das ultimas mensagens
      // do cliente pra advogado decidir se eh urgente sem precisar abrir
      // o app.
      //
      // Estrategia: pega ate 5 mensagens INBOUND da conversa criadas desde
      // o ultimo whatsapp_sent_at deste user (ou ultimos 60min), trunca
      // cada uma em ~120 chars.
      let messagesPreview = '';
      let messagesCount = 0;
      if (notification.notification_type === 'incoming_message' && notification.data?.conversationId) {
        const conversationId = notification.data.conversationId;

        // Janela: desde o ultimo WhatsApp enviado a este user pra esta
        // conversa (pra cobrir TODAS as mensagens nao avisadas), com
        // teto de 60min pra nao incluir conteudo muito antigo.
        const lastSentToUser = await (this.prisma as any).notification.findFirst({
          where: {
            user_id: userId,
            notification_type: 'incoming_message',
            data: { path: ['conversationId'], equals: conversationId },
            whatsapp_sent_at: { not: null },
            id: { not: notificationId },
          },
          orderBy: { whatsapp_sent_at: 'desc' },
          select: { whatsapp_sent_at: true },
        });
        const sixtyMinAgo = new Date(Date.now() - 60 * 60 * 1000);
        const since = lastSentToUser?.whatsapp_sent_at && lastSentToUser.whatsapp_sent_at > sixtyMinAgo
          ? lastSentToUser.whatsapp_sent_at
          : sixtyMinAgo;

        const messages = await this.prisma.message.findMany({
          where: {
            conversation_id: conversationId,
            direction: 'in',
            text: { not: null },
            created_at: { gte: since },
          },
          orderBy: { created_at: 'asc' },
          select: { text: true, created_at: true },
          take: 10, // pega no max 10, mostra 5
        });

        messagesCount = messages.length;
        if (messagesCount > 0) {
          const previewLines = messages.slice(0, 5).map(m => {
            const t = (m.text || '').replace(/\s+/g, ' ').trim();
            return `▸ ${t.length > 120 ? t.slice(0, 117) + '...' : t}`;
          });
          if (messagesCount > 5) {
            previewLines.push(`_+${messagesCount - 5} mensagem(ns)_`);
          }
          messagesPreview = previewLines.join('\n');
        }
      }

      // Monta o texto final
      const lines: string[] = [];
      lines.push(`🔔 *${notification.title}*`);
      if (messagesPreview) {
        lines.push('');
        lines.push(messagesPreview);
      } else if (notification.body) {
        // Fallback pra notif que nao seja incoming_message (transfer_request, etc)
        lines.push(notification.body);
      }
      lines.push('');
      lines.push(`Abrir o chat: ${deepLink}`);
      const text = lines.join('\n');

      // Jitter pre-envio: quebra rajada sincrona quando varios jobs
      // terminam delay BullMQ no mesmo segundo (ban risk).
      await this.jitter();

      try {
        await axios.post(
          `${apiUrl}/message/sendText/${instanceName}`,
          { number: user.phone, text },
          { headers: { 'Content-Type': 'application/json', apikey: apiKey }, timeout: 15000 },
        );
        this.recordSuccess();
      } catch (sendErr: any) {
        this.recordFailure();
        this.logger.warn(
          `[NotifWA] Envio falhou (${sendErr.response?.status || sendErr.code || 'unknown'}): ${sendErr.message}`,
        );
        // Re-throw pra BullMQ retentar (e nao gravar whatsapp_sent_at — vai
        // tentar de novo no proximo retry com novo job)
        throw sendErr;
      }

      // Marca whatsapp_sent_at — usado pelo dedup das proximas notificacoes
      // da mesma conversa (60min de janela).
      await (this.prisma as any).notification.update({
        where: { id: notificationId },
        data: { whatsapp_sent_at: new Date() },
      }).catch(() => {});

      this.logger.log(`[NotifWA] WhatsApp enviado para ${user.phone}: "${notification.title}"`);
    } catch (e: any) {
      this.logger.error(`[NotifWA] Falha ao processar job: ${e.message}`);
      throw e; // re-throw para BullMQ contar como retry e respeitar attempts
    }
  }
}
