import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { enums } from 'google-ads-api';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsMutateService } from './google-ads-mutate.service';
import type { ProposedAction } from './traffic-chat.tools';

/**
 * TrafficChatApplyService — executa proposed_action de uma TrafficChatMessage
 * (Sprint H.4).
 *
 * Fluxo:
 *   1. UI envia POST /trafego/chat/messages/:id/apply (clique no card)
 *   2. Carrega message + valida que está em PENDING_APPROVAL
 *   3. Resolve resource_names locais → 'customers/X/...' do Google Ads
 *   4. Chama GoogleAdsMutateService.execute() — passa OAB validator,
 *      registra em TrafficMutateLog (initiator='HUMAN_VIA_CHAT')
 *   5. Atualiza message com proposed_action_status='APPLIED' + mutate_log_id
 *   6. Retorna pra UI
 *
 * Erros do Google Ads viram proposed_action_status='REJECTED' com motivo.
 */
@Injectable()
export class TrafficChatApplyService {
  private readonly logger = new Logger(TrafficChatApplyService.name);

  constructor(
    private prisma: PrismaService,
    private mutate: GoogleAdsMutateService,
  ) {}

  async apply(
    tenantId: string,
    messageId: string,
    userId: string,
  ): Promise<ApplyResult> {
    const msg = await this.prisma.trafficChatMessage.findUnique({
      where: { id: messageId },
      include: { session: { select: { user_id: true } } },
    });
    if (!msg || msg.tenant_id !== tenantId) {
      throw new HttpException('Mensagem não encontrada.', HttpStatus.NOT_FOUND);
    }
    if (msg.session.user_id !== userId) {
      throw new HttpException(
        'Apenas o autor da sessão pode aplicar ações.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (!msg.proposed_action) {
      throw new HttpException(
        'Mensagem não tem ação proposta.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (msg.proposed_action_status !== 'PENDING_APPROVAL') {
      throw new HttpException(
        `Ação já está em status ${msg.proposed_action_status}.`,
        HttpStatus.CONFLICT,
      );
    }

    const action = msg.proposed_action as unknown as ProposedAction;

    // Carrega TrafficAccount + customer_id pra montar resource_names
    const account = await this.prisma.trafficAccount.findUnique({
      where: { id: msg.account_id },
    });
    if (!account || !account.customer_id) {
      throw new HttpException(
        'Conta sem customer_id alvo configurado.',
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    let mutateResult;
    try {
      mutateResult = await this.executeAction(action, account);
    } catch (err: any) {
      const errMsg = err?.message ?? String(err);
      await this.prisma.trafficChatMessage.update({
        where: { id: messageId },
        data: {
          proposed_action_status: 'REJECTED',
          proposed_action_resolved_at: new Date(),
          proposed_action_resolved_by: userId,
          error_message: errMsg.slice(0, 1000),
        },
      });
      throw new HttpException(errMsg, HttpStatus.BAD_GATEWAY);
    }

    if (mutateResult.status === 'FAILED') {
      // OAB block ou erro do Google
      await this.prisma.trafficChatMessage.update({
        where: { id: messageId },
        data: {
          proposed_action_status: 'REJECTED',
          proposed_action_resolved_at: new Date(),
          proposed_action_resolved_by: userId,
          proposed_action_mutate_log_id: mutateResult.logId,
          error_message:
            mutateResult.errorMessage?.slice(0, 1000) ?? 'Mutate falhou.',
        },
      });
      return {
        ok: false,
        message_id: messageId,
        status: 'REJECTED',
        error: mutateResult.errorMessage,
        oab_violations: mutateResult.oabViolations,
        mutate_log_id: mutateResult.logId,
      };
    }

    await this.prisma.trafficChatMessage.update({
      where: { id: messageId },
      data: {
        proposed_action_status: 'APPLIED',
        proposed_action_resolved_at: new Date(),
        proposed_action_resolved_by: userId,
        proposed_action_mutate_log_id: mutateResult.logId,
      },
    });

    this.logger.log(
      `[chat-apply] message=${messageId} action=${action.action_kind} APPLIED by user=${userId} mutate_log=${mutateResult.logId}`,
    );

    return {
      ok: true,
      message_id: messageId,
      status: 'APPLIED',
      mutate_log_id: mutateResult.logId,
    };
  }

  async reject(
    tenantId: string,
    messageId: string,
    userId: string,
    note?: string,
  ): Promise<ApplyResult> {
    const msg = await this.prisma.trafficChatMessage.findUnique({
      where: { id: messageId },
      include: { session: { select: { user_id: true } } },
    });
    if (!msg || msg.tenant_id !== tenantId) {
      throw new HttpException('Mensagem não encontrada.', HttpStatus.NOT_FOUND);
    }
    if (msg.session.user_id !== userId) {
      throw new HttpException('Forbidden.', HttpStatus.FORBIDDEN);
    }
    if (msg.proposed_action_status !== 'PENDING_APPROVAL') {
      throw new HttpException(
        `Ação já está em status ${msg.proposed_action_status}.`,
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.trafficChatMessage.update({
      where: { id: messageId },
      data: {
        proposed_action_status: 'REJECTED',
        proposed_action_resolved_at: new Date(),
        proposed_action_resolved_by: userId,
        error_message: note?.slice(0, 500) ?? 'Rejeitada pelo admin.',
      },
    });
    return { ok: true, message_id: messageId, status: 'REJECTED' };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Action dispatch — converte ProposedAction em mutate concreto
  // ──────────────────────────────────────────────────────────────────────

  private async executeAction(action: ProposedAction, account: any) {
    const customerId = account.customer_id as string;

    switch (action.action_kind) {
      case 'PAUSE_CAMPAIGN':
      case 'RESUME_CAMPAIGN': {
        if (!action.campaign_id) throw new Error('campaign_id ausente');
        const camp = await this.prisma.trafficCampaign.findUnique({
          where: { id: action.campaign_id },
        });
        if (!camp) throw new Error('Campanha não encontrada localmente.');
        const status =
          action.action_kind === 'PAUSE_CAMPAIGN'
            ? enums.CampaignStatus.PAUSED
            : enums.CampaignStatus.ENABLED;
        return this.mutate.execute({
          tenantId: account.tenant_id,
          accountId: account.id,
          resourceType: 'campaign',
          operation: 'update',
          initiator: 'HUMAN_VIA_CHAT',
          operations: [
            {
              resource_name: `customers/${customerId}/campaigns/${camp.google_campaign_id}`,
              status,
            },
          ],
          context: {
            chat_apply: true,
            reason: action.reason,
          },
        });
      }
      case 'PAUSE_AD_GROUP':
      case 'RESUME_AD_GROUP': {
        if (!action.ad_group_id) throw new Error('ad_group_id ausente');
        const ag = await this.prisma.trafficAdGroup.findUnique({
          where: { id: action.ad_group_id },
        });
        if (!ag) throw new Error('Ad group não encontrado.');
        const status =
          action.action_kind === 'PAUSE_AD_GROUP'
            ? enums.AdGroupStatus.PAUSED
            : enums.AdGroupStatus.ENABLED;
        return this.mutate.execute({
          tenantId: account.tenant_id,
          accountId: account.id,
          resourceType: 'ad_group',
          operation: 'update',
          initiator: 'HUMAN_VIA_CHAT',
          operations: [
            {
              resource_name: `customers/${customerId}/adGroups/${ag.google_ad_group_id}`,
              status,
            },
          ],
          context: { chat_apply: true, reason: action.reason },
        });
      }
      case 'PAUSE_AD': {
        if (!action.ad_id) throw new Error('ad_id ausente');
        const ad = await this.prisma.trafficAd.findUnique({
          where: { id: action.ad_id },
          include: { ad_group: { select: { google_ad_group_id: true } } },
        });
        if (!ad) throw new Error('Ad não encontrado.');
        const adGroupAdResourceName = `customers/${customerId}/adGroupAds/${ad.ad_group.google_ad_group_id}~${ad.google_ad_id}`;
        return this.mutate.execute({
          tenantId: account.tenant_id,
          accountId: account.id,
          resourceType: 'ad_group_ad',
          operation: 'update',
          initiator: 'HUMAN_VIA_CHAT',
          operations: [
            {
              resource_name: adGroupAdResourceName,
              status: enums.AdGroupAdStatus.PAUSED,
            },
          ],
          context: { chat_apply: true, reason: action.reason },
        });
      }
      case 'UPDATE_BUDGET': {
        if (!action.campaign_id) throw new Error('campaign_id ausente');
        if (!action.new_amount_brl) throw new Error('new_amount_brl ausente');
        const camp = await this.prisma.trafficCampaign.findUnique({
          where: { id: action.campaign_id },
        });
        if (!camp) throw new Error('Campanha não encontrada.');
        if (!camp.budget_resource_name) {
          throw new Error(
            'Campanha sem budget cacheado. Rode "Sincronizar agora" antes.',
          );
        }
        const newMicros = BigInt(Math.round(action.new_amount_brl * 1_000_000));
        return this.mutate.execute({
          tenantId: account.tenant_id,
          accountId: account.id,
          resourceType: 'campaign_budget',
          operation: 'update',
          initiator: 'HUMAN_VIA_CHAT',
          operations: [
            {
              resource_name: camp.budget_resource_name,
              amount_micros: newMicros,
            },
          ],
          context: {
            chat_apply: true,
            reason: action.reason,
            new_amount_brl: action.new_amount_brl,
          },
        });
      }
      case 'ADD_NEGATIVE_KEYWORD_CAMPAIGN':
      case 'ADD_NEGATIVE_KEYWORD_AD_GROUP': {
        if (!action.negative_keyword) throw new Error('negative_keyword ausente');
        const matchType = mapMatchType(action.match_type ?? 'PHRASE');
        if (action.action_kind === 'ADD_NEGATIVE_KEYWORD_CAMPAIGN') {
          if (!action.campaign_id) throw new Error('campaign_id ausente');
          const camp = await this.prisma.trafficCampaign.findUnique({
            where: { id: action.campaign_id },
          });
          if (!camp) throw new Error('Campanha não encontrada.');
          return this.mutate.execute({
            tenantId: account.tenant_id,
            accountId: account.id,
            resourceType: 'campaign_criterion',
            operation: 'create',
            initiator: 'HUMAN_VIA_CHAT',
            keywordText: action.negative_keyword,
            operations: [
              {
                campaign: `customers/${customerId}/campaigns/${camp.google_campaign_id}`,
                negative: true,
                keyword: {
                  text: action.negative_keyword,
                  match_type: matchType,
                },
              },
            ],
            context: { chat_apply: true, reason: action.reason },
          });
        }
        // AD_GROUP
        if (!action.ad_group_id) throw new Error('ad_group_id ausente');
        const ag = await this.prisma.trafficAdGroup.findUnique({
          where: { id: action.ad_group_id },
        });
        if (!ag) throw new Error('Ad group não encontrado.');
        return this.mutate.execute({
          tenantId: account.tenant_id,
          accountId: account.id,
          resourceType: 'ad_group_criterion',
          operation: 'create',
          initiator: 'HUMAN_VIA_CHAT',
          keywordText: action.negative_keyword,
          operations: [
            {
              ad_group: `customers/${customerId}/adGroups/${ag.google_ad_group_id}`,
              negative: true,
              keyword: {
                text: action.negative_keyword,
                match_type: matchType,
              },
            },
          ],
          context: { chat_apply: true, reason: action.reason },
        });
      }
      default:
        throw new Error(`action_kind desconhecido: ${action.action_kind}`);
    }
  }
}

function mapMatchType(mt: 'EXACT' | 'PHRASE' | 'BROAD') {
  switch (mt) {
    case 'EXACT':
      return enums.KeywordMatchType.EXACT;
    case 'PHRASE':
      return enums.KeywordMatchType.PHRASE;
    case 'BROAD':
      return enums.KeywordMatchType.BROAD;
  }
}

export type ApplyResult = {
  ok: boolean;
  message_id: string;
  status: 'APPLIED' | 'REJECTED';
  mutate_log_id?: string;
  error?: string;
  oab_violations?: any;
};
