import { Module } from '@nestjs/common';
import { CourtScraperController } from './court-scraper.controller';
import { CourtScraperService } from './court-scraper.service';
import { CourtScraperMonitorService } from './court-scraper-monitor.service';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [GatewayModule],
  controllers: [CourtScraperController],
  providers: [CourtScraperService, CourtScraperMonitorService],
  exports: [CourtScraperService],
})
export class CourtScraperModule {}
