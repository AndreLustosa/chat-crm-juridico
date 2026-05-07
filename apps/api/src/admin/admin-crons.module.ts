import { Module } from '@nestjs/common';
import { AdminCronsController } from './admin-crons.controller';
import { AdminCronsService } from './admin-crons.service';

@Module({
  controllers: [AdminCronsController],
  providers: [AdminCronsService],
})
export class AdminCronsModule {}
