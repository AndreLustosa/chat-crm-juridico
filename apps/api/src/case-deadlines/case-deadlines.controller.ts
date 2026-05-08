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
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard)
@Controller('case-deadlines')
export class CaseDeadlinesController {
  constructor(private readonly service: CaseDeadlinesService) {}

  // Listagem aberta a todos do tenant (operador precisa ver prazos)
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

  // Bug fix 2026-05-08: criar/editar/deletar/completar = ADMIN ou ADVOGADO.
  // Antes estagiario podia apagar prazo critico.
  @Post(':caseId')
  @Roles('ADMIN', 'ADVOGADO')
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
  @Roles('ADMIN', 'ADVOGADO')
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
  @Roles('ADMIN', 'ADVOGADO')
  complete(
    @Param('id') id: string,
    @Body() body?: { note?: string },
    @Request() req?: any,
  ) {
    // Bug fix 2026-05-08: passa userId pra audit log + note opcional.
    // Antes service aceitava mas controller nao mandava — auditoria vazia.
    return this.service.complete(id, req.user.tenant_id, req.user.id, body?.note);
  }

  @Delete(':id')
  @Roles('ADMIN', 'ADVOGADO')
  remove(
    @Param('id') id: string,
    @Request() req?: any,
  ) {
    return this.service.remove(id, req.user.tenant_id);
  }
}
