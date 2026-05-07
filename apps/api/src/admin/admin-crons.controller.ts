import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminCronsService } from './admin-crons.service';

@Controller('admin/crons')
export class AdminCronsController {
  constructor(private readonly service: AdminCronsService) {}

  /** Lista todos os crons registrados (auto-populado conforme cada cron roda) */
  @Get()
  @Roles('ADMIN')
  list() {
    return this.service.list();
  }

  /** Liga/desliga um cron pelo nome */
  @Patch(':name')
  @Roles('ADMIN')
  toggle(@Param('name') name: string, @Body() body: { enabled: boolean }) {
    return this.service.setEnabled(name, !!body.enabled);
  }
}
