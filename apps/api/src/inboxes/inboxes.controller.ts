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
    return this.inboxesService.findAll(undefined, userId);
  }

  @Get('operators')
  async getAllOperators() {
    return this.inboxesService.findAllOperators();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.inboxesService.findOne(id);
  }

  @Post()
  @Roles('ADMIN')
  async create(@Body() data: { name: string }) {
    return this.inboxesService.create(data);
  }

  @Put(':id')
  @Roles('ADMIN')
  async update(@Param('id') id: string, @Body() data: { name: string }) {
    return this.inboxesService.update(id, data);
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@Param('id') id: string) {
    return this.inboxesService.remove(id);
  }

  // --- Gestão de Usuários ---

  @Post(':id/users')
  @Roles('ADMIN')
  async addUser(@Param('id') id: string, @Body() data: { userId: string }) {
    return this.inboxesService.addUser(id, data.userId);
  }

  @Delete(':id/users/:userId')
  @Roles('ADMIN')
  async removeUser(@Param('id') id: string, @Param('userId') userId: string) {
    return this.inboxesService.removeUser(id, userId);
  }

  // --- Gestão de Instâncias ---

  @Post(':id/instances')
  @Roles('ADMIN')
  async addInstance(
    @Param('id') id: string,
    @Body() data: { name: string; type: 'whatsapp' | 'instagram' }
  ) {
    return this.inboxesService.addInstance(id, data.name, data.type);
  }
}
