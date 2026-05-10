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
import { LegalTemplatesService } from './legal-templates.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard)
@Controller('legal-templates')
export class LegalTemplatesController {
  constructor(private readonly service: LegalTemplatesService) {}

  @Get()
  @Roles('ADMIN', 'ADVOGADO', 'ESTAGIARIO')
  findAll(
    @Query('legal_area') legalArea?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Request() req?: any,
  ) {
    return this.service.findAll(req.user.tenant_id, {
      legal_area: legalArea,
      type,
      search,
    });
  }

  @Post()
  @Roles('ADMIN', 'ADVOGADO')
  create(
    @Body() body: {
      name: string;
      type: string;
      legal_area?: string;
      content_json: any;
      variables?: string[];
      description?: string;
      is_global?: boolean;
    },
    @Request() req: any,
  ) {
    return this.service.create(body, req.user.id, req.user.tenant_id);
  }

  @Get(':id')
  @Roles('ADMIN', 'ADVOGADO', 'ESTAGIARIO')
  findById(
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.findById(id, req.user.tenant_id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'ADVOGADO')
  update(
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      type?: string;
      legal_area?: string;
      content_json?: any;
      variables?: string[];
      description?: string;
    },
    @Request() req: any,
  ) {
    // Bug fix #22: passa actorUserId pra audit log
    return this.service.update(id, body, req.user.tenant_id, req.user.id);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(
    @Param('id') id: string,
    @Query('force') force?: string,
    @Request() req?: any,
  ) {
    return this.service.remove(id, req.user.tenant_id, force === 'true');
  }
}
