import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../gateway/chat.gateway';
import { InboxesService } from '../inboxes/inboxes.service';
import { CronRunnerService } from '../common/cron/cron-runner.service';
import { brazilRealNowToNaive } from '../common/utils/timezone.util';

/**
 * SLA de 1ª resposta humana (Fase A — "não deixar lead parado").
 *
 * Acelera a rede de segurança que já existe no AiReactivationCron (que só age
 * depois de 24h). Aqui, em MINUTOS: quando um humano deveria estar atendendo
 * (ai_mode=false), o cliente ficou sem resposta além do prazo de SLA E NÃO há
 * um dono ONLINE cuidando (dono offline ou conversa sem dono na Espera), o
 * sistema, dentro do horário comercial:
 *   1) reativa a Athena (cobre o cliente na hora — mesma ação do reactivation,
 *      e isso tira a conversa da condição, evitando reprocessar em loop);
 *   2) reatribui ao próximo operador ONLINE do inbox via round-robin, pra
 *      garantir o toque humano (vira "monitor", IA ligada — igual à entrada);
 *   3) registra um evento no histórico + atualiza as listas (radar do admin).
 *
 * Se o operador dono está ONLINE, o cron NÃO mexe — é ele quem deve responder
 * (não atropela quem está no meio do atendimento). A rede de 24h do
 * AiReactivationCron segue como malha final pra esses casos.
 *
 * Fora do horário comercial não faz nada (a Athena já cobre e ninguém
 * responderia mesmo). Liga/desliga e histórico ficam no painel de crons
 * (CronConfig) — o admin controla sem deploy.
 *
 * Parâmetros via env (defaults sensatos):
 *   SLA_FIRST_RESPONSE_MINUTES (15) · SLA_BUSINESS_START_HOUR (8) · SLA_BUSINESS_END_HOUR (18)
 *   SLA_REACTIVATE_AI (false) — religar a IA automaticamente no estouro do SLA
 */
@Injectable()
export class SlaCronService {
  private readonly logger = new Logger(SlaCronService.name);

