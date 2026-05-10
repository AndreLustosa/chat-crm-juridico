import { Controller, Post, Param, Query, Logger, BadRequestException, ForbiddenException, NotFoundException, Request } from '@nestjs/common';
import { EvolutionService } from './evolution.service';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../auth/decorators/roles.decorator';

/**
 * Endpoint administrativo para disparar manualmente o resync de mensagens
 * de uma instância do WhatsApp.
 *
 * Use quando:
 *  - O CRM caiu e mensagens chegaram durante a queda
 *  - Você suspeita que webhooks da Evolution API falharam silenciosamente
 *  - Precisa recuperar um histórico maior que a janela padrão do cron (2h)
 *
 * Bug fix 2026-05-10 (PR1 Webhooks #9 + #14):
 *  - Antes endpoint estava aberto a QUALQUER user autenticado — sem
 *    @Roles + sem validacao que `name` pertence ao tenant do user.
 *    Resultado: user de tenant A podia disparar resync de instancia
 *    de tenant B (vazamento horizontal de mensagens) ou rodar resync
 *    de 720h em loop (DoS via 200 lookups DB + N envios HTTP).
 *  - Agora exige @Roles('ADMIN'), valida `instance.tenant_id ===
 *    req.user.tenant_id`, e grava AuditLog (resync eh operacao cara
 *    + rastreamento de ban WhatsApp se algum dia rolar).
 */
@Controller('whatsapp/instances')
export class EvolutionAdminController {
  private readonly logger = new Logger(EvolutionAdminController.name);

  constructor(
    private readonly evolutionService: EvolutionService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * POST /whatsapp/instances/:name/resync?hours=168
   *
   * Query params:
   *  - hours: janela de tempo a recuperar (1–720, default 168 = 7 dias)
   */
  @Post(':name/resync')
  @Roles('ADMIN')
  async resync(
    @Param('name') name: string,
    @Query('hours') hours?: string,
    @Request() req?: any,
  ): Promise<{
    scheduled: true;
    instance: string;
    cutoffHours: number;
    newConvsCreated: number;
    conversationsResynced: number;
    message: string;
  }> {
    const parsed = hours ? parseInt(hours, 10) : 168;
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 720) {
      throw new BadRequestException('hours deve ser um inteiro entre 1 e 720');
    }

    // Tenant validation: admin do tenant A nao pode mexer em instance de B.
    const userTenantId = req?.user?.tenant_id;
    const userId = req?.user?.id;
    if (!userTenantId) {
      throw new ForbiddenException('Token sem tenant_id — login expirado');
    }

    const instance = await this.prisma.instance.findFirst({
      where: { name },
      select: { id: true, tenant_id: true, name: true, type: true },
    });
    if (!instance) {
      throw new NotFoundException(`Instancia "${name}" nao encontrada`);
    }
    if (instance.tenant_id && instance.tenant_id !== userTenantId) {
      this.logger.warn(
        `[MANUAL RESYNC] BLOCKED cross-tenant: user ${userId} (tenant ${userTenantId}) ` +
        `tentou resync de instance "${name}" (tenant ${instance.tenant_id})`,
      );
      throw new ForbiddenException('Instancia pertence a outro tenant');
    }

    this.logger.log(`[MANUAL RESYNC] Instância=${name}, janela=${parsed}h, actor=${userId}`);

    // Audit log ANTES do resync (operacao cara — quero rastrear quem
    // disparou mesmo se quebrar no meio)
    await this.prisma.auditLog.create({
      data: {
        actor_user_id: userId || null,
        action: 'evolution_resync',
        entity: 'Instance',
        entity_id: instance.id,
        meta_json: {
          instance_name: name,
          cutoff_hours: parsed,
          tenant_id: userTenantId,
        },
      },
    }).catch((e: any) => {
      this.logger.warn(`[AUDIT] Falha ao gravar audit log do resync: ${e.message}`);
    });

    const result = await this.evolutionService.scheduleResyncAfterReconnect(name, {
      cutoffHours: parsed,
      stabilizeDelayMs: 0, // manual → roda imediato
      triggerReason: 'manual',
    });

    return {
      scheduled: true,
      instance: name,
      cutoffHours: parsed,
      newConvsCreated: result.newConvsCreated,
      conversationsResynced: result.conversationsResynced,
      message:
        `Resync manual agendado para instância "${name}" (últimas ${parsed}h). ` +
        `${result.newConvsCreated} conversa(s) nova(s) criada(s) a partir de chats recentes. ` +
        `${result.conversationsResynced} conversa(s) ativa(s) enfileirada(s) para importação de mensagens.`,
    };
  }
}
