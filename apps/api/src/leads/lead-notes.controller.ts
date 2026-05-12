import { Controller, Get, Post, Delete, Param, Body, Request, UseGuards, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { LeadNotesService } from './lead-notes.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IsString, MinLength, MaxLength } from 'class-validator';

class CreateNoteDto {
  @IsString()
  @MinLength(1, { message: 'Nota não pode ser vazia' })
  @MaxLength(2000, { message: 'Nota muito longa (máx. 2000 caracteres)' })
  text: string;
}

@UseGuards(JwtAuthGuard)
@Controller('leads/:leadId/notes')
export class LeadNotesController {
  constructor(private readonly leadNotesService: LeadNotesService) {}

  // Bug fix 2026-05-12 (Leads PR1 #C7): todos endpoints exigem tenant_id +
  // passam roles[] correto (antes user.role singular nao existia no schema).
  @Get()
  findAll(@Param('leadId') leadId: string, @Request() req: any) {
    if (!req.user?.tenant_id) throw new UnauthorizedException('Token sem tenant_id');
    return this.leadNotesService.findByLead(leadId, req.user.tenant_id);
  }

  @Post()
  create(
    @Param('leadId') leadId: string,
    @Body() body: CreateNoteDto,
    @Request() req: any,
  ) {
    if (!req.user?.tenant_id) throw new UnauthorizedException('Token sem tenant_id');
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Usuário não autenticado');
    return this.leadNotesService.create(leadId, userId, body.text, req.user.tenant_id);
  }

  @Delete(':noteId')
  delete(
    @Param('noteId') noteId: string,
    @Request() req: any,
  ) {
    if (!req.user?.tenant_id) throw new UnauthorizedException('Token sem tenant_id');
    return this.leadNotesService.delete(noteId, req.user?.id, req.user?.roles, req.user.tenant_id);
  }
}
