import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TrafegoReachPlannerService — facade da UI pra Reach Planner.
 *
 * - listForecasts: pega histórico (último N) pra exibir
 * - getForecast: detalhe (response_payload completo)
 * - enqueueGenerate: enfileira job na fila trafego-reach-planner;
 *   worker chama Google e atualiza status. UI faz polling do status.
 */
@Injectable()
export class TrafegoReachPlannerService {
  private readonly logger = new Logger(TrafegoReachPlannerService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('trafego-reach-planner') private readonly queue: Queue,
  ) {}

  async listForecasts(tenantId: string, opts: { limit?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
    return this.prisma.trafficReachForecast.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true,
        name: true,
        status: true,
        summary: true,
        error_message: true,
        created_by: true,
        created_at: true,
      },
    });
  }

  async getForecast(tenantId: string, forecastId: string) {
    const f = await this.prisma.trafficReachForecast.findUnique({
      where: { id: forecastId },
    });
    if (!f || f.tenant_id !== tenantId) {
      throw new HttpException('Forecast não encontrado.', HttpStatus.NOT_FOUND);
    }
    return f;
  }

  async enqueueGenerate(
    tenantId: string,
    params: any,
    createdBy: string,
  ): Promise<{ ok: true; message: string }> {
    const account = await this.prisma.trafficAccount.findFirst({
      where: { tenant_id: tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!account) {
      throw new HttpException(
        'Conecte uma conta Google Ads antes de calcular forecast.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!Array.isArray(params?.products) || params.products.length === 0) {
      throw new HttpException(
        'Forneça ao menos 1 produto no forecast (ex: TRUEVIEW_IN_STREAM).',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!Array.isArray(params?.location_ids) || params.location_ids.length === 0) {
      throw new HttpException(
        'Forneça ao menos 1 location_id (ex: "1031307" para Maceió).',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.queue.add(
      'generate',
      { accountId: account.id, params, createdBy },
      {
        jobId: `reach-${account.id}-${Date.now()}`,
        removeOnComplete: 30,
        removeOnFail: 20,
      },
    );

    return {
      ok: true,
      message: 'Forecast enfileirado. Resultado em ~10s na lista.',
    };
  }
}
