import { Controller, Get, Post, Patch, Delete, Body, Param, Request } from '@nestjs/common';
import { AutomationsService } from './automations.service';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('automations')
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  @Get()
  findAll(@Request() req: any) {
    return this.automationsService.findAll(req.user.tenantId);
  }

  @Post()
  @Roles('ADMIN')
  create(@Request() req: any, @Body() body: { name: string; trigger: string; action: string; action_value: string }) {
    return this.automationsService.create({ ...body, tenant_id: req.user.tenantId });
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Param('id') id: string,
    @Body() body: { name?: string; trigger?: string; action?: string; action_value?: string; enabled?: boolean },
  ) {
    return this.automationsService.update(id, body);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.automationsService.remove(id);
  }
}
