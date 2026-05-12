import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CronRunnerService } from '../common/cron/cron-runner.service';

/**
 * MemoryDedupService
 * ──────────────────
 * Cron diario (03:00 America/Maceio) que deduplica memorias organizacionais
 * muito similares (cosine > 0.93). Memorias de lead sao deduplicadas logo
 * apos cada consolidacao de perfil, entao esse cron foca so no org.
 */
@Injectable()
export class MemoryDedupService {
  private readonly logger = new Logger(MemoryDedupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cronRunner: CronRunnerService,
  ) {}

  @Cron('0 3 * * *', { timeZone: 'America/Maceio' })
  async dedupOrganizationMemories() {
    await this.cronRunner.run(
      'memory-dedup-organization',
      20 * 60,
      async () => {
        const enabled = await this.prisma.globalSetting.findUnique({
          where: { key: 'MEMORY_BATCH_ENABLED' },
        });
        if ((enabled?.value ?? 'true').toLowerCase() === 'false') return;

        // Bug fix 2026-05-11 (Memoria PR3 #M3):
        // LIMIT 500 + ORDER BY pra evitar processar tabela inteira.
        // Antes: tenant com 5K+ memorias podia gerar query de 2 minutos
        // (cross-join sem cap). Agora cap em 500 dups por execucao —
        // proximas execucoes pegam o resto.
        const DEDUP_BATCH_LIMIT = 500;
        const duplicates = await this.prisma.$queryRaw<{ id_a: string; id_b: string }[]>`
          SELECT a.id AS id_a, b.id AS id_b
          FROM "Memory" a JOIN "Memory" b ON a.id < b.id
          WHERE a.tenant_id = b.tenant_id
            AND a.scope = 'organization' AND b.scope = 'organization'
            AND a.scope_id = b.scope_id
            AND a.status = 'active' AND b.status = 'active'
            AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
            AND 1 - (a.embedding <=> b.embedding) > 0.93
          ORDER BY a.created_at ASC
          LIMIT ${DEDUP_BATCH_LIMIT}
        `;

        for (const dup of duplicates) {
          await this.prisma.memory
            .update({
              where: { id: dup.id_a },
              data: { status: 'superseded', superseded_by: dup.id_b },
            })
            .catch(() => {});
        }
        this.logger.log(`[MemoryDedup] ${duplicates.length} memorias organizacionais dedupadas`);
        if (duplicates.length >= DEDUP_BATCH_LIMIT) {
          this.logger.warn(
            `[MemoryDedup] Cap ${DEDUP_BATCH_LIMIT} atingido — pode haver mais duplicatas. Proxima execucao continuara.`,
          );
        }
      },
      { description: 'Marca memorias organizacionais com cosine > 0.93 como superseded', schedule: '0 3 * * *' },
    );
  }
}
