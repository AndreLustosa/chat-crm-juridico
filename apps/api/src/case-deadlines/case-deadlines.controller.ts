import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { CaseDeadlinesService } from './case-deadlines.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('case-deadlines')
export class CaseDeadlinesController {
  constructor(private readonly service: CaseDeadlinesService) {}

  @Get(':caseId')
  findByCaseId(
    @Param('caseId') caseId: string,
    @Query('completed') completed?: string,
    @Request() req?: any,
  ) {
    const completedBool =
      completed === 'true' ? true : completed === 'false' ? false : undefined;
    return this.service.findByCaseId(caseId, req.user.tenant_id, completedBool);
  }

  @Post(':caseId')
  create(
    @Param('caseId') caseId: string,
    @Body()
    body: {
      type: string;
      title: string;
      description?: string;
      due_at: string;
      alert_days?: number;
    },
    @Request() req?: any,
  ) {
    return this.service.create(caseId, body, req.user.id, req.user.tenant_id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      type?: string;
      title?: string;
      description?: string;
      due_at?: string;
      alert_days?: number;
    },
    @Request() req?: any,
  ) {
    return this.service.update(id, body, req.user.tenant_id);
  }

  @Patch(':id/complete')
  complete(
    @Param('id') id: string,
    @Request() req?: any,
  ) {
    return this.service.complete(id, req.user.tenant_id);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Request() req?: any,
  ) {
    return this.service.remove(id, req.user.tenant_id);
  }
}
