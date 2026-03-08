import { Controller, Get, Post, Body, Patch, Delete, Param, Query, UseGuards, Request, BadRequestException, ForbiddenException } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsCleanupService } from './leads-cleanup.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Prisma } from '@crm/shared';
import { UpdateLeadDto } from './dto/create-lead.dto';

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
    return this.leadsService.create(createLeadDto);
  }

  @Get()
  findAll(@Request() req: any, @Query('inboxId') inboxId?: string) {
    return this.leadsService.findAll(req.user?.tenant_id, inboxId);
  }

  @Get('check-phone')
  checkPhone(@Query('phone') phone: string) {
    if (!phone) throw new BadRequestException('phone é obrigatório');
    return this.leadsService.checkPhone(phone);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.leadsService.findOne(id, req.user?.tenant_id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateLeadDto,
    @Request() req: any,
  ) {
    return this.leadsService.update(id, body, req.user?.tenant_id);
  }

  @Patch(':id/stage')
  updateStage(@Param('id') id: string, @Body('stage') stage: string, @Request() req: any) {
    return this.leadsService.updateStatus(id, stage, req.user?.tenant_id);
  }

  @Delete(':id/memory')
  resetMemory(@Param('id') id: string, @Request() req: any) {
    return this.leadsService.resetMemory(id, req.user?.tenant_id);
  }

  // DELETE /leads/:id — exclui contato e TODOS os seus dados (somente ADMIN)
  @Delete(':id')
  @Roles('ADMIN')
  deleteContact(@Param('id') id: string) {
    return this.leadsService.deleteContact(id);
  }

  @Post('cleanup/deduplicate')
  @Roles('ADMIN')
  deduplicatePhones() {
    return this.leadsCleanupService.deduplicatePhones();
  }
}
