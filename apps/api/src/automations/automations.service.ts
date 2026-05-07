import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FollowupService } from '../followup/followup.service';
import { CronRunnerService } from '../common/cron/cron-runner.service';

@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    private prisma: PrismaService,
    private moduleRef: ModuleRef,
    private cronRunner: CronRunnerService,
  ) {}

  // ─── CRUD ──────────────────────────────────────────────────────

  async findAll(tenantId?: string) {
    return this.prisma.automationRule.findMany({
      where: tenantId ? { OR: [{ tenant_id: tenantId }, { tenant_id: null }] } : {},
      orderBy: { created_at: 'asc' },
    });
  }

  async create(data: { name: string; trigger: string; action: string; action_value: string; tenant_id?: string }) {
    return this.prisma.automationRule.create({ data });
  }

  async update(id: string, data: { name?: string; trigger?: string; action?: string; action_value?: string; enabled?: boolean }) {
    return this.prisma.automationRule.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.prisma.automationRule.delete({ where: { id } });
    return { ok: true };
  }

  // ─── Execution helpers ─────────────────────────────────────────

  private async executeAction(
    rule: { action: string; action_value: string },
    context: { leadId?: string; conversationId?: string },
  ) {
    try {
      if (rule.action === 'ADD_TAG' && context.leadId) {
        const lead = await this.prisma.lead.findUnique({
          where: { id: context.leadId },
          select: { tags: true },
        });
        if (lead) {
          const tags = lead.tags as string[];
          if (!tags.includes(rule.action_value)) {
            await this.prisma.lead.update({
              where: { id: context.leadId },
              data: { tags: [...tags, rule.action_value] },
            });
          }
        }
      }

      if (rule.action === 'SEND_INTERNAL_NOTE' && context.conversationId) {
        await this.prisma.message.create({
          data: {
            conversation_id: context.conversationId,
            text: `Automação: ${rule.action_value}`,
            type: 'note',
            direction: 'OUTBOUND',
            status: 'SENT',
          },
        });
      }

      if (rule.action === 'CHANGE_STAGE' && context.leadId) {
        await this.prisma.lead.update({
          where: { id: context.leadId },
          data: { stage: rule.action_value },
        });
      }

      // ENROLL_FOLLOWUP — enrola o lead em uma sequência de follow-up pelo ID
      if (rule.action === 'ENROLL_FOLLOWUP' && context.leadId) {
        try {
          const followupService = this.moduleRef.get(FollowupService, { strict: false });
          if (followupService) {
            await followupService.enrollLead(context.leadId, rule.action_value);
          }
        } catch (e: any) {
          this.logger.warn(`[AUTO] Falha ao enrolar lead em followup: ${e.message}`);
        }
      }

      // Sprint 5: CREATE_TASK — cria tarefa vinculada ao lead/conversa
      if (rule.action === 'CREATE_TASK') {
        let cfg: { title?: string; description?: string; due_hours?: number } = {};
        try { cfg = JSON.parse(rule.action_value); } catch {
          cfg = { title: rule.action_value };
        }
        if (cfg.title) {
          const dueAt = cfg.due_hours
            ? new Date(Date.now() + cfg.due_hours * 3_600_000)
            : null;
          await this.prisma.task.create({
            data: {
              title: cfg.title,
              description: cfg.description,
              lead_id: context.leadId ?? null,
              conversation_id: context.conversationId ?? null,
              due_at: dueAt,
              status: 'A_FAZER',
            },
          });
        }
      }
    } catch (err) {
      this.logger.error(`Erro ao executar automação (action=${rule.action}): ${err}`);
    }
  }

  // ─── Hook: NEW_LEAD ────────────────────────────────────────────

  async onNewLead(leadId: string, tenantId?: string) {
    const rules = await this.prisma.automationRule.findMany({
      where: {
        trigger: 'NEW_LEAD',
        enabled: true,
        ...(tenantId ? { OR: [{ tenant_id: tenantId }, { tenant_id: null }] } : {}),
      },
    });
    for (const rule of rules) {
      await this.executeAction(rule, { leadId });
    }
  }

  // ─── Hook: STAGE_CHANGE ────────────────────────────────────────

  async onStageChange(leadId: string, newStage: string, tenantId?: string) {
    const rules = await this.prisma.automationRule.findMany({
      where: {
        trigger: 'STAGE_CHANGE',
        enabled: true,
        ...(tenantId ? { OR: [{ tenant_id: tenantId }, { tenant_id: null }] } : {}),
      },
    });
    for (const rule of rules) {
      // action_value can be 'ANY' or a specific stage
      if (rule.action_value === 'ANY' || rule.action === 'ADD_TAG' || rule.action === 'SEND_INTERNAL_NOTE') {
        await this.executeAction(rule, { leadId });
      } else if (rule.action === 'CHANGE_STAGE' && rule.action_value === newStage) {
        await this.executeAction(rule, { leadId });
      }
    }
  }

  // ─── Cron: NO_RESPONSE_24H e 48H ─────────────────────────────

  @Cron(CronExpression.EVERY_HOUR)
  async checkNoResponse() {
    await this.cronRunner.run(
      'automations-no-response',
      10 * 60,
      async () => {
    this.logger.log('Checking no-response automations...');
    const now = new Date();
    const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const h25 = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    const h48 = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const h49 = new Date(now.getTime() - 49 * 60 * 60 * 1000);

    const rules24 = await this.prisma.automationRule.findMany({
      where: { trigger: 'NO_RESPONSE_24H', enabled: true },
    });
    const rules48 = await this.prisma.automationRule.findMany({
      where: { trigger: 'NO_RESPONSE_48H', enabled: true },
    });

    if (rules24.length > 0) {
      // Conversations last active between 25h and 24h ago (1-hour window to avoid re-triggering)
      const convs = await this.prisma.conversation.findMany({
        where: {
          status: { not: 'FECHADO' },
          last_message_at: { gte: h25, lte: h24 },
        },
        select: { id: true, lead_id: true },
      });
      for (const conv of convs) {
        for (const rule of rules24) {
          await this.executeAction(rule, { conversationId: conv.id, leadId: conv.lead_id ?? undefined });
        }
      }
      if (convs.length > 0) this.logger.log(`NO_RESPONSE_24H: executado em ${convs.length} conversa(s)`);
    }

    if (rules48.length > 0) {
      const convs = await this.prisma.conversation.findMany({
        where: {
          status: { not: 'FECHADO' },
          last_message_at: { gte: h49, lte: h48 },
        },
        select: { id: true, lead_id: true },
      });
      for (const conv of convs) {
        for (const rule of rules48) {
          await this.executeAction(rule, { conversationId: conv.id, leadId: conv.lead_id ?? undefined });
        }
      }
      if (convs.length > 0) this.logger.log(`NO_RESPONSE_48H: executado em ${convs.length} conversa(s)`);
    }
      },
      { description: 'Dispara automacoes NO_RESPONSE_24H/48H (lead sem resposta)', schedule: '0 * * * *' },
    );
  }

  // ─── Cron: PAYMENT_OVERDUE ─────────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkPaymentOverdue() {
    await this.cronRunner.run(
      'automations-payment-overdue',
      10 * 60,
      async () => {
    const rules = await this.prisma.automationRule.findMany({
      where: { trigger: 'PAYMENT_OVERDUE', enabled: true },
    });
    if (rules.length === 0) return;

    const now = new Date();
    // HonorarioPayment → honorario (CaseHonorario) → legal_case (LegalCase) → lead_id + conversation_id
    const overduePayments = await this.prisma.honorarioPayment.findMany({
      where: { status: 'PENDENTE', due_date: { lt: now } },
      select: {
        id: true,
        honorario: {
          select: {
            legal_case: {
              select: {
                lead_id: true,
                conversation_id: true,
              },
            },
          },
        },
      },
    });

    for (const payment of overduePayments) {
      const leadId = payment.honorario?.legal_case?.lead_id ?? undefined;
      const conversationId = payment.honorario?.legal_case?.conversation_id ?? undefined;
      if (!leadId && !conversationId) continue;
      for (const rule of rules) {
        await this.executeAction(rule, { leadId, conversationId });
      }
    }
    if (overduePayments.length > 0) {
      this.logger.log(`PAYMENT_OVERDUE: executado em ${overduePayments.length} pagamento(s)`);
    }
      },
      { description: 'Dispara automacoes PAYMENT_OVERDUE (honorario vencido)', schedule: '0 9 * * *' },
    );
  }
}
