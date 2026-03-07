import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('agents')
  findAgents() {
    return this.usersService.findAgents();
  }

  @Get('lawyers')
  findLawyers() {
    return this.usersService.findLawyers();
  }

  @Get()
  findAll(@Request() req: any) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem listar usuários');
    }
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    if (req.user.role !== 'ADMIN' && req.user.id !== id) {
      throw new ForbiddenException('Sem permissão');
    }
    return this.usersService.findById(id);
  }

  @Post()
  create(@Request() req: any, @Body() data: { name: string; email: string; password: string; role: string; phone?: string }) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem criar usuários');
    }
    return this.usersService.create({ ...data, tenant_id: req.user.tenant_id });
  }

  @Patch(':id')
  update(@Request() req: any, @Param('id') id: string, @Body() data: { name?: string; email?: string; role?: string; password?: string; inboxIds?: string[]; specialties?: string[]; phone?: string }) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem editar usuários');
    }
    return this.usersService.update(id, data);
  }

  @Get(':id/interns')
  findInterns(@Request() req: any, @Param('id') id: string) {
    return this.usersService.findInterns(id);
  }

  @Patch(':id/supervisors')
  linkSupervisors(
    @Request() req: any,
    @Param('id') id: string,
    @Body() data: { lawyerIds: string[] },
  ) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem vincular supervisores');
    }
    return this.usersService.linkSupervisors(id, data.lawyerIds);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem remover usuários');
    }
    if (req.user.id === id) {
      throw new ForbiddenException('Você não pode remover a si mesmo');
    }
    return this.usersService.remove(id);
  }
}
