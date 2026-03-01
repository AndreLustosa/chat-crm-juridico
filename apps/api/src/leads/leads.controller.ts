import { Controller, Get, Post, Body, Patch, Param, UseGuards, Request } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsCleanupService } from './leads-cleanup.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Prisma } from '@crm/shared';
import { normalizeBrazilianPhone } from '../common/utils/phone';

@UseGuards(JwtAuthGuard)
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly leadsCleanupService: LeadsCleanupService,
  ) {}

  @Post()
  create(@Body() createLeadDto: Prisma.LeadCreateInput, @Request() req: any) {
    // Associar ao tenant do usuário logado se existir
    if (req.user?.tenant_id) {
       createLeadDto.tenant = { connect: { id: req.user.tenant_id } };
    }
    if (createLeadDto.phone) {
      createLeadDto.phone = normalizeBrazilianPhone(createLeadDto.phone);
    }
    return this.leadsService.create(createLeadDto);
  }

  @Get()
  findAll(@Request() req: any) {
    return this.leadsService.findAll(req.user?.tenant_id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.leadsService.findOne(id);
  }

  @Patch(':id/stage')
  updateStage(@Param('id') id: string, @Body('stage') stage: string) {
    return this.leadsService.updateStatus(id, stage);
  }

  @Post('cleanup/deduplicate')
  deduplicatePhones() {
    return this.leadsCleanupService.deduplicatePhones();
  }
}
