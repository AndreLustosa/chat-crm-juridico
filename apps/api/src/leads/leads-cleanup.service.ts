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

  async deduplicatePhones(): Promise<CleanupResult> {
    const result: CleanupResult = {
      totalDuplicatesFound: 0,
      mergedLeads: 0,
      updatedPhones: 0,
      errors: [],
    };

    const allLeads = await this.prisma.lead.findMany();

    // Encontrar leads com formato antigo (13 dígitos com nono dígito)
    const leadsWithOldFormat = allLeads.filter((lead) => {
      const cleaned = lead.phone.replace(/\D/g, '');
      return (
        cleaned.length === 13 &&
        cleaned.startsWith('55') &&
        cleaned[4] === '9'
      );
    });

    this.logger.log(
      `Encontrados ${leadsWithOldFormat.length} leads com formato antigo (13 dígitos)`,
    );

    for (const oldLead of leadsWithOldFormat) {
      try {
        const normalizedPhone = normalizeBrazilianPhone(oldLead.phone);

        const normalizedLead = await this.prisma.lead.findUnique({
          where: { phone: normalizedPhone },
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

    this.logger.log(`Limpeza concluída: ${JSON.stringify(result)}`);
    return result;
  }

  /**
   * Move todas as relações do lead source para o target e deleta o source.
   * Executado dentro de uma transaction para garantir atomicidade.
   */
  private async mergeLeads(
    sourceLeadId: string,
    targetLeadId: string,
  ): Promise<void> {
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

      // 3. Tratar AiMemory (unique por lead_id)
      const sourceMemory = await tx.aiMemory.findUnique({
        where: { lead_id: sourceLeadId },
      });
      const targetMemory = await tx.aiMemory.findUnique({
        where: { lead_id: targetLeadId },
      });

      if (sourceMemory && !targetMemory) {
        await tx.aiMemory.update({
          where: { lead_id: sourceLeadId },
          data: { lead_id: targetLeadId },
        });
      } else if (sourceMemory && targetMemory) {
        await tx.aiMemory.delete({
          where: { lead_id: sourceLeadId },
        });
      }

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
