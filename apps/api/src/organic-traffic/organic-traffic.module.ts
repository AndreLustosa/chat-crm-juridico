import { Module } from '@nestjs/common';
import { OrganicTrafficController } from './organic-traffic.controller';
import { OrganicTrafficService } from './organic-traffic.service';
import { OrganicTrafficCronService } from './organic-traffic-cron.service';

@Module({
  controllers: [OrganicTrafficController],
  providers: [OrganicTrafficService, OrganicTrafficCronService],
  exports: [OrganicTrafficService],
})
export class OrganicTrafficModule {}
