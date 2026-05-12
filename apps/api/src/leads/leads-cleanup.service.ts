import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeBrazilianPhone } from '../common/utils/phone';

export interface CleanupResult {
  totalDuplicatesFound: number;
  mergedLeads: number;
  updatedPhones: number;
  errors: string[];
}

@Injectable()
export class LeadsCleanupService {
  private readonly logger = new Logger(LeadsCleanupService.name);

  constructor(private prisma: PrismaService) {}

  // Bug fix 2026-05-12 (Leads PR1 #C6 — CRITICO):
  //
  // Antes: deduplicatePhones() rodava SEM filtro tenant_id no findMany.
  // ADMIN de tenant A podia disparar e processar TODOS os leads do sistema.
  // Se 2 tenants tinham mesmo telefone normalizado em escritorios diferentes,
  // mergeLeads movia conversations/tasks/profile entre eles — VAZAMENTO
  // IRREVERSIVEL de dados entre escritorios.
  //
  // Agora: tenantId obrigatorio. findMany filtra por tenant_id. mergeLeads
  // valida que source.tenant_id === target.tenant_id antes de mover.
  // Audit log no inicio + fim.
  async deduplicatePhones(tenantId: string, actorUserId?: string): Promise<CleanupResult> {
    if (!tenantId) {
      throw new Error('tenant_id obrigatorio em deduplicatePhones');
    }

    const result: CleanupResult = {
      totalDuplicatesFound: 0,
      mergedLeads: 0,
      updatedPhones: 0,
      errors: [],
    };

    // Audit antes (mesmo se falhar, fica rastro da tentativa)
    await this.prisma.auditLog.create({
      data: {
        actor_user_id: actorUserId || null,
        action: 'leads_dedup_start',
        entity: 'Tenant',
        entity_id: tenantId,
        meta_json: { tenant_id: tenantId },
      },
    }).catch(() => { /* nao bloqueia */ });

    // Processa em batches para não carregar todos os leads na memória de uma vez
    const BATCH_SIZE = 500;
    let cursor: string | undefined = undefined;
    let totalProcessed = 0;

    this.logger.log(`Iniciando deduplicação de telefones em batches (tenant=${tenantId})...`);

    while (true) {
      // Busca apenas id, phone e tenant_id para minimizar uso de memória.
      // Bug fix #C6: filtro tenant_id no where.
      const batch: { id: string; phone: string; tenant_id: string }[] = cursor
        ? await this.prisma.lead.findMany({
            take: BATCH_SIZE,
            skip: 1,
            cursor: { id: cursor },
            where: { tenant_id: tenantId },
            select: { id: true, phone: true, tenant_id: true },
            orderBy: { id: 'asc' },
          })
        : await this.prisma.lead.findMany({
            take: BATCH_SIZE,
            where: { tenant_id: tenantId },
            select: { id: true, phone: true, tenant_id: true },
            orderBy: { id: 'asc' },
          });

      if (batch.length === 0) break;

      // Filtra apenas os que precisam de normalização (formato antigo: 13 dígitos)
      const leadsWithOldFormat = batch.filter((lead) => {
        const cleaned = lead.phone.replace(/\D/g, '');
        return (
          cleaned.length === 13 &&
          cleaned.startsWith('55') &&
          cleaned[4] === '9'
        );
      });

      for (const oldLead of leadsWithOldFormat) {
        try {
          const normalizedPhone = normalizeBrazilianPhone(oldLead.phone);

          // Dedup respeitando o tenant — leads do mesmo telefone em
          // escritorios diferentes devem permanecer separados.
          const normalizedLead = await this.prisma.lead.findFirst({
            where: { phone: normalizedPhone, tenant_id: oldLead.tenant_id },
            select: { id: true },
          });

          if (normalizedLead && normalizedLead.id !== oldLead.id) {
            // DUPLICATA: ambos existem — merge
            result.totalDuplicatesFound++;
            await this.mergeLeads(oldLead.id, normalizedLead.id);
            result.mergedLeads++;
            this.logger.log(
              `Merge: ${oldLead.id} (${oldLead.phone}) → ${normalizedLead.id} (${normalizedPhone})`,
            );
          } else {
            // Sem duplicata: apenas atualizar phone
            await this.prisma.lead.update({
              where: { id: oldLead.id },
              data: { phone: normalizedPhone },
            });
            result.updatedPhones++;
            this.logger.log(
              `Atualizado: ${oldLead.id}: ${oldLead.phone} → ${normalizedPhone}`,
            );
          }
        } catch (error) {
          const msg = `Erro ao processar lead ${oldLead.id} (${oldLead.phone}): ${error.message}`;
          this.logger.error(msg);
          result.errors.push(msg);
        }
      }

      totalProcessed += batch.length;
      cursor = batch[batch.length - 1].id;

      if (batch.length < BATCH_SIZE) break;

      this.logger.log(`Batch processado: ${totalProcessed} leads verificados até agora...`);
    }

    this.logger.log(
      `Deduplicação concluída. Total verificado: ${totalProcessed}. Resultado: ${JSON.stringify(result)}`,
    );
    return result;
  }

