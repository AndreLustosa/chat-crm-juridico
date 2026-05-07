import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminCronsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista todos os crons registrados, ordenados por:
   *   1) erro primeiro (operador deve ver problemas)
   *   2) desativados depois
   *   3) restante por nome
   */
  async list() {
    const all = await this.prisma.cronConfig.findMany({
      orderBy: { name: 'asc' },
    });

    const errored = all.filter((c) => c.last_status === 'error');
    const disabled = all.filter((c) => !c.enabled && c.last_status !== 'error');
    const ok = all.filter((c) => c.enabled && c.last_status !== 'error');

    return [...errored, ...disabled, ...ok].map((c) => ({
      name: c.name,
      description: c.description,
      schedule: c.schedule,
      enabled: c.enabled,
      last_run_at: c.last_run_at,
      last_status: c.last_status,
      last_error: c.last_error,
      last_duration_ms: c.last_duration_ms,
      run_count: c.run_count,
    }));
  }

  async setEnabled(name: string, enabled: boolean) {
    const exists = await this.prisma.cronConfig.findUnique({ where: { name } });
    if (!exists) {
      throw new NotFoundException(
        `Cron "${name}" nao encontrado. Crons sao auto-registrados na primeira execucao.`,
      );
    }
    return this.prisma.cronConfig.update({
      where: { name },
      data: { enabled },
      select: { name: true, enabled: true },
    });
  }
}
