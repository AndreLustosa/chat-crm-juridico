import { Module } from '@nestjs/common';
import { CourtScraperController } from './court-scraper.controller';
import { CourtScraperService } from './court-scraper.service';

@Module({
  controllers: [CourtScraperController],
  providers: [CourtScraperService],
  exports: [CourtScraperService],
})
export class CourtScraperModule {}