  /**
   * Move todas as relações do lead source para o target e deleta o source.
   * Executado dentro de uma transaction para garantir atomicidade.
   *
   * Bug fix 2026-05-12 (Leads PR1 #C6 — DEFENSE-IN-DEPTH):
   * Mesmo com filtro tenant_id no caller, valida AQUI que source.tenant_id ===
   * target.tenant_id antes de mover dados. Previne merge cross-tenant em
   * qualquer cenario (bug futuro no caller, race condition, etc).
   */
  private async mergeLeads(
    sourceLeadId: string,
    targetLeadId: string,
  ): Promise<void> {
    // Pre-check de tenant (FORA da transaction pra falhar rapido)
    const [source, target] = await Promise.all([
      this.prisma.lead.findUnique({ where: { id: sourceLeadId }, select: { tenant_id: true } }),
      this.prisma.lead.findUnique({ where: { id: targetLeadId }, select: { tenant_id: true } }),
    ]);
    if (!source || !target) {
      throw new Error(`mergeLeads: source ou target nao encontrado (${sourceLeadId} → ${targetLeadId})`);
    }
    if (source.tenant_id !== target.tenant_id) {
      this.logger.error(
        `[mergeLeads] CROSS-TENANT BLOCKED: source=${sourceLeadId} (tenant=${source.tenant_id}) ` +
        `≠ target=${targetLeadId} (tenant=${target.tenant_id}). Operacao abortada.`,
      );
      throw new Error('mergeLeads: leads de tenants diferentes — operacao bloqueada por seguranca');
    }

    await this.prisma.$transaction(async (tx) => {
      // 1. Mover conversations
      await tx.conversation.updateMany({
        where: { lead_id: sourceLeadId },
        data: { lead_id: targetLeadId },
      });

      // 2. Mover tasks
      await tx.task.updateMany({
        where: { lead_id: sourceLeadId },
        data: { lead_id: targetLeadId },
      });

      // 3. Tratar LeadProfile (unique por lead_id) — atualizado em 2026-04-20
      //    (fase 2d-1): antes manipulava AiMemory. Agora trabalha com o sistema
      //    novo (LeadProfile). Memory entries (scope='lead') tambem sao migradas.
      const sourceProfile = await tx.leadProfile.findUnique({
        where: { lead_id: sourceLeadId },
      });
      const targetProfile = await tx.leadProfile.findUnique({
        where: { lead_id: targetLeadId },
      });

      if (sourceProfile && !targetProfile) {
        await tx.leadProfile.update({
          where: { lead_id: sourceLeadId },
          data: { lead_id: targetLeadId },
        });
      } else if (sourceProfile && targetProfile) {
        await tx.leadProfile.delete({
          where: { lead_id: sourceLeadId },
        });
      }

      // Memory entries scope=lead — reassignar scope_id
      await tx.memory.updateMany({
        where: { scope: 'lead', scope_id: sourceLeadId },
        data: { scope_id: targetLeadId },
      });

      // 4. Preencher campos vazios do target com dados do source
      const sourceLead = await tx.lead.findUnique({
        where: { id: sourceLeadId },
      });
      const targetLead = await tx.lead.findUnique({
        where: { id: targetLeadId },
      });

      if (sourceLead && targetLead) {
        const updates: any = {};
        if (!targetLead.name && sourceLead.name)
          updates.name = sourceLead.name;
        if (!targetLead.email && sourceLead.email)
          updates.email = sourceLead.email;
        if (!targetLead.profile_picture_url && sourceLead.profile_picture_url)
          updates.profile_picture_url = sourceLead.profile_picture_url;
        if (sourceLead.tags && sourceLead.tags.length > 0) {
          updates.tags = [
            ...new Set([...targetLead.tags, ...sourceLead.tags]),
          ];
        }
        if (Object.keys(updates).length > 0) {
          await tx.lead.update({ where: { id: targetLeadId }, data: updates });
        }
      }

      // 5. Deletar o lead source (agora órfão)
      await tx.lead.delete({ where: { id: sourceLeadId } });
    });
  }
}
