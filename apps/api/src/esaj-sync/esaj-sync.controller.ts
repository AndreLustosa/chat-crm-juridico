import { Controller, Get, Post, Logger } from '@nestjs/common';
import { EsajSyncService } from './esaj-sync.service';

@Controller('esaj-sync')
export class EsajSyncController {
  private readonly logger = new Logger(EsajSyncController.name);

  constructor(private readonly service: EsajSyncService) {}

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
}
