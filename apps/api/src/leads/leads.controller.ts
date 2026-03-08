import { Controller, Get, Post, Body, Patch, Delete, Param, Query, UseGuards, Request, BadRequestException, ForbiddenException } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsCleanupService } from './leads-cleanup.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Prisma } from '@crm/shared';
import { CreateLeadDto, UpdateLeadDto, UpdateStageDto } from './dto/create-lead.dto';

@UseGuards(JwtAuthGuard)
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly leadsCleanupService: LeadsCleanupService,
  ) {}

  @Post()
  create(@Body() dto: CreateLeadDto, @Request() req: any) {
    // Constrói o input do Prisma a partir do DTO validado
    // O tenant_id vem sempre do token JWT — nunca do body
    const data: Prisma.LeadCreateInput = {
      name: dto.name,
      phone: dto.phone,
      ...(dto.email && { email: dto.email }),
      ...(dto.tags && { tags: dto.tags }),
      ...(dto.origin && { origin: dto.origin }),
      ...(req.user?.tenant_id && { tenant: { connect: { id: req.user.tenant_id } } }),
    };
    return this.leadsService.create(data);
  }

  @Get()
  findAll(
    @Request() req: any,
    @Query('inboxId') inboxId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = page ? parseInt(page, 10) : undefined;
    const l = limit ? parseInt(limit, 10) : undefined;
    return this.leadsService.findAll(req.user?.tenant_id, inboxId, p, l);
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
  updateStage(@Param('id') id: string, @Body() dto: UpdateStageDto, @Request() req: any) {
    return this.leadsService.updateStatus(id, dto.stage, req.user?.tenant_id);
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
