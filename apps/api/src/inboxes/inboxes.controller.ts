import { Controller, Get, Post, Body, Param, Put, Delete, Request, UseGuards } from '@nestjs/common';
import { InboxesService } from './inboxes.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard)
@Controller('inboxes')
export class InboxesController {
  constructor(private readonly inboxesService: InboxesService) {}

  @Get()
  async findAll(@Request() req: any) {
    const userId = req.user?.id;
    const isAdmin = req.user?.roles?.includes('ADMIN');
    // ADMINs veem todos os inboxes DO TENANT; outros só os que são membros.
    return this.inboxesService.findAll(req.user?.tenant_id, isAdmin ? undefined : userId);
  }

  @Get('operators')
  async getAllOperators(@Request() req: any) {
    // Qualquer usuário autenticado pode listar operadores (necessário para transferências),
    // mas SEMPRE escopado ao tenant do usuário — multi-tenant: nunca vazar outros escritórios.
    return this.inboxesService.findAllOperators(req.user?.tenant_id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: any) {
    return this.inboxesService.findOne(id, req.user?.tenant_id);
  }

  @Post()
  @Roles('ADMIN')
  async create(@Body() data: { name: string }, @Request() req: any) {
    // tenant_id é OBRIGATÓRIO (multi-tenant): sem ele o create quebra (coluna
    // NOT NULL) e o inbox não fica isolado por escritório.
    return this.inboxesService.create({ name: data.name, tenant_id: req.user?.tenant_id });
  }

  @Put(':id')
  @Roles('ADMIN')
  async update(@Param('id') id: string, @Body() data: { name: string }, @Request() req: any) {
    return this.inboxesService.update(id, data, req.user?.tenant_id);
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@Param('id') id: string, @Request() req: any) {
    return this.inboxesService.remove(id, req.user?.tenant_id);
  }

  // --- Gestão de Usuários ---

  @Post(':id/users')
  @Roles('ADMIN')
  async addUser(@Param('id') id: string, @Body() data: { userId: string }, @Request() req: any) {
    return this.inboxesService.addUser(id, data.userId, req.user?.tenant_id);
  }

  @Delete(':id/users/:userId')
  @Roles('ADMIN')
  async removeUser(@Param('id') id: string, @Param('userId') userId: string, @Request() req: any) {
    return this.inboxesService.removeUser(id, userId, req.user?.tenant_id);
  }

  // --- Gestão de Instâncias ---

  @Post(':id/instances')
  @Roles('ADMIN')
  async addInstance(
    @Param('id') id: string,
    @Body() data: { name: string; type: 'whatsapp' | 'instagram' },
    @Request() req: any,
  ) {
    return this.inboxesService.addInstance(id, data.name, data.type, req.user?.tenant_id);
  }
}