  private readonly slaMinutes = Number(process.env.SLA_FIRST_RESPONSE_MINUTES || 15);
  private readonly bizStart = Number(process.env.SLA_BUSINESS_START_HOUR || 8);
  private readonly bizEnd = Number(process.env.SLA_BUSINESS_END_HOUR || 18);
  // Nos últimos N minutos do expediente, só reativa a IA (não reatribui pra
  // quem já está de saída). Suaviza a virada do dia.
  private readonly reassignCutoffMin = Number(process.env.SLA_REASSIGN_CUTOFF_MINUTES || 30);
  // Religar a IA no estouro do SLA é OPCIONAL e nasce DESLIGADO (decisão do
  // André em 2026-06-11): religar não faz a IA responder a mensagem que já
  // está pendente (ela só reage a mensagem NOVA), então o religamento só
  // "pintava" a conversa de verde mascarando lead abandonado. Ligar a IA
  // volta a ser decisão do atendente; o cron segue REATRIBUINDO a operador
  // online (humano→humano). Reative com SLA_REACTIVATE_AI=true quando a IA
  // passar a responder o pendente ao ser religada.
  private readonly reactivateAi = process.env.SLA_REACTIVATE_AI === 'true';

  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
    private inboxes: InboxesService,
    private cronRunner: CronRunnerService,
  ) {}

  @Cron('*/2 * * * *', { timeZone: 'America/Maceio' })
  async enforceFirstResponseSla() {
    await this.cronRunner.run(
      'sla-first-response',
      5 * 60,
      async () => {
        await this.runImpl();
      },
      {
        description: 'SLA 1ª resposta humana: reativa a IA + reatribui leads parados (horário comercial)',
        schedule: '*/2 * * * *',
      },
    );
  }

  /** Horário comercial em BRT (seg-sex, [bizStart, bizEnd)). */
  private isBusinessHours(): boolean {
    // brazilRealNowToNaive() devolve um Date cujos componentes UTC = wall-clock BRT.
    const brt = brazilRealNowToNaive();
    const day = brt.getUTCDay(); // 0=Dom ... 6=Sáb
    const hour = brt.getUTCHours();
    if (day === 0 || day === 6) return false;
    return hour >= this.bizStart && hour < this.bizEnd;
  }

  private async runImpl() {
    if (!this.isBusinessHours()) {
      this.logger.debug('[SLA] Fora do horário comercial — pulando.');
      return;
    }

    const cutoff = new Date(Date.now() - this.slaMinutes * 60 * 1000);
    // Presença por ATIVIDADE real (não só "socket ligado agora"): quem está ativo
    // AGORA (~3 min) é o pool de reatribuição; o dono é PROTEGIDO se esteve ativo
    // dentro do SLA — sobrevive a quedas curtas do socket (aparelho hibernando),
    // pra não roubar o lead de quem está de fato trabalhando.
    const activeNow = this.chatGateway.getActiveUserIds();

    // "Suavizar o fim do dia": nos últimos minutos antes do fim do expediente,
    // só reativamos a IA — não reatribuímos leads pra atendentes que já estão
    // de saída. Fora dessa janela, reatribuição normal.
    const brtNow = brazilRealNowToNaive();
    const minutesUntilEnd = this.bizEnd * 60 - (brtNow.getUTCHours() * 60 + brtNow.getUTCMinutes());
    const allowReassign = minutesUntilEnd > this.reassignCutoffMin;

    // Candidatas: humano deveria atender (ai_mode=false), conversa aberta, é um
    // LEAD ativo (clientes contratados ficam de fora — têm responsável) e a
    // última atividade foi há mais que o SLA.
    const candidates = await this.prisma.conversation.findMany({
      where: {
        status: 'ABERTO',
        ai_mode: false,
        last_message_at: { lt: cutoff },
        lead: { is_client: false, stage: { notIn: ['PERDIDO', 'FINALIZADO', 'ENCERRADO'] } },
      },
      select: {
        id: true,
        tenant_id: true,
        inbox_id: true,
        assigned_user_id: true,
        lead: { select: { name: true, phone: true } },
        messages: { orderBy: { created_at: 'desc' }, take: 1, select: { direction: true } },
      },
      take: 50,
    });

    let acted = 0;
    for (const conv of candidates) {
      // Só age se o ÚLTIMO a falar foi o cliente (operador não respondeu).
      const last = (conv as any).messages?.[0];
      if (!last || last.direction !== 'in') continue;

      // Respeita o operador ONLINE: se o dono está online, é ele quem responde —
      // não atropela quem pode estar no meio do atendimento (consultando processo,
      // redigindo, etc.). O cron só age quando NÃO há um dono online cuidando:
      // dono offline (sumiu) ou conversa sem dono (fila de Espera).
      if (conv.assigned_user_id && this.chatGateway.isRecentlyActive(conv.assigned_user_id, this.slaMinutes * 60 * 1000)) {
        continue;
      }

      // Round-robin: próximo operador online do inbox (se houver outro diferente).
      // No fim do expediente (allowReassign=false) não reatribui — só reativa a IA.
      let nextUserId: string | null = null;
      if (allowReassign && conv.inbox_id && activeNow.length > 0) {
        try {
          nextUserId = await this.inboxes.getNextAssignee(conv.inbox_id, activeNow);
        } catch {
          nextUserId = null;
        }
      }
      const reassignTo = nextUserId && nextUserId !== conv.assigned_user_id ? nextUserId : null;

      // Sem IA automática e sem alvo de reatribuição → não há ação útil; os
      // sinais do front (badge vermelho, chip "A responder") cobrem o caso.
      if (!this.reactivateAi && !reassignTo) continue;

      // Ação atômica: (opcional) reativa a IA e, se houver, reatribui ao
      // próximo operador online.
      await this.prisma.conversation.update({
        where: { id: conv.id },
        data: {
          ...(this.reactivateAi
            ? { ai_mode: true, ai_mode_disabled_at: null, ai_mode_source: 'SLA' }
            : {}),
          ...(reassignTo ? { assigned_user_id: reassignTo } : {}),
        },
      });

      let toName: string | null = null;
      if (reassignTo) {
        const u = await this.prisma.user.findUnique({ where: { id: reassignTo }, select: { name: true } });
        toName = u?.name || null;
      }

      // Rastro no histórico (mesmo padrão dos eventos de transferência).
      // "IA" e não o nome próprio — white-label: o nome da assistente é
      // configurável por escritório e este texto é fixo.
      try {
        const text = this.reactivateAi
          ? reassignTo
            ? `⏱ Sem resposta em ${this.slaMinutes} min — IA reativada e atendimento reatribuído${toName ? ` a ${toName}` : ''}.`
            : `⏱ Sem resposta em ${this.slaMinutes} min — IA reativada para não deixar o cliente esperando.`
          : `⏱ Sem resposta em ${this.slaMinutes} min — atendimento reatribuído${toName ? ` a ${toName}` : ''}.`;
        const evt = await this.prisma.message.create({
          data: {
            conversation_id: conv.id,
            direction: 'out',
            type: 'transfer_event',
            text,
            status: 'enviado',
            external_message_id: `sla_${conv.id}_${Date.now()}`,
          },
        });
        this.chatGateway.emitNewMessage(conv.id, evt);
      } catch {
        /* histórico é best-effort — não bloqueia a recuperação */
      }

      this.chatGateway.emitConversationsUpdate(conv.tenant_id ?? null);
      acted++;
      this.logger.log(
        `[SLA] Conversa ${conv.id} (lead ${conv.lead?.phone || conv.lead?.name || '?'}) —` +
          `${this.reactivateAi ? ' IA reativada' : ''}` +
          `${reassignTo ? ` reatribuída a ${toName || reassignTo}` : ''} (cliente sem resposta > ${this.slaMinutes}min)`,
      );
    }

    if (acted > 0) {
      this.logger.log(`[SLA] ${acted} conversa(s) recuperada(s) de ${candidates.length} candidata(s).`);
    }
  }
}
