import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EnhancedConvUploadCron } from './enhanced-conv-upload.cron';

export const ENHANCED_CONV_TRIGGER_JOB = 'trafego-enhanced-conv-trigger';

export type EnhancedConvTriggerInput = {
  tenantId?: string;
  daysBack?: number;
};

/**
 * Consumer da queue `trafego-enhanced-conv` — disparado pelo API quando o
 * gestor (ou Claude via MCP) chama o trigger manual de upload.
 *
 * Concurrency 1 pra evitar 2 jobs rodando ao mesmo tempo (ambos iterando
 * leads = duplicacao tratada pelo unique constraint de TrafficOCIUpload
 * mas vira CPU desperdicio).
 *
 * Retorna o resultado direto do `cron.triggerManual` — controller usa via
 * `job.waitUntilFinished` pra retornar contadores ao caller MCP.
 */
@Injectable()
@Processor('trafego-enhanced-conv', { concurrency: 1 })
export class EnhancedConvTriggerProcessor extends WorkerHost {
  private readonly logger = new Logger(EnhancedConvTriggerProcessor.name);

  constructor(private cron: EnhancedConvUploadCron) {
    super();
  }

  async process(
    job: Job<EnhancedConvTriggerInput>,
  ): Promise<{
    tenants_processed: number;
    leads_enqueued: number;
    leads_skipped: number;
    errors: number;
  }> {
    if (job.name !== ENHANCED_CONV_TRIGGER_JOB) {
      this.logger.warn(
        `[enhanced-conv-trigger] job desconhecido: ${job.name}`,
      );
      throw new Error(`Job desconhecido: ${job.name}`);
    }
    this.logger.log(
      `[enhanced-conv-trigger] manual trigger tenantId=${job.data.tenantId ?? 'ALL'} daysBack=${job.data.daysBack ?? 14}`,
    );
    return await this.cron.triggerManual(job.data);
  }
}
