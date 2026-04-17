import { Controller, Get, UseGuards, Request, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardAnalyticsService, type DashboardScope } from './dashboard-analytics.service';
import { TeamPerformanceService } from './team-performance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly service: DashboardService,
    private readonly analytics: DashboardAnalyticsService,
    private readonly teamPerformance: TeamPerformanceService,
  ) {}

  private parseScope(s?: string): DashboardScope | undefined {
    if (!s) return undefined;
    if (['comercial', 'juridico', 'financeiro', 'estagiarios'].includes(s)) {
      return s as DashboardScope;
    }
    return undefined;
  }

  @Get()
  getDashboard(@Request() req: any) {
    return this.service.aggregate(
      req.user.id,
      req.user.roles,
      req.user.tenant_id,
    );
  }

  @Get('comparisons')
  comparisons(
    @Request() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.comparisons(
      req.user.id,
      req.user.roles,
      req.user.tenant_id,
      startDate,
      endDate,
    );
  }

  @Get('revenue-trend')
  revenueTrend(
    @Request() req: any,
    @Query('months') months?: string,
    @Query('scope') scope?: string,
  ) {
    return this.analytics.revenueTrend(
      req.user.id, req.user.roles, req.user.tenant_id,
      months ? parseInt(months, 10) : 12,
      this.parseScope(scope),
    );
  }

  @Get('lead-funnel')
  leadFunnel(
    @Request() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('scope') scope?: string,
  ) {
    return this.analytics.leadFunnel(
      req.user.id, req.user.roles, req.user.tenant_id,
      startDate, endDate,
      this.parseScope(scope),
    );
  }

  @Get('conversion-velocity')
  conversionVelocity(
    @Request() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('scope') scope?: string,
  ) {
    return this.analytics.conversionVelocity(
      req.user.id, req.user.roles, req.user.tenant_id,
      startDate, endDate,
      this.parseScope(scope),
    );
  }

  @Get('task-completion')
  taskCompletion(
    @Request() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('scope') scope?: string,
  ) {
    return this.analytics.taskCompletion(
      req.user.id, req.user.roles, req.user.tenant_id,
      startDate, endDate,
      this.parseScope(scope),
    );
  }

  @Get('case-duration')
  caseDuration(
    @Request() req: any,
    @Query('scope') scope?: string,
  ) {
    return this.analytics.caseDuration(
      req.user.id, req.user.roles, req.user.tenant_id,
      this.parseScope(scope),
    );
  }

  @Get('cases-by-area')
  casesByArea(
    @Request() req: any,
    @Query('scope') scope?: string,
  ) {
    return this.analytics.casesByArea(
      req.user.id, req.user.roles, req.user.tenant_id,
      this.parseScope(scope),
    );
  }

  @Get('financial-aging')
  financialAging(
    @Request() req: any,
    @Query('scope') scope?: string,
  ) {
    return this.analytics.financialAging(
      req.user.id, req.user.roles, req.user.tenant_id,
      this.parseScope(scope),
    );
  }

  @Get('ai-usage')
  aiUsage(
    @Request() req: any,
    @Query('months') months?: string,
  ) {
    if (!req.user.roles?.includes('ADMIN')) return { byMonth: [], byModel: [], totalCost: 0 };
    return this.analytics.aiUsage(
      req.user.id, req.user.role, req.user.tenant_id,
      months ? parseInt(months, 10) : 6,
    );
  }

  @Get('lead-sources')
  leadSources(
    @Request() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('scope') scope?: string,
  ) {
    return this.analytics.leadSources(
      req.user.id, req.user.roles, req.user.tenant_id,
      startDate, endDate,
      this.parseScope(scope),
    );
  }

  @Get('response-time')
  responseTime(
    @Request() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('scope') scope?: string,
  ) {
    return this.analytics.responseTime(
      req.user.id, req.user.roles, req.user.tenant_id,
      startDate, endDate,
      this.parseScope(scope),
    );
  }

  @Get('team-performance')
  getTeamPerformance(
    @Request() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('scope') scope?: string,
  ) {
    return this.teamPerformance.getPerformance(
      req.user.id, req.user.roles, req.user.tenant_id,
      startDate, endDate,
      this.parseScope(scope),
    );
  }
}
