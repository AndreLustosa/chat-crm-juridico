import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardAnalyticsService } from './dashboard-analytics.service';
import { TeamPerformanceService } from './team-performance.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, DashboardAnalyticsService, TeamPerformanceService],
})
export class DashboardModule {}
