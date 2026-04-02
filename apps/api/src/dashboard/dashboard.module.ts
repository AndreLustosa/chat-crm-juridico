import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardAnalyticsService } from './dashboard-analytics.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, DashboardAnalyticsService],
})
export class DashboardModule {}
