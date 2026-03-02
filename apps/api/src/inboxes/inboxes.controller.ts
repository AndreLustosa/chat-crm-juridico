import { Controller, Get, Post, Body, Param, Put, Delete, Request } from '@nestjs/common';
import { InboxesService } from './inboxes.service';

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
  async create(@Body() data: { name: string }) {
    return this.inboxesService.create(data);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() data: { name: string }) {
    return this.inboxesService.update(id, data);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.inboxesService.remove(id);
  }

  // --- Gestão de Usuários ---

  @Post(':id/users')
  async addUser(@Param('id') id: string, @Body() data: { userId: string }) {
    return this.inboxesService.addUser(id, data.userId);
  }

  @Delete(':id/users/:userId')
  async removeUser(@Param('id') id: string, @Param('userId') userId: string) {
    return this.inboxesService.removeUser(id, userId);
  }

  // --- Gestão de Instâncias ---

  @Post(':id/instances')
  async addInstance(
    @Param('id') id: string, 
    @Body() data: { name: string; type: 'whatsapp' | 'instagram' }
  ) {
    return this.inboxesService.addInstance(id, data.name, data.type);
  }
}
