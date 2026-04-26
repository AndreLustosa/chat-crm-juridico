import { Controller, Get, Post, Logger } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { EsajSyncService } from './esaj-sync.service';
import { EsajRehydrateCronService } from './esaj-rehydrate-cron.service';

@Controller('esaj-sync')
export class EsajSyncController {
  private readonly logger = new Logger(EsajSyncController.name);

  constructor(
    private readonly service: EsajSyncService,
    private readonly rehydrate: EsajRehydrateCronService,
  ) {}

  /** Trigger manual do sync de movimentações */
  @Post('sync')
  async triggerSync() {
    this.logger.log('[POST /sync] Sync manual iniciado');
    return this.service.syncAllTrackedCases();
  }

  /** Status do último sync */
  @Get('status')
  async getStatus() {
    return this.service.getLastSyncStatus();
  }

  /**
   * Trigger manual da hidratacao de cd_movimentacao no source_raw —
   * util pra rodar AGORA em vez de esperar o cron das 2h da madrugada.
   * Processa ate 50 casos por chamada.
   */
  @Post('rehydrate')
  @Roles('ADMIN')
  async triggerRehydrate() {
    this.logger.log('[POST /rehydrate] Hidratacao manual iniciada');
    return this.rehydrate.rehydrate();
  }
}
