import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TrafegoChatService — API-side facade do chat (Sprint H.5).
 *
 * Responsabilidades:
 *   - CRUD direto da TrafficChatSession e leitura de TrafficChatMessage
 *   - Enfileira jobs `send`, `apply`, `reject` na fila `trafego-chat`
 *     (worker processa)
 *
 * Não chama LLM diretamente — isso é responsabilidade do worker pra evitar
 * timeout HTTP em respostas longas + permitir polling controlado pela UI.
 */
@Injectable()
export class TrafegoChatService {
  private readonly logger = new Logger(TrafegoChatService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('trafego-chat') private readonly queue: Queue,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  // Sessions
  // ────────────────────────────────────────────────────────────────────

  async createSession(tenantId: string, userId: string, title?: string) {
    const account = await this.prisma.trafficAccount.findFirst({
      where: { tenant_id: tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!account) {
      throw new HttpException(
        'Conecte uma conta Google Ads antes de iniciar conversa.',
        HttpStatus.PRECONDITION_FAILED,
      );
    }
    const policy = await this.prisma.trafficIAPolicy.findUnique({
      where: { tenant_id: tenantId },
    });
    return this.prisma.trafficChatSession.create({
      data: {
        tenant_id: tenantId,
        account_id: account.id,
        user_id: userId,
        title: title ?? 'Nova conversa',
        llm_provider: policy?.llm_provider ?? 'anthropic',
        llm_model: (policy as any)?.llm_summary_model ?? 'claude-haiku-4-5',
      },
    });
  }

  async listSessions(tenantId: string, userId: string, limit = 30) {
    return this.prisma.trafficChatSession.findMany({
      where: {
        tenant_id: tenantId,
        user_id: userId,
        status: 'OPEN',
      },
      orderBy: { last_activity_at: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        title: true,
        started_at: true,
        last_activity_at: true,
        total_cost_brl: true,
        total_tokens_input: true,
        total_tokens_output: true,
      },
    });
  }

  async getSession(tenantId: string, sessionId: string, userId: string) {
    const session = await this.prisma.trafficChatSession.findUnique({
      where: { id: sessionId },
      include: {
        messages: {
          orderBy: { created_at: 'asc' },
        },
      },
    });
    if (
      !session ||
      session.tenant_id !== tenantId ||
      session.user_id !== userId
    ) {
      throw new HttpException('Sessão não encontrada.', HttpStatus.NOT_FOUND);
    }
    return session;
  }

  async getMessages(
    tenantId: string,
    sessionId: string,
    userId: string,
    afterMessageId?: string,
  ) {
    const session = await this.prisma.trafficChatSession.findUnique({
      where: { id: sessionId },
      select: { tenant_id: true, user_id: true },
    });
    if (
      !session ||
      session.tenant_id !== tenantId ||
      session.user_id !== userId
    ) {
      throw new HttpException('Sessão não encontrada.', HttpStatus.NOT_FOUND);
    }

    let after: Date | undefined;
    if (afterMessageId) {
      const ref = await this.prisma.trafficChatMessage.findUnique({
        where: { id: afterMessageId },
        select: { created_at: true },
      });
      after = ref?.created_at;
    }

    return this.prisma.trafficChatMessage.findMany({
      where: {
        session_id: sessionId,
        ...(after ? { created_at: { gt: after } } : {}),
      },
      orderBy: { created_at: 'asc' },
    });
  }

  async archiveSession(tenantId: string, sessionId: string, userId: string) {
    const session = await this.prisma.trafficChatSession.findUnique({
      where: { id: sessionId },
    });
    if (
      !session ||
      session.tenant_id !== tenantId ||
      session.user_id !== userId
    ) {
      throw new HttpException('Sessão não encontrada.', HttpStatus.NOT_FOUND);
    }
    return this.prisma.trafficChatSession.update({
      where: { id: sessionId },
      data: { status: 'ARCHIVED' },
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Messages — enfileira jobs no worker
  // ────────────────────────────────────────────────────────────────────

  /**
   * Envia mensagem do user. Persiste imediatamente e retorna pra UI
   * (response da IA virá assíncrono via polling). Worker processa em ~5-15s.
   */
  async sendMessage(
    tenantId: string,
    sessionId: string,
    userId: string,
    text: string,
  ) {
    const session = await this.prisma.trafficChatSession.findUnique({
      where: { id: sessionId },
    });
    if (
      !session ||
      session.tenant_id !== tenantId ||
      session.user_id !== userId
    ) {
      throw new HttpException('Sessão não encontrada.', HttpStatus.NOT_FOUND);
    }
    if (!text || text.trim().length === 0) {
      throw new HttpException('Mensagem vazia.', HttpStatus.BAD_REQUEST);
    }
    if (text.length > 4000) {
      throw new HttpException(
        'Mensagem muito longa (máx 4000 chars).',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.queue.add(
      'send',
      { tenantId, sessionId, userId, text: text.trim() },
      {
        jobId: `chat-send-${sessionId}-${Date.now()}`,
        removeOnComplete: 50,
        removeOnFail: 30,
      },
    );

    return {
      ok: true,
      message: 'Mensagem enviada — IA está processando. Faça polling em /messages a cada ~2s.',
    };
  }

  async applyAction(tenantId: string, messageId: string, userId: string) {
    const msg = await this.prisma.trafficChatMessage.findUnique({
      where: { id: messageId },
    });
    if (!msg || msg.tenant_id !== tenantId) {
      throw new HttpException('Mensagem não encontrada.', HttpStatus.NOT_FOUND);
    }
    if (msg.proposed_action_status !== 'PENDING_APPROVAL') {
      throw new HttpException(
        `Ação já está em status ${msg.proposed_action_status}.`,
        HttpStatus.CONFLICT,
      );
    }
    await this.queue.add(
      'apply',
      { tenantId, messageId, userId },
      {
        jobId: `chat-apply-${messageId}-${Date.now()}`,
        removeOnComplete: 50,
        removeOnFail: 30,
      },
    );
    return { ok: true, message: 'Aplicação enfileirada.' };
  }

  async rejectAction(
    tenantId: string,
    messageId: string,
    userId: string,
    note?: string,
  ) {
    const msg = await this.prisma.trafficChatMessage.findUnique({
      where: { id: messageId },
    });
    if (!msg || msg.tenant_id !== tenantId) {
      throw new HttpException('Mensagem não encontrada.', HttpStatus.NOT_FOUND);
    }
    if (msg.proposed_action_status !== 'PENDING_APPROVAL') {
      throw new HttpException(
        `Ação já está em status ${msg.proposed_action_status}.`,
        HttpStatus.CONFLICT,
      );
    }
    await this.queue.add(
      'reject',
      { tenantId, messageId, userId, note },
      {
        jobId: `chat-reject-${messageId}-${Date.now()}`,
        removeOnComplete: 50,
        removeOnFail: 30,
      },
    );
    return { ok: true, message: 'Rejeição registrada.' };
  }
}
