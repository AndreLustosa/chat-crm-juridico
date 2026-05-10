import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CronRunnerService } from '../common/cron/cron-runner.service';
import { OrganicTrafficService } from './organic-traffic.service';

@Injectable()
export class OrganicTrafficCronService {
  private readonly logger = new Logger(OrganicTrafficCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cronRunner: CronRunnerService,
    private readonly organicTraffic: OrganicTrafficService,
  ) {}

  @Cron('40 6 * * *', { timeZone: 'America/Maceio' })
  async runDailySearchConsoleSync() {
    await this.cronRunner.run(
      'organic-traffic-search-console-sync',
      60 * 60,
      async () => {
        const configs = await this.prisma.organicSearchConfig.findMany({
          where: {
            is_active: true,
            service_account_b64: { not: null },
          },
          select: { tenant_id: true },
        });

        if (configs.length === 0) {
          this.logger.log('[ORGANIC_TRAFFIC] Nenhum Search Console configurado');
          return;
        }

        const end = new Date();
        end.setDate(end.getDate() - 1);
        const start = new Date(end);
        start.setDate(start.getDate() - 7);

        const dto = {
          startDate: start.toISOString().slice(0, 10),
          endDate: end.toISOString().slice(0, 10),
          inspect: false,
        };

        for (const config of configs) {
          try {
            await this.organicTraffic.syncSearchAnalytics(
              config.tenant_id,
              'CRON',
              dto,
            );
          } catch (e: any) {
            this.logger.error(
              `[ORGANIC_TRAFFIC] Sync tenant=${config.tenant_id} falhou: ${e?.message ?? e}`,
            );
          }
        }
      },
      {
        description: 'Sync diario de metricas organicas do Google Search Console',
        schedule: '40 6 * * *',
      },
    );
  }
}
