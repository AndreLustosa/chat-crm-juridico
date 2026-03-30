import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('agents')
  findAgents(@Request() req: any) {
    return this.usersService.findAgents(req.user?.tenant_id);
  }

  @Get('lawyers')
  findLawyers(@Request() req: any) {
    return this.usersService.findLawyers(req.user?.tenant_id);
  }

  @Get()
  @Roles('ADMIN')
  findAll(@Request() req: any) {
    return this.usersService.findAll(req.user?.tenant_id);
  }

  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    // Permite ADMIN ou o próprio usuário ver seu perfil
    if (req.user.role !== 'ADMIN' && req.user.id !== id) {
      throw new ForbiddenException('Sem permissão');
    }
    return this.usersService.findById(id, req.user?.tenant_id);
  }

  @Post()
  @Roles('ADMIN')
  create(@Request() req: any, @Body() data: { name: string; email: string; password: string; role: string; phone?: string }) {
    return this.usersService.create({ ...data, tenant_id: req.user.tenant_id });
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Request() req: any, @Param('id') id: string, @Body() data: { name?: string; email?: string; role?: string; password?: string; inboxIds?: string[]; specialties?: string[]; phone?: string }) {
    return this.usersService.update(id, data, req.user?.tenant_id);
  }

  @Get(':id/interns')
  findInterns(@Param('id') id: string) {
    return this.usersService.findInterns(id);
  }

  @Patch(':id/supervisors')
  @Roles('ADMIN')
  linkSupervisors(@Param('id') id: string, @Body() data: { lawyerIds: string[] }) {
    return this.usersService.linkSupervisors(id, data.lawyerIds);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Request() req: any, @Param('id') id: string) {
    if (req.user.id === id) {
      throw new ForbiddenException('Você não pode remover a si mesmo');
    }
    return this.usersService.remove(id, req.user?.tenant_id);
  }
}
