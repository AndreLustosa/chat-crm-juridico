import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleDriveService } from './google-drive.service';

/**
 * Limpeza mensal de pastas do Google Drive criadas para leads
 * que não se tornaram clientes após 6 meses de inatividade.
 *
 * Critérios para exclusão:
 *  - Lead tem google_drive_folder_id (pasta foi criada)
 *  - is_client = false (nunca virou cliente)
 *  - stage não é FINALIZADO (garantia extra)
 *  - updated_at < 6 meses atrás (lead inativo)
 *
 * Roda todo dia 1 às 03:00.
 */
@Injectable()
export class GoogleDriveCleanupCron {
  private readonly logger = new Logger(GoogleDriveCleanupCron.name);
  private static readonly MONTHS_THRESHOLD = 6;

  constructor(
    private readonly prisma: PrismaService,
    private readonly driveService: GoogleDriveService,
  ) {}

  @Cron('0 3 1 * *') // dia 1 de cada mês às 03:00
  async cleanupStaleLeadFolders() {
    this.logger.log('[DRIVE-CLEANUP] Iniciando limpeza de pastas de leads inativos...');

    const configured = await this.driveService.isConfigured();
    if (!configured) {
      this.logger.warn('[DRIVE-CLEANUP] Google Drive não configurado — pulando limpeza.');
      return;
    }

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - GoogleDriveCleanupCron.MONTHS_THRESHOLD);

    // Buscar em lotes para não sobrecarregar memória
    const BATCH_SIZE = 50;
    let skip = 0;
    let totalDeleted = 0;
    let totalErrors = 0;
    let totalNotFound = 0;

    while (true) {
      const leads = await this.prisma.lead.findMany({
        where: {
          google_drive_folder_id: { not: null },
          is_client: false,
          stage: { not: 'FINALIZADO' },
          updated_at: { lt: cutoff },
        },
        select: {
          id: true,
          name: true,
          google_drive_folder_id: true,
          stage: true,
          updated_at: true,
        },
        take: BATCH_SIZE,
        skip,
      });

      if (leads.length === 0) break;

      this.logger.log(`[DRIVE-CLEANUP] Processando lote de ${leads.length} leads (offset ${skip})...`);

      for (const lead of leads) {
        const folderId = lead.google_drive_folder_id!;
        try {
          const deleted = await this.driveService.deleteFolder(folderId);

          // Limpar campo no banco independente de ter excluído ou não (pasta já não é acessível)
          await this.prisma.lead.update({
            where: { id: lead.id },
            data: { google_drive_folder_id: null },
          });

          if (deleted) {
            totalDeleted++;
            this.logger.log(
              `[DRIVE-CLEANUP] ✓ Pasta excluída: lead "${lead.name}" (${lead.id}) — folder ${folderId} — inativo desde ${lead.updated_at.toISOString().slice(0, 10)}`,
            );
          } else {
            totalNotFound++;
            this.logger.log(
              `[DRIVE-CLEANUP] ~ Pasta não encontrada (já excluída?): lead "${lead.name}" (${lead.id}) — folder ${folderId}`,
            );
          }
        } catch (err: any) {
          totalErrors++;
          this.logger.error(
            `[DRIVE-CLEANUP] ✗ Erro ao excluir pasta do lead "${lead.name}" (${lead.id}) — folder ${folderId}: ${err.message}`,
          );
        }
      }

      skip += BATCH_SIZE;
    }

    this.logger.log(
      `[DRIVE-CLEANUP] Concluído. Excluídas: ${totalDeleted} | Não encontradas: ${totalNotFound} | Erros: ${totalErrors}`,
    );
  }
}
