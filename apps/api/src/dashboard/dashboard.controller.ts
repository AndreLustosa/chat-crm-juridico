import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get()
  getDashboard(@Request() req: any) {
    return this.service.aggregate(
      req.user.id,
      req.user.role,
      req.user.tenant_id,
    );
  }
}
